// spotify-routes.js — Defines the URL endpoints for Spotify features
//
// "Routes" are like a phone directory for your API.
// When the frontend calls GET /api/spotify/login, Express looks it up here
// and runs the matching function.

const express = require('express');
const router = express.Router();
const spotify = require('../utils/spotify');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { optionalToken, verifyToken } = require('../middleware/auth');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

// We'll store host tokens in memory for now, keyed by room code.
// In production, you'd store these more securely.
// This object looks like: { "4821": { accessToken: "...", refreshToken: "...", expiresAt: 123456 } }
const hostTokens = {};


// --- Login: Redirect host to Spotify's login page ---
router.get('/login', optionalToken, (req, res) => {
  const { roomCode } = req.query;
  if (!roomCode) return res.status(400).json({ error: 'Room code is required' });

  const authURL = spotify.getAuthURL();

  // Encode state as "roomCode|userId" when the user is logged in, otherwise just "roomCode"
  const state = req.user ? `${roomCode}|${req.user.id}` : roomCode;
  res.json({ url: `${authURL}&state=${encodeURIComponent(state)}` });
});


// --- Callback: Spotify redirects here after the user logs in ---
router.get('/callback', async (req, res) => {
  const { code, state: rawState, error } = req.query;

  if (error) return res.redirect(`${clientUrl}/?error=spotify_denied`);
  if (!code || !rawState) return res.redirect(`${clientUrl}/?error=missing_params`);

  // State is either "roomCode" (guest) or "roomCode|userId" (logged-in user)
  const [roomCode, userId] = rawState.split('|');

  try {
    const tokens = await spotify.getTokens(code);

    hostTokens[roomCode] = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + (tokens.expiresIn * 1000),
      deviceId: null
    };

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

    // Persist tokens to the user's account if they were logged in
    if (userId) {
      try {
        await User.findByIdAndUpdate(userId, {
          spotify: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + (tokens.expiresIn * 1000)
          }
        });
        console.log(`[Spotify] Saved tokens to account for user ${userId}`);
      } catch (err) {
        console.error('[Spotify] Could not save tokens to user account:', err.message);
      }
    }

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
    // If a URI is provided, start that track from the beginning.
    // If no URI is provided, resume the currently loaded track from its last position.
    if (spotifyUri) {
      await spotify.playTrack(token, spotifyUri, hostTokens[roomCode]?.deviceId);
    } else {
      await spotify.resumePlayback(token);
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


// --- Restore saved Spotify tokens for a new room session ---
// Called when a logged-in user with saved tokens creates a room,
// so they skip the OAuth flow entirely.
router.post('/restore-session', verifyToken, async (req, res) => {
  const { roomCode } = req.body;
  if (!roomCode) return res.status(400).json({ error: 'Room code is required' });

  try {
    const user = await User.findById(req.user.id);
    if (!user?.spotify?.refreshToken) {
      return res.status(404).json({ error: 'No Spotify account linked' });
    }

    let { accessToken, refreshToken, expiresAt } = user.spotify;

    // Refresh the access token if it's expired or about to expire
    if (Date.now() > expiresAt - 60000) {
      const newTokens = await spotify.refreshAccessToken(refreshToken);
      accessToken = newTokens.accessToken;
      expiresAt = Date.now() + (newTokens.expiresIn * 1000);
      await User.findByIdAndUpdate(req.user.id, {
        'spotify.accessToken': accessToken,
        'spotify.expiresAt': expiresAt
      });
    }

    hostTokens[roomCode] = { accessToken, refreshToken, expiresAt, deviceId: null };

    try {
      const devices = await spotify.getDevices(accessToken);
      const device = devices.find(d => d.is_active) || devices[0];
      if (device) {
        hostTokens[roomCode].deviceId = device.id;
        console.log(`[Spotify] Restored session for room ${roomCode}: ${device.name}`);
      }
    } catch {
      console.log(`[Spotify] Restored session for room ${roomCode} (no active device yet)`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Restore session error:', err);
    res.status(500).json({ error: 'Could not restore Spotify session' });
  }
});


module.exports = router;
module.exports.getValidToken = getValidToken;