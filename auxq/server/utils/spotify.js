// spotify.js — Handles all communication with Spotify's API
//
// OAuth Flow (how login works):
// 1. User clicks "Login with Spotify" in our app
// 2. We redirect them to Spotify's login page
// 3. They log in and approve our app's permissions
// 4. Spotify redirects them back to our app with a "code"
// 5. We exchange that code for an "access token" — a temporary key that lets us
//    make API calls on behalf of that user
// 6. The access token expires after 1 hour, so we also get a "refresh token"
//    that lets us get a new access token without making the user log in again

// We'll use the built-in 'fetch' for HTTP requests (available in Node 18+)
// and 'querystring' to format URL parameters
const querystring = require('querystring');

// These come from your .env file (which reads from developer.spotify.com)
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3001/api/spotify/callback';

// Scopes define what permissions your app is asking for.
// Think of it like checkboxes on a permission slip.
// We need:
//   - user-read-playback-state: see what's currently playing
//   - user-modify-playback-state: play, pause, skip, queue songs
//   - streaming: required for playback control
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-read-currently-playing',
  'playlist-read-private'
].join(' ');

// Base URL for all Spotify API calls
const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';


// --- Step 1: Generate the login URL ---
// When the host clicks "Login with Spotify", we send them here
function getAuthURL() {
  const params = querystring.stringify({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: true  // Forces the login screen to show every time (useful for testing)
  });

  return `${SPOTIFY_ACCOUNTS}/authorize?${params}`;
}


// --- Step 2: Exchange the code for tokens ---
// After the user logs in, Spotify redirects them back with a "code" in the URL.
// We send that code to Spotify and get back an access token + refresh token.
async function getTokens(code) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // This header sends our Client ID and Secret encoded in Base64.
      // It's how Spotify verifies that WE are who we say we are.
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    },
    body: querystring.stringify({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Spotify auth error: ${data.error_description}`);
  }

  // Returns:
  //   access_token  — the key we use for API calls (expires in 1 hour)
  //   refresh_token — used to get a new access_token without re-logging in
  //   expires_in    — seconds until the access_token expires (usually 3600)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in
  };
}


// --- Step 3: Refresh an expired token ---
// Access tokens expire after 1 hour. Instead of making the user log in again,
// we use the refresh token to silently get a new access token.
async function refreshAccessToken(refreshToken) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    },
    body: querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const data = await response.json();

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in
  };
}


// --- Search for tracks ---
// This is what runs when someone types in the search bar
async function searchTracks(accessToken, query, limit = 10) {
  const params = querystring.stringify({
    q: query,
    type: 'track',
    limit: limit
  });

  const response = await fetch(`${SPOTIFY_API}/search?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Spotify search error: ${data.error.message}`);
  }

  // Transform Spotify's response into a cleaner format for our app
  // This is called "mapping" — we take each track and pull out only what we need
  return data.tracks.items.map(track => ({
    spotifyId: track.id,
    spotifyUri: track.uri,           // "spotify:track:abc123" — needed for playback
    title: track.name,
    artist: track.artists.map(a => a.name).join(', '),  // Some songs have multiple artists
    album: track.album.name,
    albumArt: track.album.images[0]?.url || null,        // The album cover image
    durationMs: track.duration_ms,
    previewUrl: track.preview_url,   // 30-second preview clip (not always available)
    source: 'spotify'
  }));
}


// --- Get available devices ---
async function getDevices(accessToken) {
  const response = await fetch(`${SPOTIFY_API}/me/player/devices`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const data = await response.json();
  return data.devices || [];
}


// --- Play a specific track ---
async function playTrack(accessToken, spotifyUri, storedDeviceId = null) {
  const devices = await getDevices(accessToken);
  const activeDevice = devices.find(d => d.is_active);
  const fallbackDevice = devices[0];
  
  // Use stored device ID if no devices are currently visible
  const deviceId = activeDevice?.id || fallbackDevice?.id || storedDeviceId;

  if (!deviceId) {
    throw new Error('Spotify is sleeping. Switch to Spotify, play anything briefly, then come back.');
  }

  if (!activeDevice && (fallbackDevice || storedDeviceId)) {
    await fetch(`${SPOTIFY_API}/me/player`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ device_ids: [deviceId], play: false })
    });
    await new Promise(r => setTimeout(r, 600));
  }

  const response = await fetch(`${SPOTIFY_API}/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ uris: [spotifyUri] })
  });

  if (response.status === 204) return { success: true };

  const text = await response.text();
  if (!text || text.trim() === '') return { success: true };

  const data = JSON.parse(text);
  const msg = data.error?.message || 'Unknown error';
  if (msg.toLowerCase().includes('bad gateway') || msg.toLowerCase().includes('not found')) {
    throw new Error('Spotify is sleeping. Switch to Spotify, play anything briefly, then come back.');
  }
  throw new Error(`Playback error: ${msg}`);
}

