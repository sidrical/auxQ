// spotify-routes.js — Defines the URL endpoints for Spotify features
//
// "Routes" are like a phone directory for your API.
// When the frontend calls GET /api/spotify/login, Express looks it up here
// and runs the matching function.

const express = require('express');
const router = express.Router();
const spotify = require('../utils/spotify');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

// We'll store host tokens in memory for now, keyed by room code.
// In production, you'd store these more securely.
// This object looks like: { "4821": { accessToken: "...", refreshToken: "...", expiresAt: 123456 } }
const hostTokens = {};


// --- Login: Redirect host to Spotify's login page ---
// The frontend calls this when the host clicks "Login with Spotify"
router.get('/login', (req, res) => {
  // req.query is how you read URL parameters
  // Example: /api/spotify/login?roomCode=4821 → req.query.roomCode is "4821"
  const { roomCode } = req.query;

  if (!roomCode) {
    return res.status(400).json({ error: 'Room code is required' });
  }

  // Get the Spotify authorization URL and send it back to the frontend
  // The frontend will redirect the user's browser to this URL
  const authURL = spotify.getAuthURL();

  // We append our room code to Spotify's "state" parameter.
  // "state" is a value that Spotify sends back to us unchanged after login.
  // We use it to remember which room this login is for.
  res.json({ url: `${authURL}&state=${roomCode}` });
});


// --- Callback: Spotify redirects here after the user logs in ---
// This is the REDIRECT_URI we registered on Spotify's dashboard.
// Spotify adds ?code=xxx&state=roomCode to the URL when redirecting back.
router.get('/callback', async (req, res) => {
  const { code, state: roomCode, error } = req.query;

  // If the user denied permission
  if (error) {
    return res.redirect(`${clientUrl}/?error=spotify_denied`);
}

  if (!code || !roomCode) {
    return res.redirect(`${clientUrl}/?error=missing_params`);
}

  try {
    // Exchange the authorization code for access + refresh tokens
    const tokens = await spotify.getTokens(code);

    // Store the tokens for this room's host
    hostTokens[roomCode] = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + (tokens.expiresIn * 1000),
      deviceId: null
    };

    // Try to capture the device ID right away while Spotify is active
    try {
      const devices = await spotify.getDevices(tokens.accessToken);
      const device = devices.find(d => d.is_active) || devices[0];
      if (device) {
        hostTokens[roomCode].deviceId = device.id;
        console.log(`[Spotify] Captured device ID for room ${roomCode}: ${device.name}`);
      }
    } catch (err) {
      console.log('[Spotify] Could not capture device ID at login:', err.message);
    }

    // Redirect the host back to their room in the app
    res.redirect(`${clientUrl}/room/${roomCode}?spotify=connected`);
  } catch (err) {
    console.error('Spotify callback error:', err);
    res.redirect(`${clientUrl}/room/${roomCode}?error=spotify_auth_failed`);
  }
});


// --- Helper: Get a valid access token for a room ---
// This checks if the token is expired and refreshes it automatically.
// We call this before every API request to make sure our token is still good.
async function getValidToken(roomCode) {
  const tokenData = hostTokens[roomCode];

  if (!tokenData) {
    throw new Error('Host not connected to Spotify');
  }

  // If the token expires within the next 60 seconds, refresh it
  if (Date.now() > tokenData.expiresAt - 60000) {
    const newTokens = await spotify.refreshAccessToken(tokenData.refreshToken);
    tokenData.accessToken = newTokens.accessToken;
    tokenData.expiresAt = Date.now() + (newTokens.expiresIn * 1000);
  }

  return tokenData.accessToken;
}


// --- Search for tracks ---
router.get('/search', async (req, res) => {
  const { roomCode, q } = req.query;

  if (!roomCode || !q) {
    return res.status(400).json({ error: 'Room code and search query are required' });
  }

  try {
    const token = await getValidToken(roomCode);
    const results = await spotify.searchTracks(token, q);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Add to queue ---
router.post('/queue', async (req, res) => {
  const { roomCode, spotifyUri } = req.body;

  if (!roomCode || !spotifyUri) {
    return res.status(400).json({ error: 'Room code and Spotify URI are required' });
  }

  try {
    const token = await getValidToken(roomCode);
    await spotify.addToQueue(token, spotifyUri);
    res.json({ success: true });
  } catch (err) {
    console.error('Queue error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Play ---
router.post('/play', async (req, res) => {
  const { roomCode, spotifyUri } = req.body;

  if (!roomCode) {
    return res.status(400).json({ error: 'Room code is required' });
  }

  try {
    const token = await getValidToken(roomCode);

    // Step 1: Get available devices
    const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const devicesData = await devicesRes.json();
    const devices = devicesData.devices || [];


    // Step 2: Find an active device, or fall back to any available one
    const activeDevice = devices.find(d => d.is_active);
    const fallbackDevice = devices[0];

    if (!activeDevice && !fallbackDevice) {
      // No devices at all — Spotify isn't open anywhere
      return res.status(404).json({ error: 'No Spotify device found. Open Spotify on any device first.' });
    }

    // Step 3: If no device is active, transfer playback to wake it up
    if (!activeDevice && fallbackDevice) {
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_ids: [fallbackDevice.id], play: false })
      });
      // Give Spotify 600ms to register the transfer before we send play
      await new Promise(r => setTimeout(r, 600));
    }

    // Step 4: Now play
    if (spotifyUri) {
      await spotify.playTrack(token, spotifyUri, hostTokens[roomCode]?.deviceId);
    } else {
      // resume...
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Play error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Pause ---
router.post('/pause', async (req, res) => {
  const { roomCode } = req.body;

  try {
    const token = await getValidToken(roomCode);
    await spotify.pausePlayback(token);
    res.json({ success: true });
  } catch (err) {
    console.error('Pause error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Skip ---
router.post('/skip', async (req, res) => {
  const { roomCode, spotifyUri } = req.body;

  try {
    const token = await getValidToken(roomCode);
    
    if (spotifyUri) {
      // Play the next song directly instead of using Spotify's skip
      await spotify.playTrack(token, spotifyUri);
    } else {
      await spotify.skipToNext(token);
    }
    
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not valid JSON') || err.message.includes('unexpected')) {
      return res.json({ success: true });
    }
    console.error('Skip error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Get playback state ---
router.get('/playback', async (req, res) => {
  const { roomCode } = req.query;

  try {
    const token = await getValidToken(roomCode);
    const state = await spotify.getPlaybackState(token);
    res.json({ state });
  } catch (err) {
    console.error('Playback state error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Parse and look up a pasted link ---
router.post('/parse-link', async (req, res) => {
  const { roomCode, url } = req.body;

  if (!roomCode || !url) {
    return res.status(400).json({ error: 'Room code and URL are required' });
  }

  try {
    const parsed = spotify.parseSpotifyLink(url);

    if (!parsed) {
      return res.status(400).json({ error: 'Not a valid Spotify track link' });
    }

    const token = await getValidToken(roomCode);
    const track = await spotify.getTrack(token, parsed.id);
    res.json({ track });
  } catch (err) {
    console.error('Parse link error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Check if host is connected to Spotify ---
router.get('/status', (req, res) => {
  const { roomCode } = req.query;
  const isConnected = !!hostTokens[roomCode];
  res.json({ connected: isConnected });
});


module.exports = router;
module.exports.getValidToken = getValidToken;