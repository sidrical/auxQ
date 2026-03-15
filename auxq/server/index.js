// Load environment variables from .env file
// (this is where we'll store secret keys like API credentials)
require('dotenv').config();

// Import our dependencies
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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
    }

    // Tell everyone in the room that someone joined
    io.to(code).emit('room-updated', room);
    console.log(`${userName} joined room ${code}`);
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

    // Remove the first song from the queue (it just finished playing)
    room.queue.shift();
    room.currentTrack = room.queue[0] || null;

    io.to(code).emit('room-updated', room);
  });

  // Host toggles play/pause
  socket.on('toggle-playback', ({ code }) => {
    const room = rooms[code];
    if (!room) return;

    room.isPlaying = !room.isPlaying;
    io.to(code).emit('room-updated', room);
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
