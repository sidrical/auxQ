// apple-music-routes.js — API endpoints for Apple Music features
//
// Notice this file is much shorter than spotify-routes.js.
// That's because Apple Music playback happens on the frontend (in the browser)
// using MusicKit JS, not through server API calls.
// The server only needs to handle: generating the developer token, searching,
// and parsing links.

const express = require('express');
const router = express.Router();
const appleMusic = require('../utils/apple-music');

// Cache the developer token so we don't regenerate it on every request
let cachedToken = null;
let tokenExpiresAt = 0;

function getDeveloperToken() {
  // Regenerate if expired or within 1 day of expiring
  if (!cachedToken || Date.now() > tokenExpiresAt - 86400000) {
    cachedToken = appleMusic.generateDeveloperToken();
    // Token is valid for 180 days, we'll track that
    tokenExpiresAt = Date.now() + (180 * 24 * 60 * 60 * 1000);
  }
  return cachedToken;
}


// --- Get developer token ---
// The frontend needs this to initialize MusicKit JS.
// This endpoint sends the token to the browser so MusicKit can use it.
router.get('/token', (req, res) => {
  try {
    const token = getDeveloperToken();
    res.json({ token });
  } catch (err) {
    console.error('Token generation error:', err);
    res.status(500).json({ error: 'Apple Music not configured' });
  }
});


// --- Search for tracks ---
router.get('/search', async (req, res) => {
  const { q, storefront } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const token = getDeveloperToken();
    const results = await appleMusic.searchTracks(token, q, 10, storefront || 'us');
    res.json({ results });
  } catch (err) {
    console.error('Apple Music search error:', err);
    res.status(500).json({ error: err.message });
  }
});


// --- Parse and look up a pasted link ---
router.post('/parse-link', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const parsed = appleMusic.parseAppleMusicLink(url);

    if (!parsed) {
      return res.status(400).json({ error: 'Not a valid Apple Music song link' });
    }

    const token = getDeveloperToken();
    const track = await appleMusic.getTrack(token, parsed.id, parsed.storefront);
    res.json({ track });
  } catch (err) {
    console.error('Parse link error:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