// --- Resume playback ---
// Spotify's play endpoint WITHOUT a `uris` body resumes from the last position.
// (Passing `uris` would restart from 0 — that's playTrack's job.)
async function resumePlayback(accessToken) {
  const devices = await getDevices(accessToken);
  const device = devices.find(d => d.is_active) || devices[0];

  const url = device
    ? `${SPOTIFY_API}/me/player/play?device_id=${device.id}`
    : `${SPOTIFY_API}/me/player/play`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}` }
    // Intentionally no body — omitting `uris` tells Spotify to resume.
  });

  if (response.status === 204) return { success: true };

  const text = await response.text();
  if (!text || text.trim() === '') return { success: true };

  try {
    const data = JSON.parse(text);
    throw new Error(`Resume error: ${data.error?.message || 'Unknown error'}`);
  } catch {
    return { success: true };
  }
}


// --- Pause playback ---
async function pausePlayback(accessToken) {
  const devices = await getDevices(accessToken);
  const device = devices.find(d => d.is_active) || devices[0];

  const url = device
    ? `${SPOTIFY_API}/me/player/pause?device_id=${device.id}`
    : `${SPOTIFY_API}/me/player/pause`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (response.status === 204) return { success: true };

  const text = await response.text();
  if (!text || text.trim() === '') return { success: true };

  try {
    const data = JSON.parse(text);
    throw new Error(`Pause error: ${data.error?.message || 'Unknown error'}`);
  } catch {
    return { success: true };
  }
}

// --- Skip to next track ---
async function skipToNext(accessToken) {
  const response = await fetch(`${SPOTIFY_API}/me/player/next`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (response.status === 204) return { success: true };

  const text = await response.text();
  if (!text || text.trim() === '') return { success: true };

  try {
    const data = JSON.parse(text);
    throw new Error(`Skip error: ${data.error?.message || 'Unknown error'}`);
  } catch {
    return { success: true };
  }
}


// --- Get current playback state ---
async function getPlaybackState(accessToken) {
  const response = await fetch(`${SPOTIFY_API}/me/player`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (response.status === 204) return null;

  const data = await response.json();

  return {
    isPlaying: data.is_playing,
    currentTrack: data.item ? {
      spotifyId: data.item.id,
      title: data.item.name,
      artist: data.item.artists.map(a => a.name).join(', '),
      album: data.item.album.name,
      albumArt: data.item.album.images[0]?.url || null,
      durationMs: data.item.duration_ms,
      progressMs: data.progress_ms
    } : null,
    device: data.device ? {
      id: data.device.id,
      name: data.device.name,
      type: data.device.type
    } : null
  };
}


// --- Parse a Spotify link to get the track ID ---
function parseSpotifyLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'open.spotify.com' && parsed.pathname.startsWith('/track/')) {
      const trackId = parsed.pathname.split('/track/')[1];
      return { type: 'track', id: trackId };
    }
    return null;
  } catch {
    return null;
  }
}


// --- Get track details by ID ---
async function getTrack(accessToken, trackId) {
  const response = await fetch(`${SPOTIFY_API}/tracks/${trackId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  const track = await response.json();

  if (track.error) {
    throw new Error(`Track error: ${track.error.message}`);
  }

  return {
    spotifyId: track.id,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    album: track.album.name,
    albumArt: track.album.images[0]?.url || null,
    durationMs: track.duration_ms,
    source: 'spotify'
  };
}


module.exports = {
  getAuthURL,
  getTokens,
  refreshAccessToken,
  searchTracks,
  playTrack,
  resumePlayback,
  pausePlayback,
  skipToNext,
  getPlaybackState,
  parseSpotifyLink,
  getTrack,
  getDevices,
};