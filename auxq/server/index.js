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
// Middleware is code that runs on EVERY request before it reaches your routes.
// Think of it like a security checkpoint at an airport — every passenger goes through it.

// cors() lets your frontend (running on one URL) talk to your backend (running on another URL).
// Without this, browsers block the request for security reasons. This is called "Cross-Origin Resource Sharing."
app.use(cors());

// express.json() tells Express to automatically parse JSON data sent in requests.
// Without this, when your frontend sends { "song": "God's Plan" }, your backend wouldn't understand it.
app.use(express.json());

// --- In-Memory Room Storage ---
// For our MVP, we'll store rooms in memory (a JavaScript object).
// This means rooms disappear when the server restarts, which is fine for now.
// Later, we'll move this to MongoDB for persistence.
const rooms = {};

// --- Auto-advance polling ---
// Each room gets its own polling interval stored here.
// Key = room code, Value = the interval timer ID (so we can cancel it later)
const roomPollers = {};

// How often we check Spotify (in milliseconds).
// 3 seconds is frequent enough to feel instant, slow enough not to hammer the API.
const POLL_INTERVAL_MS = 3000;

// Start polling Spotify for a specific room.
// Called when a song starts playing.
function startPolling(roomCode) {
  // Don't start a second poller if one's already running for this room
  if (roomPollers[roomCode]) return;

  console.log(`[Poller] Starting for room ${roomCode}`);

  roomPollers[roomCode] = setInterval(async () => {
    const room = rooms[roomCode];

    // If the room no longer exists, clean up and stop
    if (!room) {
      stopPolling(roomCode);
      return;
    }

    // If AuxQ thinks nothing is playing, nothing to check
    if (!room.currentTrack) return;

    try {
      const token = await getValidToken(roomCode);
      const state = await getPlaybackState(token);

      // Spotify returned nothing — device is idle, do nothing
      if (!state || !state.currentTrack) return;

      // --- Case 1: Song ended naturally ---
      // Spotify reports not playing AND progress is near zero.
      // "Near zero" = under 3 seconds. We use 3000ms as the threshold.
      const songEndedNaturally = !state.isPlaying && state.currentTrack.progressMs < 3000;

      // --- Case 2: Different song is playing in Spotify ---
      // This catches the case where Spotify moved on but AuxQ didn't know
      const inGracePeriod = Date.now() - (room._pollStartedAt || 0) < 5000;
      const unexpectedTrack = !inGracePeriod && state.currentTrack.spotifyId !== room.currentTrack.spotifyId;

      if (songEndedNaturally || unexpectedTrack) {
        console.log(`[Poller] Song ended in room ${roomCode}, advancing queue`);
        advanceQueue(roomCode);
        return;
      }

      // --- Case 3: User paused Spotify directly ---
      // Spotify says not playing, but the song is mid-way through
      // This means the user hit pause on their Spotify app
      if (!state.isPlaying && room.isPlaying) {
        console.log(`[Poller] Playback paused externally in room ${roomCode}`);
        room.isPlaying = false;
        io.to(roomCode).emit('room-updated', room);
        return;
      }

      // --- Case 4: User resumed Spotify directly ---
      if (state.isPlaying && !room.isPlaying) {
        console.log(`[Poller] Playback resumed externally in room ${roomCode}`);
        room.isPlaying = true;
        io.to(roomCode).emit('room-updated', room);
        return;
      }

      // --- Default: playing normally, do nothing ---

    } catch (err) {
      // Don't crash the poller on a single failed request — just log and continue
      console.error(`[Poller] Error in room ${roomCode}:`, err.message);
    }
  }, POLL_INTERVAL_MS);
}

// Stop polling for a room (when room is empty, destroyed, or nothing is playing)
function stopPolling(roomCode) {
  if (roomPollers[roomCode]) {
    clearInterval(roomPollers[roomCode]);
    delete roomPollers[roomCode];
    console.log(`[Poller] Stopped for room ${roomCode}`);
  }
}

