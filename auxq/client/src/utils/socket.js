// socket.js — Manages the WebSocket connection to the server
//
// This file creates ONE socket connection that the entire app shares.
// We call this a "singleton" — there's only ever one instance.
//
// Why? You don't want each component creating its own connection.
// That would be like everyone in a house having their own phone line
// instead of sharing one. Wasteful and confusing.

import { io } from 'socket.io-client';

// In development, the server runs on port 3001.
// process.env.REACT_APP_SERVER_URL lets you override this in production.
// The "REACT_APP_" prefix is required by React — it only exposes
// environment variables that start with this prefix (for security).
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';

// Create the socket connection.
// autoConnect: false means it won't connect immediately — we connect manually
// when the user joins a room. No point connecting if they're still on the home screen.
const socket = io(SERVER_URL, {
  autoConnect: false
});

// --- Debug logging (helpful during development) ---
socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
});

export default socket;
