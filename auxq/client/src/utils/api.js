// api.js — Centralized API calls to the backend
//
// Instead of writing fetch() calls scattered throughout your components,
// we put them all here. This way:
//   1. If the server URL changes, you update ONE file
//   2. Error handling is consistent everywhere
//   3. Components stay clean — they just call api.createRoom() instead of
//      manually building fetch requests
//
// This pattern is called a "service layer" — it sits between your UI and the server.

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';

// --- Helper function for making requests ---
// "async/await" is how JavaScript handles operations that take time (like network requests).
// "async" marks a function as asynchronous — it returns a Promise.
// "await" pauses execution until the Promise resolves (until the server responds).
// Without await, the code would keep running before the server answered.
async function request(endpoint, options = {}) {
  const url = `${SERVER_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  };

  // If there's a body (for POST/PUT requests), convert it to a JSON string
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);

  // If the server returned an error status (400, 404, 500, etc.)
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }

  return response.json();
}


// --- Room endpoints ---

export async function createRoom(hostName) {
  return request('/api/rooms', {
    method: 'POST',
    body: { hostName },
  });
}

export async function getRoom(code) {
  return request(`/api/rooms/${code}`);
}


// --- Spotify endpoints ---

export async function getSpotifyLoginURL(roomCode) {
  return request(`/api/spotify/login?roomCode=${roomCode}`);
}

export async function getSpotifyStatus(roomCode) {
  return request(`/api/spotify/status?roomCode=${roomCode}`);
}

export async function searchSpotify(roomCode, query) {
  return request(`/api/spotify/search?roomCode=${roomCode}&q=${encodeURIComponent(query)}`);
}

export async function parseSpotifyLink(roomCode, url) {
  return request('/api/spotify/parse-link', {
    method: 'POST',
    body: { roomCode, url },
  });
}

export async function playOnSpotify(roomCode, spotifyUri) {
  return request('/api/spotify/play', {
    method: 'POST',
    body: { roomCode, spotifyUri },
  });
}

export async function pauseSpotify(roomCode) {
  return request('/api/spotify/pause', {
    method: 'POST',
    body: { roomCode },
  });
}

// --- Apple Music endpoints ---

export async function parseAppleMusicLink(url) {
  return request('/api/apple-music/parse-link', {
    method: 'POST',
    body: { url },
  });
}
