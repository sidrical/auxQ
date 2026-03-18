// Load environment variables from .env file
// (this is where we'll store secret keys like API credentials)
require('dotenv').config();

// Import our dependencies
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { getPlaybackState, playTrack } = require('./utils/spotify');

// Initialize Express app
const app = express();

// Create an HTTPS server using the self-signed certificates we generated.
const server = http.createServer(app);

// Initialize Socket.io on top of the HTTP server
// cors: { origin: '*' } means "allow connections from any website" (we'll lock this down later)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- In-Memory Room Storage ---
const rooms = {};

// --- Auto-advance polling ---
const roomPollers = {};

// How often we check Spotify (in milliseconds).
const POLL_INTERVAL_MS = 3000;

// Per-room poller state — this is the key to reliable detection.
// Instead of making decisions based on a single snapshot, we compare
// the current Spotify state to what we saw last poll.
const pollerState = {};
// Shape of each entry:
// {
//   lastTrackId: string | null,       — Spotify track ID we saw last poll
//   lastProgressMs: number,           — how far through the song we were last poll
//   lastDurationMs: number,           — total length of the song last poll
//   lastIsPlaying: boolean            — was Spotify playing last poll
// }

function startPolling(roomCode) {
  if (roomPollers[roomCode]) return;

  console.log(`[Poller] Starting for room ${roomCode}`);

  // Initialize fresh state for this room
  pollerState[roomCode] = {
    lastTrackId: null,
    lastProgressMs: 0,
    lastDurationMs: 0,
    lastIsPlaying: false
  };

  roomPollers[roomCode] = setInterval(async () => {
    const room = rooms[roomCode];

    if (!room) {
      stopPolling(roomCode);
      return;
    }

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

      // --- Case 1: Song ended naturally ---
      // The reliable signal is: progress was well into the song last poll (>60%),
      // and now Spotify is either stopped or back near the beginning.
      // This avoids false positives when a song is first loaded (progress starts at 0).
      const wasWellIntoSong =
        prev.lastDurationMs > 0 &&
        prev.lastProgressMs / prev.lastDurationMs > 0.6;

      const spotifyNowStopped =
        !curr.isPlaying && curr.progressMs < 3000;

      const songEndedNaturally = wasWellIntoSong && spotifyNowStopped && room.isPlaying;

      // --- Case 2: Spotify is playing a different track than AuxQ expects ---
      // This catches external skips or Spotify moving to its own next song.
      // We only flag this if the track ID also doesn't match what AuxQ has queued.
      const unexpectedTrack =
        curr.isPlaying &&
        curr.trackId !== room.currentTrack.spotifyId &&
        prev.lastTrackId !== null; // ignore on the very first poll

      if (songEndedNaturally || unexpectedTrack) {
        console.log(`[Poller] Advancing queue in room ${roomCode} (reason: ${songEndedNaturally ? 'natural end' : 'unexpected track'})`);
        // Update state before advancing so the next poll starts fresh
        pollerState[roomCode] = {
          lastTrackId: curr.trackId,
          lastProgressMs: curr.progressMs,
          lastDurationMs: curr.durationMs,
          lastIsPlaying: curr.isPlaying
        };
        advanceQueue(roomCode);
        return;
      }

      // --- Case 3: User paused Spotify directly ---
      if (!curr.isPlaying && prev.lastIsPlaying && room.isPlaying) {
        console.log(`[Poller] Playback paused externally in room ${roomCode}`);
        room.isPlaying = false;
        io.to(roomCode).emit('room-updated', room);
      }

      // --- Case 4: User resumed Spotify directly ---
      if (curr.isPlaying && !prev.lastIsPlaying && !room.isPlaying) {
        console.log(`[Poller] Playback resumed externally in room ${roomCode}`);
        room.isPlaying = true;
        io.to(roomCode).emit('room-updated', room);
      }

      // Always update poller state for next iteration
      pollerState[roomCode] = {
        lastTrackId: curr.trackId,
        lastProgressMs: curr.progressMs,
        lastDurationMs: curr.durationMs,
        lastIsPlaying: curr.isPlaying
      };

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
    console.log(`[Poller] Stopped for room ${roomCode}`);
  }
}

async function advanceQueue(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.currentTrack = room.queue.shift() || null;

  if (room.currentTrack) {
    room.isPlaying = true;
    io.to(roomCode).emit('room-updated', room);

    try {
      const token = await getValidToken(roomCode);
      await playTrack(token, room.currentTrack.spotifyUri);
      console.log(`[Poller] Now playing: ${room.currentTrack.title}`);
    } catch (err) {
      console.error(`[Poller] Failed to play next track:`, err.message);
      room.isPlaying = false;
      io.to(roomCode).emit('room-updated', room);
    }
  } else {
    room.isPlaying = false;
    stopPolling(roomCode);
    io.to(roomCode).emit('room-updated', room);
    console.log(`[Poller] Queue empty in room ${roomCode}`);
  }
}

// --- Helper: Generate a 4-digit room code ---
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

// --- Import route files ---
const spotifyRoutes = require('./routes/spotify-routes');
const { getValidToken } = spotifyRoutes;
const appleMusicRoutes = require('./routes/apple-music-routes');

app.use('/api/spotify', spotifyRoutes);
app.use('/api/apple-music', appleMusicRoutes);

// --- REST API Routes ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'AuxQ server is running' });
});

app.post('/api/rooms', (req, res) => {
  const { hostName } = req.body;

  if (!hostName) {
    return res.status(400).json({ error: 'Host name is required' });
  }

  const code = generateRoomCode();

  rooms[code] = {
    code,
    host: hostName,
    queue: [],
    currentTrack: null,
    isPlaying: false,
    users: [hostName],
    createdAt: new Date()
  };

  res.status(201).json({ room: rooms[code] });
});

app.get('/api/rooms/:code', (req, res) => {
  const { code } = req.params;
  const room = rooms[code];

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({ room });
});

// --- Socket.io Real-Time Events ---

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ code, userName }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    socket.join(code);

    if (!room.users.includes(userName)) {
      room.users.push(userName);
      console.log(`${userName} joined room ${code}`);
    }

    socket.to(code).emit('room-updated', room);
    socket.emit('room-updated', room);
  });

  socket.on('add-song', async ({ code, song }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    let resolvedSong = song;
    if (song.source !== 'spotify') {
      try {
        const { findMatch } = require('./utils/song-matcher');
        const token = await getValidToken(code);
        const matched = await findMatch(song, 'spotify', token);
        if (matched && matched.spotifyUri) {
          resolvedSong = matched;
          console.log(`Matched "${song.title}" to Spotify via ${matched.matchedVia}`);
        } else {
          console.warn(`Could not match "${song.title}" to Spotify`);
          socket.emit('error', { message: `"${song.title}" couldn't be found on Spotify` });
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

    if (!room.currentTrack) {
      room.currentTrack = room.queue.shift();
    }

    io.to(code).emit('room-updated', room);
    console.log(`Song added to room ${code}: ${song.title}`);
  });

  socket.on('next-song', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    advanceQueue(code);
  });

  socket.on('toggle-playback', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = !room.isPlaying;
    io.to(code).emit('room-updated', room);
  });

  socket.on('play-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = true;
    io.to(code).emit('room-updated', room);
    startPolling(code);
  });

  socket.on('pause-started', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.isPlaying = false;
    io.to(code).emit('room-updated', room);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// --- Start the server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuxQ server running on port ${PORT}`);
});