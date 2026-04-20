const express = require('express');
const router = express.Router();
const spotify = require('../utils/spotify');
const User = require('../models/User');
const Room = require('../models/Room');
const { optionalToken, verifyToken } = require('../middleware/auth');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';


router.get('/login', optionalToken, (req, res) => {
  const { roomCode } = req.query;
  if (!roomCode) return res.status(400).json({ error: 'Room code is required' });

  const authURL = spotify.getAuthURL();
  const state = req.user ? `${roomCode}|${req.user.id}` : roomCode;
  res.json({ url: `${authURL}&state=${encodeURIComponent(state)}` });
});


router.get('/callback', async (req, res) => {
  const { code, state: rawState, error } = req.query;

  if (error) return res.redirect(`${clientUrl}/?error=spotify_denied`);
  if (!code || !rawState) return res.redirect(`${clientUrl}/?error=missing_params`);

  const [roomCode, userId] = rawState.split('|');

  try {
    const tokens = await spotify.getTokens(code);

    if (roomCode === 'account') {
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          spotify: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + (tokens.expiresIn * 1000)
          }
        });
      }
      return res.redirect(`${clientUrl}/account?spotify=connected`);
    }

    const room = await Room.findOne({ code: roomCode });
    if (!room) return res.redirect(`${clientUrl}/?error=room_not_found`);

    room.spotifyAccessToken = tokens.accessToken;
    room.spotifyRefreshToken = tokens.refreshToken;
    room.spotifyExpiresAt = Date.now() + (tokens.expiresIn * 1000);
    room.spotifyDeviceId = null;

    try {
      const devices = await spotify.getDevices(tokens.accessToken);
      const device = devices.find(d => d.is_active) || devices[0];
      if (device) {
        room.spotifyDeviceId = device.id;
        console.log(`[Spotify] Captured device ID for room ${roomCode}: ${device.name}`);
      }
    } catch (err) {
      console.log('[Spotify] Could not capture device ID at login:', err.message);
    }

    await room.save();

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


async function getValidToken(roomCode, existingRoom = null) {
  const room = existingRoom || await Room.findOne({ code: roomCode });

  if (!room || !room.spotifyRefreshToken) {
    throw new Error('Host not connected to Spotify');
  }

  if (Date.now() > room.spotifyExpiresAt - 60000) {
    const newTokens = await spotify.refreshAccessToken(room.spotifyRefreshToken);
    room.spotifyAccessToken = newTokens.accessToken;
    room.spotifyExpiresAt = Date.now() + (newTokens.expiresIn * 1000);
    await room.save();
  }

  return room.spotifyAccessToken;
}


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


router.post('/play', async (req, res) => {
  const { roomCode, spotifyUri } = req.body;

  if (!roomCode) {
    return res.status(400).json({ error: 'Room code is required' });
  }

  try {
    const room = await Room.findOne({ code: roomCode });
    const token = await getValidToken(roomCode, room);

    const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const devicesData = await devicesRes.json();
    const devices = devicesData.devices || [];

    const activeDevice = devices.find(d => d.is_active);
    const fallbackDevice = devices[0];

    if (!activeDevice && !fallbackDevice) {
      return res.status(404).json({ error: 'No Spotify device found. Open Spotify on any device first.' });
    }

    if (!activeDevice && fallbackDevice) {
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_ids: [fallbackDevice.id], play: false })
      });
      await new Promise(r => setTimeout(r, 600));
    }

    if (spotifyUri) {
      await spotify.playTrack(token, spotifyUri, room?.spotifyDeviceId);
    } else {
      await spotify.resumePlayback(token);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Play error:', err);
    res.status(500).json({ error: err.message });
  }
});


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


router.get('/status', async (req, res) => {
  const { roomCode } = req.query;
  try {
    const room = await Room.findOne({ code: roomCode });
    res.json({ connected: !!(room && room.spotifyRefreshToken) });
  } catch {
    res.json({ connected: false });
  }
});


router.post('/restore-session', verifyToken, async (req, res) => {
  const { roomCode } = req.body;
  if (!roomCode) return res.status(400).json({ error: 'Room code is required' });

  try {
    const user = await User.findById(req.user.id);
    if (!user?.spotify?.refreshToken) {
      return res.status(404).json({ error: 'No Spotify account linked' });
    }

    let { accessToken, refreshToken, expiresAt } = user.spotify;

    if (Date.now() > expiresAt - 60000) {
      const newTokens = await spotify.refreshAccessToken(refreshToken);
      accessToken = newTokens.accessToken;
      expiresAt = Date.now() + (newTokens.expiresIn * 1000);
      await User.findByIdAndUpdate(req.user.id, {
        'spotify.accessToken': accessToken,
        'spotify.expiresAt': expiresAt
      });
    }

    const room = await Room.findOne({ code: roomCode });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    room.spotifyAccessToken = accessToken;
    room.spotifyRefreshToken = refreshToken;
    room.spotifyExpiresAt = expiresAt;
    room.spotifyDeviceId = null;

    try {
      const devices = await spotify.getDevices(accessToken);
      const device = devices.find(d => d.is_active) || devices[0];
      if (device) {
        room.spotifyDeviceId = device.id;
        console.log(`[Spotify] Restored session for room ${roomCode}: ${device.name}`);
      }
    } catch {
      console.log(`[Spotify] Restored session for room ${roomCode} (no active device yet)`);
    }

    await room.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Restore session error:', err);
    res.status(500).json({ error: 'Could not restore Spotify session' });
  }
});


module.exports = router;
module.exports.getValidToken = getValidToken;