// Advance the queue and play the next song.
// This is extracted so both the skip button AND the poller can call it.
async function advanceQueue(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // Remove the song that just finished
  room.queue.shift();
  room.currentTrack = room.queue[0] || null;
  room._pollStartedAt = Date.now();

  if (room.currentTrack) {
    // There's a next song — play it
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
    // Queue is empty
    room.isPlaying = false;
    stopPolling(roomCode);
    io.to(roomCode).emit('room-updated', room);
    console.log(`[Poller] Queue empty in room ${roomCode}`);
  }
}

// --- Helper: Generate a 4-digit room code ---
function generateRoomCode() {
  // Keep generating until we find a code that's not already in use
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

// --- Import route files ---
// As your app grows, you don't want ALL your endpoints in one file.
// Instead, you organize them into separate "route" files and plug them in here.
const spotifyRoutes = require('./routes/spotify-routes');
const { getValidToken } = spotifyRoutes;
const appleMusicRoutes = require('./routes/apple-music-routes');

// This tells Express: "Any request starting with /api/spotify should be handled
// by the spotify-routes file." So /api/spotify/search, /api/spotify/login, etc.
app.use('/api/spotify', spotifyRoutes);
app.use('/api/apple-music', appleMusicRoutes);

// --- REST API Routes ---
// REST stands for "Representational State Transfer" — it's just a standard way of
// designing your API. Each URL (called an "endpoint") does one specific thing.

// Health check — a simple endpoint to verify the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'AuxQ server is running' });
});

// Create a new room
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

// Get room info
app.get('/api/rooms/:code', (req, res) => {
  const { code } = req.params;
  const room = rooms[code];

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({ room });
});

// --- Socket.io Real-Time Events ---
// This is where the magic happens. When a user connects, we set up listeners
// for different events they can trigger, like joining a room or adding a song.

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins a room
  socket.on('join-room', ({ code, userName }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // socket.join() is a Socket.io feature that puts this connection into a "group"
    // so we can broadcast messages to everyone in the same room
    socket.join(code);

    // Add user to the room's user list if they're not already there
    if (!room.users.includes(userName)) {
      room.users.push(userName);
      console.log(`${userName} joined room ${code}`);
    }

    // Tell others someone joined, and send room data back to the joiner
    socket.to(code).emit('room-updated', room);
    socket.emit('room-updated', room);
  });

  // User adds a song to the queue
socket.on('add-song', ({ code, song }) => {
  const room = rooms[code];
  if (!room) {
    socket.emit('error', { message: 'Room not found' });
    return;
  }

  room.queue.push({
    id: Date.now().toString(),
    ...song,
    addedBy: song.addedBy || 'Anonymous',
    addedAt: new Date()
  });

  if (!room.currentTrack) {
    room.currentTrack = room.queue[0];
  }

  io.to(code).emit('room-updated', room);
  console.log(`Song added to room ${code}: ${song.title}`);
});

  // Host skips to next song
socket.on('next-song', ({ code }) => {
  const room = rooms[code];
  if (!room) return;

  // Use advanceQueue so skip and auto-advance share the same logic
  advanceQueue(code);
});

  // Host toggles play/pause
  socket.on('toggle-playback', ({ code }) => {
    const room = rooms[code];
    if (!room) return;

    room.isPlaying = !room.isPlaying;
    io.to(code).emit('room-updated', room);
  });

  // Host started playing
socket.on('play-started', ({ code }) => {
  const room = rooms[code];
  if (!room) return;
  room.isPlaying = true;
  room._pollStartedAt = Date.now();  // ← add this
  io.to(code).emit('room-updated', room);
  startPolling(code);
});

// Host paused
socket.on('pause-started', ({ code }) => {
  const room = rooms[code];
  if (!room) return;
  room.isPlaying = false;
  io.to(code).emit('room-updated', room);
  // Stop polling while paused — no need to check a paused song
  stopPolling(code);
});

  // User disconnects
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// --- Start the server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AuxQ server running on port ${PORT}`);
});
