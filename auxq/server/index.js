require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { getPlaybackState, playTrack } = require('./utils/spotify');
const Room = require('./models/Room');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[MongoDB] Connected'))
  .catch(err => console.error('[MongoDB] Connection error:', err.message));

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Runtime-only state (not persisted): socket IDs, IP mappings, debounce timestamps
const roomRuntime = {};
const roomPollers = {};
const POLL_INTERVAL_MS = 3000;
const pollerState = {};
const lastManualSkipAt = {};

function ensureRuntime(code) {
  if (!roomRuntime[code]) {
    roomRuntime[code] = { hostSocketId: null, userSockets: {}, userIPs: {}, lastAdvanceAt: null };
  }
  return roomRuntime[code];
}

function toClientRoom(room, runtime) {
  const obj = room.toObject ? room.toObject() : { ...room };
  delete obj._id;
  delete obj.__v;
  delete obj.spotifyAccessToken;
  delete obj.spotifyRefreshToken;
  delete obj.spotifyExpiresAt;
  delete obj.spotifyDeviceId;
  const r = runtime || {};
  obj.hostSocketId = r.hostSocketId || null;
  obj.userSockets = r.userSockets || {};
  obj.userIPs = r.userIPs || {};
  return obj;
}

function startPolling(roomCode) {
  if (roomPollers[roomCode]) return;

  pollerState[roomCode] = {
    lastTrackId: null,
    lastProgressMs: 0,
    lastDurationMs: 0,
    lastIsPlaying: false
  };

  roomPollers[roomCode] = setInterval(async () => {
    let room;
    try {
      room = await Room.findOne({ code: roomCode });
    } catch (err) {
      console.error(`[Poller] DB error in room ${roomCode}:`, err.message);
      return;
    }

    if (!room) { stopPolling(roomCode); return; }
    if (!room.currentTrack) return;

    try {
      const token = await getValidToken(roomCode, room);
      const state = await getPlaybackState(token);
      if (!state || !state.currentTrack) return;

      const prev = pollerState[roomCode];
      const curr = {
        trackId: state.currentTrack.spotifyId,
        progressMs: state.currentTrack.progressMs,
        durationMs: state.currentTrack.durationMs || 0,
        isPlaying: state.isPlaying
      };

      const wasWellIntoSong =
        prev.lastDurationMs > 0 &&
        prev.lastProgressMs / prev.lastDurationMs > 0.6;

      const spotifyNowStopped = !curr.isPlaying && curr.progressMs < 3000;
      const songEndedNaturally = wasWellIntoSong && spotifyNowStopped && room.isPlaying;

      const unexpectedTrack =
        curr.isPlaying &&
        curr.trackId !== room.currentTrack.spotifyId &&
        prev.lastTrackId !== null;

      if (songEndedNaturally || unexpectedTrack) {
        const recentManualSkip = lastManualSkipAt[roomCode] && (Date.now() - lastManualSkipAt[roomCode] < 8000);
        if (recentManualSkip) return;

        pollerState[roomCode] = {
          lastTrackId: curr.trackId,
          lastProgressMs: curr.progressMs,
          lastDurationMs: curr.durationMs,
          lastIsPlaying: curr.isPlaying
        };
        advanceQueue(roomCode);
        return;
      }

      if (!curr.isPlaying && prev.lastIsPlaying && room.isPlaying) {
        room.isPlaying = false;
        await room.save();
        io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
      }

      if (curr.isPlaying && !prev.lastIsPlaying && !room.isPlaying) {
        room.isPlaying = true;
        await room.save();
        io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
      }

      pollerState[roomCode] = {
        lastTrackId: curr.trackId,
        lastProgressMs: curr.progressMs,
        lastDurationMs: curr.durationMs,
        lastIsPlaying: curr.isPlaying
      };

      if (curr.isPlaying && curr.durationMs > 0) {
        io.to(roomCode).emit('playback-progress', { progressMs: curr.progressMs, durationMs: curr.durationMs });
      }

    } catch (err) {
      console.error(`[Poller] Error in room ${roomCode}:`, err.message);
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling(roomCode) {
  if (roomPollers[roomCode]) {
    clearInterval(roomPollers[roomCode]);
    delete roomPollers[roomCode];
    delete pollerState[roomCode];
  }
}

async function advanceQueue(roomCode) {
  let room;
  try {
    room = await Room.findOne({ code: roomCode });
  } catch (err) {
    console.error(`[advanceQueue] DB error in room ${roomCode}:`, err.message);
    return;
  }
  if (!room) return;

  room.currentTrack = room.queue.length > 0 ? room.queue.shift() : null;
  room.markModified('queue');
  room.markModified('currentTrack');

  if (room.currentTrack) {
    if (pollerState[roomCode]) {
      pollerState[roomCode] = { lastTrackId: null, lastProgressMs: 0, lastDurationMs: 0, lastIsPlaying: false };
    }
    lastManualSkipAt[roomCode] = Date.now();

    if (room.hostPlatform === 'apple_music') {
      const runtime = roomRuntime[roomCode] || {};
      if (runtime.hostSocketId) {
        io.to(runtime.hostSocketId).emit('apple-play-track', { appleMusicId: room.currentTrack.appleMusicId });
      }
      room.isPlaying = true;
      await room.save();
      io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
      console.log(`[Queue] Apple Music — now playing: ${room.currentTrack.title}`);
    } else {
      try {
        const token = await getValidToken(roomCode, room);
        await playTrack(token, room.currentTrack.spotifyUri);
        room.isPlaying = true;
        await room.save();
        io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
        console.log(`[Queue] Spotify — now playing: ${room.currentTrack.title}`);
      } catch (err) {
        console.error(`[Queue] Failed to play next track:`, err.message);
        room.isPlaying = false;
        await room.save();
        io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
      }
    }
  } else {
    room.isPlaying = false;
    await room.save();
    if (room.hostPlatform !== 'apple_music') stopPolling(roomCode);
    io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
    console.log(`[Queue] Empty in room ${roomCode}`);
  }
}

async function generateRoomCode() {
  let code;
  let exists = true;
  while (exists) {
    code = Math.floor(1000 + Math.random() * 9000).toString();
    exists = await Room.exists({ code });
  }
  return code;
}

const spotifyRoutes = require('./routes/spotify-routes');
const { getValidToken } = spotifyRoutes;
const appleMusicRoutes = require('./routes/apple-music-routes');
const authRoutes = require('./routes/auth-routes');
const { optionalToken } = require('./middleware/auth');
const User = require('./models/User');

app.use('/api/spotify', spotifyRoutes);
app.use('/api/apple-music', appleMusicRoutes);
app.use('/auth', authRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/rooms', optionalToken, async (req, res) => {
  const { hostName } = req.body;
  if (!hostName) return res.status(400).json({ error: 'Host name is required' });

  try {
    const code = await generateRoomCode();

    let bannedUsers = [];
    let hostUserId = null;

    if (req.user) {
      try {
        const user = await User.findById(req.user.id).select('banList');
        if (user) {
          bannedUsers = user.banList || [];
          hostUserId = req.user.id;
        }
      } catch {}
    }

    const room = await Room.create({
      code,
      host: hostName,
      hostUserId,
      hostPlatform: null,
      queue: [],
      currentTrack: null,
      isPlaying: false,
      users: [hostName],
      bannedUsers,
      bannedIPs: [],
      guestReorderEnabled: false
    });

    res.status(201).json({ room: toClientRoom(room, null) });
  } catch (err) {
    console.error('[Create room]', err.message);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.get('/api/rooms/:code', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: toClientRoom(room, roomRuntime[req.params.code]) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

function getSocketIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;
}

io.on('connection', (socket) => {
  socket.on('join-room', async ({ code, userName }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

      const ip = getSocketIP(socket);

      if (room.bannedUsers.includes(userName) || room.bannedIPs.includes(ip)) {
        socket.emit('banned', { message: 'You have been banned from this room.' });
        return;
      }

      socket.join(code);
      if (!room.users.includes(userName)) {
        room.users.push(userName);
        await room.save();
      }

      const runtime = ensureRuntime(code);
      runtime.userSockets[userName] = socket.id;
      runtime.userIPs[userName] = ip;
      if (userName === room.host) runtime.hostSocketId = socket.id;

      socket.to(code).emit('room-updated', toClientRoom(room, runtime));
      socket.emit('room-updated', toClientRoom(room, runtime));
    } catch (err) {
      console.error('[join-room]', err.message);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('kick-user', async ({ code, targetUser }) => {
    try {
      const runtime = roomRuntime[code];
      if (!runtime || socket.id !== runtime.hostSocketId) return;

      const room = await Room.findOne({ code });
      if (!room) return;

      const targetSocketId = runtime.userSockets[targetUser];
      if (targetSocketId) {
        io.to(targetSocketId).emit('kicked', { message: 'You were removed from the room by the host.' });
      }

      room.users = room.users.filter(u => u !== targetUser);
      await room.save();
      delete runtime.userSockets[targetUser];
      delete runtime.userIPs[targetUser];
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
      console.log(`[Room ${code}] ${targetUser} was kicked by host`);
    } catch (err) {
      console.error('[kick-user]', err.message);
      socket.emit('error', { message: 'Failed to kick user' });
    }
  });

  socket.on('ban-user', async ({ code, targetUser }) => {
    try {
      const runtime = roomRuntime[code];
      if (!runtime || socket.id !== runtime.hostSocketId) return;

      const room = await Room.findOne({ code });
      if (!room) return;

      const targetSocketId = runtime.userSockets[targetUser];
      const targetIP = runtime.userIPs[targetUser];

      if (targetSocketId) {
        io.to(targetSocketId).emit('banned', { message: 'You have been banned from this room.' });
      }

      room.users = room.users.filter(u => u !== targetUser);
      if (!room.bannedUsers.includes(targetUser)) room.bannedUsers.push(targetUser);
      if (targetIP && !room.bannedIPs.includes(targetIP)) room.bannedIPs.push(targetIP);
      await room.save();

      delete runtime.userSockets[targetUser];
      delete runtime.userIPs[targetUser];
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
      console.log(`[Room ${code}] ${targetUser} (${targetIP}) was banned by host`);

      if (room.hostUserId) {
        try {
          await User.findByIdAndUpdate(room.hostUserId, { $addToSet: { banList: targetUser } });
        } catch (err) {
          console.error('[Ban] Could not persist ban to DB:', err.message);
        }
      }
    } catch (err) {
      console.error('[ban-user]', err.message);
      socket.emit('error', { message: 'Failed to ban user' });
    }
  });

  socket.on('set-guest-reorder', async ({ code, enabled }) => {
    try {
      const runtime = roomRuntime[code];
      if (!runtime || socket.id !== runtime.hostSocketId) return;

      const room = await Room.findOne({ code });
      if (!room) return;
      room.guestReorderEnabled = enabled;
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
    } catch (err) {
      console.error('[set-guest-reorder]', err.message);
    }
  });

  socket.on('set-host-platform', async ({ code, platform }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      room.hostPlatform = platform;
      await room.save();
      const runtime = ensureRuntime(code);
      runtime.hostSocketId = socket.id;
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
      console.log(`Room ${code} — host platform: ${platform}`);
    } catch (err) {
      console.error('[set-host-platform]', err.message);
    }
  });

  socket.on('add-song', async ({ code, song }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

      const hostPlatform = room.hostPlatform || 'spotify';
      let resolvedSong = song;

      if (song.source !== hostPlatform) {
        try {
          const { findMatch } = require('./utils/song-matcher');
          const token = hostPlatform === 'spotify' ? await getValidToken(code, room) : null;
          const matched = await findMatch(song, hostPlatform, token);
          if (matched && (matched.spotifyUri || matched.appleMusicId)) {
            resolvedSong = matched;
            console.log(`Matched "${song.title}" to ${hostPlatform} via ${matched.matchedVia}`);
          } else {
            const name = hostPlatform === 'spotify' ? 'Spotify' : 'Apple Music';
            socket.emit('error', { message: `"${song.title}" couldn't be found on ${name}` });
            return;
          }
        } catch (err) {
          console.error('Song matching error:', err.message);
          socket.emit('error', { message: 'Failed to match song across platforms' });
          return;
        }
      }

      const newSong = {
        id: Date.now().toString(),
        ...resolvedSong,
        addedBy: song.addedBy || 'Anonymous',
        addedAt: new Date()
      };
      const firstPlaylistIdx = room.queue.findIndex(s => s.queueType === 'playlist');
      if (firstPlaylistIdx !== -1) {
        room.queue.splice(firstPlaylistIdx, 0, newSong);
      } else {
        room.queue.push(newSong);
      }
      room.markModified('queue');

      if (!room.currentTrack) {
        room.currentTrack = room.queue.shift();
        room.markModified('queue');
        room.markModified('currentTrack');
      }

      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, roomRuntime[code]));
      console.log(`Song added to room ${code}: ${song.title}`);
    } catch (err) {
      console.error('[add-song]', err.message);
      socket.emit('error', { message: 'Failed to add song' });
    }
  });

  socket.on('queue-playlist', async ({ roomCode, songs, playlistName, addedBy }) => {
    try {
      const room = await Room.findOne({ code: roomCode });
      if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

      const shuffled = [...songs];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const playlistSongs = shuffled.map(song => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        ...song,
        addedBy: addedBy || 'Anonymous',
        addedAt: new Date(),
        queueType: 'playlist'
      }));

      room.queue.push(...playlistSongs);
      room.activePlaylist = { name: playlistName, addedBy, totalSongs: songs.length };
      room.markModified('queue');
      room.markModified('activePlaylist');

      if (!room.currentTrack && room.queue.length > 0) {
        room.currentTrack = room.queue.shift();
        room.markModified('queue');
        room.markModified('currentTrack');
      }

      await room.save();
      io.to(roomCode).emit('room-updated', toClientRoom(room, roomRuntime[roomCode]));
      console.log(`[Queue] Playlist "${playlistName}" queued in room ${roomCode}: ${songs.length} songs`);
    } catch (err) {
      console.error('[queue-playlist]', err.message);
      socket.emit('error', { message: 'Failed to queue playlist' });
    }
  });

  socket.on('next-song', async ({ code }) => {
    try {
      const runtime = ensureRuntime(code);
      const now = Date.now();
      if (runtime.lastAdvanceAt && now - runtime.lastAdvanceAt < 1000) return;
      runtime.lastAdvanceAt = now;
      lastManualSkipAt[code] = now;
      advanceQueue(code);
    } catch (err) {
      console.error('[next-song]', err.message);
    }
  });

  socket.on('play-started', async ({ code }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      room.isPlaying = true;
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, roomRuntime[code]));
      if (!room.hostPlatform || room.hostPlatform === 'spotify') startPolling(code);
    } catch (err) {
      console.error('[play-started]', err.message);
    }
  });

  socket.on('pause-started', async ({ code }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      room.isPlaying = false;
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, roomRuntime[code]));
    } catch (err) {
      console.error('[pause-started]', err.message);
    }
  });

  socket.on('apple-play-started', async ({ code }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      room.isPlaying = true;
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, roomRuntime[code]));
    } catch (err) {
      console.error('[apple-play-started]', err.message);
    }
  });

  socket.on('apple-pause-started', async ({ code }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      room.isPlaying = false;
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, roomRuntime[code]));
    } catch (err) {
      console.error('[apple-pause-started]', err.message);
    }
  });

  socket.on('apple-progress', ({ code, positionMs, durationMs }) => {
    const runtime = roomRuntime[code];
    if (!runtime || socket.id !== runtime.hostSocketId) return;
    socket.to(code).emit('playback-progress', { progressMs: positionMs, durationMs });
  });

  socket.on('apple-track-ended', async ({ code }) => {
    try {
      const runtime = ensureRuntime(code);
      const now = Date.now();
      if (runtime.lastAdvanceAt && now - runtime.lastAdvanceAt < 1000) return;
      runtime.lastAdvanceAt = now;
      console.log(`[Apple Music] Track ended naturally in room ${code}`);
      advanceQueue(code);
    } catch (err) {
      console.error('[apple-track-ended]', err.message);
    }
  });

  socket.on('remove-song', async ({ code, index }) => {
    try {
      const room = await Room.findOne({ code });
      if (!room) return;
      const queue = room.queue;
      if (index < 0 || index >= queue.length) return;
      const song = queue[index];
      const runtime = roomRuntime[code] || {};
      const isHost = socket.id === runtime.hostSocketId;
      const userName = Object.keys(runtime.userSockets || {}).find(n => runtime.userSockets[n] === socket.id);
      if (!isHost && song.addedBy !== userName) return;
      queue.splice(index, 1);
      room.markModified('queue');
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
    } catch (err) {
      console.error('[remove-song]', err.message);
    }
  });

  socket.on('reorder-queue', async ({ code, fromIndex, toIndex }) => {
    try {
      const runtime = roomRuntime[code] || {};
      const room = await Room.findOne({ code });
      if (!room) return;
      if (socket.id !== runtime.hostSocketId && !room.guestReorderEnabled) return;
      const queue = room.queue;
      if (fromIndex < 0 || fromIndex >= queue.length) return;
      if (toIndex < 0 || toIndex >= queue.length) return;
      const [moved] = queue.splice(fromIndex, 1);
      queue.splice(toIndex, 0, moved);
      room.markModified('queue');
      await room.save();
      io.to(code).emit('room-updated', toClientRoom(room, runtime));
    } catch (err) {
      console.error('[reorder-queue]', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuxQ server running on port ${PORT}`);
});
