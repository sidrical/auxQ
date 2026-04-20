require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { getPlaybackState, playTrack } = require('./utils/spotify');

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

const rooms = {};
const roomPollers = {};
const POLL_INTERVAL_MS = 3000;
const pollerState = {};
const lastManualSkipAt = {};

function startPolling(roomCode) {
  if (roomPollers[roomCode]) return;

  pollerState[roomCode] = {
    lastTrackId: null,
    lastProgressMs: 0,
    lastDurationMs: 0,
    lastIsPlaying: false
  };

  roomPollers[roomCode] = setInterval(async () => {
    const room = rooms[roomCode];
    if (!room) { stopPolling(roomCode); return; }
    if (!room.currentTrack) return;

    try {
      const token = await getValidToken(roomCode);
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
        io.to(roomCode).emit('room-updated', room);
      }

      if (curr.isPlaying && !prev.lastIsPlaying && !room.isPlaying) {
        room.isPlaying = true;
        io.to(roomCode).emit('room-updated', room);
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
  const room = rooms[roomCode];
  if (!room) return;

  room.currentTrack = room.queue.shift() || null;

  if (room.currentTrack) {
    if (pollerState[roomCode]) {
      pollerState[roomCode] = { lastTrackId: null, lastProgressMs: 0, lastDurationMs: 0, lastIsPlaying: false };
    }
    lastManualSkipAt[roomCode] = Date.now();

    if (room.hostPlatform === 'apple_music') {
      // Apple Music: tell the host's browser to play the next track
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('apple-play-track', { appleMusicId: room.currentTrack.appleMusicId });
      }
      room.isPlaying = true;
      io.to(roomCode).emit('room-updated', room);
      console.log(`[Queue] Apple Music — now playing: ${room.currentTrack.title}`);
    } else {
      try {
        const token = await getValidToken(roomCode);
        await playTrack(token, room.currentTrack.spotifyUri);
        room.isPlaying = true;
        io.to(roomCode).emit('room-updated', room);
        console.log(`[Queue] Spotify — now playing: ${room.currentTrack.title}`);
      } catch (err) {
        console.error(`[Queue] Failed to play next track:`, err.message);
        room.isPlaying = false;
        io.to(roomCode).emit('room-updated', room);
      }
    }
  } else {
    room.isPlaying = false;
    if (room.hostPlatform !== 'apple_music') stopPolling(roomCode);
    io.to(roomCode).emit('room-updated', room);
    console.log(`[Queue] Empty in room ${roomCode}`);
  }
}

function generateRoomCode() {
  let code;
  do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms[code]);
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

  const code = generateRoomCode();

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

  rooms[code] = {
    code,
    host: hostName,
    hostSocketId: null,
    hostUserId,
    hostPlatform: null,
    queue: [],
    currentTrack: null,
    isPlaying: false,
    users: [hostName],
    userSockets: {},
    userIPs: {},
    bannedUsers,
    bannedIPs: [],
    guestReorderEnabled: false,
    createdAt: new Date()
  };

  res.status(201).json({ room: rooms[code] });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room });
});

function getSocketIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ code, userName }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

    const ip = getSocketIP(socket);

    if (room.bannedUsers.includes(userName) || room.bannedIPs.includes(ip)) {
      socket.emit('banned', { message: 'You have been banned from this room.' });
      return;
    }

    socket.join(code);
    if (!room.users.includes(userName)) room.users.push(userName);
    room.userSockets[userName] = socket.id;
    room.userIPs[userName] = ip;

    if (userName === room.host) room.hostSocketId = socket.id;

    socket.to(code).emit('room-updated', room);
    socket.emit('room-updated', room);
  });

  socket.on('kick-user', ({ code, targetUser }) => {
    const room = rooms[code];
    if (!room || socket.id !== room.hostSocketId) return;

    const targetSocketId = room.userSockets[targetUser];
    if (targetSocketId) {
      io.to(targetSocketId).emit('kicked', { message: 'You were removed from the room by the host.' });
    }

    room.users = room.users.filter(u => u !== targetUser);
    delete room.userSockets[targetUser];
    delete room.userIPs[targetUser];
    io.to(code).emit('room-updated', room);
    console.log(`[Room ${code}] ${targetUser} was kicked by host`);
  });

  socket.on('ban-user', async ({ code, targetUser }) => {
    const room = rooms[code];
    if (!room || socket.id !== room.hostSocketId) return;

    const targetSocketId = room.userSockets[targetUser];
    const targetIP = room.userIPs[targetUser];

    if (targetSocketId) {
      io.to(targetSocketId).emit('banned', { message: 'You have been banned from this room.' });
    }

    room.users = room.users.filter(u => u !== targetUser);
    delete room.userSockets[targetUser];
    delete room.userIPs[targetUser];
    if (!room.bannedUsers.includes(targetUser)) room.bannedUsers.push(targetUser);
    if (targetIP && !room.bannedIPs.includes(targetIP)) room.bannedIPs.push(targetIP);
    io.to(code).emit('room-updated', room);
    console.log(`[Room ${code}] ${targetUser} (${targetIP}) was banned by host`);

    if (room.hostUserId) {
      try {
        await User.findByIdAndUpdate(room.hostUserId, { $addToSet: { banList: targetUser } });
      } catch (err) {
        console.error('[Ban] Could not persist ban to DB:', err.message);
      }
    }
  });

  socket.on('set-guest-reorder', ({ code, enabled }) => {
    const room = rooms[code];
    if (!room || socket.id !== room.hostSocketId) return;
    room.guestReorderEnabled = enabled;
    io.to(code).emit('room-updated', room);
  });

  socket.on('set-host-platform', ({ code, platform }) => {
    const room = rooms[code];
    if (!room) return;
    room.hostPlatform = platform;
    room.hostSocketId = socket.id;
    io.to(code).emit('room-updated', room);
    console.log(`Room ${code} — host platform: ${platform}`);
  });

  socket.on('add-song', async ({ code, song }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

    // Match the song to the host's platform if it came from the other platform
    const hostPlatform = room.hostPlatform || 'spotify';
    let resolvedSong = song;

    if (song.source !== hostPlatform) {
      try {
        const { findMatch } = require('./utils/song-matcher');
        const token = hostPlatform === 'spotify' ? await getValidToken(code) : null;
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

    room.queue.push({
      id: Date.now().toString(),
      ...resolvedSong,
      addedBy: song.addedBy || 'Anonymous',
      addedAt: new Date()
    });

    if (!room.currentTrack) room.currentTrack = room.queue.shift();

    io.to(code).emit('room-updated', room);
    console.log(`Song added to room ${code}: ${song.title}`);
  });

  socket.on('next-song', ({ code }) => {
    const room = rooms[code];
    if (!room) return;

    const now = Date.now();
    // Swallow rapid repeat skips within 1s — iOS Safari double-tap workaround
    if (room.lastAdvanceAt && now - room.lastAdvanceAt < 1000) return;
    room.lastAdvanceAt = now;
    lastManualSkipAt[code] = now;

    advanceQueue(code);
  });

  // Spotify playback events
  socket.on('play-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = true;
    io.to(code).emit('room-updated', room);
    if (!room.hostPlatform || room.hostPlatform === 'spotify') startPolling(code);
  });

  socket.on('pause-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = false;
    io.to(code).emit('room-updated', room);
  });

  // Apple Music playback events
  socket.on('apple-play-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = true;
    io.to(code).emit('room-updated', room);
  });

  socket.on('apple-pause-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = false;
    io.to(code).emit('room-updated', room);
  });

  // Host browser reports that a track ended naturally → advance the queue
  socket.on('apple-progress', ({ code, positionMs, durationMs }) => {
    const room = rooms[code];
    if (!room || socket.id !== room.hostSocketId) return;
    socket.to(code).emit('playback-progress', { progressMs: positionMs, durationMs });
  });

  socket.on('apple-track-ended', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const now = Date.now();
    if (room.lastAdvanceAt && now - room.lastAdvanceAt < 1000) return;
    room.lastAdvanceAt = now;
    console.log(`[Apple Music] Track ended naturally in room ${code}`);
    advanceQueue(code);
  });

  socket.on('reorder-queue', ({ code, fromIndex, toIndex }) => {
    const room = rooms[code];
    if (!room) return;
    if (socket.id !== room.hostSocketId && !room.guestReorderEnabled) return;
    const queue = room.queue;
    if (fromIndex < 0 || fromIndex >= queue.length) return;
    if (toIndex < 0 || toIndex >= queue.length) return;
    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);
    io.to(code).emit('room-updated', room);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuxQ server running on port ${PORT}`);
});
