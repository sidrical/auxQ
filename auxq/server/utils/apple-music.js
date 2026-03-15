// apple-music.js — Handles all communication with Apple Music's API
//
// Apple Music authentication works differently from Spotify:
//
// TWO types of tokens:
//   1. Developer Token — identifies YOUR APP to Apple. You generate this yourself
//      using a private key from your Apple Developer account. It's a JWT (JSON Web Token),
//      which is basically a signed string that says "I am the AuxQ app, trust me."
//      Think of it like your app's passport.
//
//   2. Music User Token — identifies THE USER. When the host logs into Apple Music
//      through MusicKit JS in the browser, Apple gives back this token.
//      Think of it like the user's boarding pass.
//
// You need BOTH tokens for most API calls. The developer token proves your app is legit,
// and the user token proves the user gave permission.

// jwt (JSON Web Token) library — used to create the developer token
// You'll need to install this: npm install jsonwebtoken
// We'll add it to package.json
const jwt = require('jsonwebtoken');
const querystring = require('querystring');

// These come from your Apple Developer account
// You get them from developer.apple.com → Certificates, Identifiers & Profiles → Keys
const KEY_ID = process.env.APPLE_MUSIC_KEY_ID;
const TEAM_ID = process.env.APPLE_MUSIC_TEAM_ID;

// The private key file — Apple gives you a .p8 file when you create a MusicKit key.
// You'll store the contents in your .env file.
const PRIVATE_KEY = process.env.APPLE_MUSIC_PRIVATE_KEY;

// Base URL for Apple Music API
const APPLE_MUSIC_API = 'https://api.music.apple.com/v1';


// --- Generate a Developer Token ---
// This creates a JWT signed with your private key.
// Apple's servers verify this signature to confirm the request is from your app.
// The token is valid for up to 6 months, but we'll regenerate it more often.
function generateDeveloperToken() {
  if (!PRIVATE_KEY || !KEY_ID || !TEAM_ID) {
    throw new Error('Apple Music credentials not configured');
  }

  const token = jwt.sign({}, PRIVATE_KEY, {
    algorithm: 'ES256',   // The encryption algorithm Apple requires
    expiresIn: '180d',    // Valid for 180 days
    issuer: TEAM_ID,      // Your Apple Developer Team ID
    header: {
      alg: 'ES256',
      kid: KEY_ID         // Your MusicKit Key ID
    }
  });

  return token;
}


// --- Search for tracks ---
// Similar to Spotify's search, but the response format is different.
// Apple Music uses a "storefront" concept — it's the regional catalog.
// "us" = United States catalog. Songs available vary by country.
async function searchTracks(developerToken, query, limit = 10, storefront = 'us') {
  const params = querystring.stringify({
    term: query,
    types: 'songs',
    limit: limit
  });

  const response = await fetch(
    `${APPLE_MUSIC_API}/catalog/${storefront}/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${developerToken}`
      }
    }
  );

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Apple Music search error: ${data.errors[0].detail}`);
  }

  // Transform Apple's response into our app's format
  // Notice we map it to the same shape as Spotify results — this is important!
  // By using a consistent format, the rest of our app doesn't need to care
  // whether a song came from Spotify or Apple Music.
  const songs = data.results?.songs?.data || [];

  return songs.map(song => ({
    appleMusicId: song.id,
    appleMusicUrl: song.attributes.url,
    title: song.attributes.name,
    artist: song.attributes.artistName,
    album: song.attributes.albumName,
    albumArt: song.attributes.artwork?.url
      // Apple uses a template URL like "{w}x{h}" — we replace with actual dimensions
      ?.replace('{w}', '300')
      ?.replace('{h}', '300') || null,
    durationMs: song.attributes.durationInMillis,
    previewUrl: song.attributes.previews?.[0]?.url || null,
    // ISRC is the International Standard Recording Code — a universal song ID
    // that works across ALL platforms. This is key for cross-platform matching.
    isrc: song.attributes.isrc || null,
    source: 'apple_music'
  }));
}


// --- Get a specific track by ID ---
// Used when someone pastes an Apple Music link
async function getTrack(developerToken, trackId, storefront = 'us') {
  const response = await fetch(
    `${APPLE_MUSIC_API}/catalog/${storefront}/songs/${trackId}`,
    {
      headers: {
        'Authorization': `Bearer ${developerToken}`
      }
    }
  );

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Apple Music track error: ${data.errors[0].detail}`);
  }

  const song = data.data[0];

  return {
    appleMusicId: song.id,
    appleMusicUrl: song.attributes.url,
    title: song.attributes.name,
    artist: song.attributes.artistName,
    album: song.attributes.albumName,
    albumArt: song.attributes.artwork?.url
      ?.replace('{w}', '300')
      ?.replace('{h}', '300') || null,
    durationMs: song.attributes.durationInMillis,
    isrc: song.attributes.isrc || null,
    source: 'apple_music'
  };
}


// --- Parse an Apple Music link ---
// Apple Music links look like:
//   https://music.apple.com/us/album/god-s-plan/1363309866?i=1363310039
//   https://music.apple.com/us/song/gods-plan/1363310039
//
// The ?i= parameter is the song ID within an album link.
// A direct /song/ link has the ID right in the path.
function parseAppleMusicLink(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== 'music.apple.com') {
      return null;
    }

    const pathParts = parsed.pathname.split('/');

    // Direct song link: /us/song/song-name/123456
    if (pathParts.includes('song')) {
      const songIndex = pathParts.indexOf('song');
      const id = pathParts[songIndex + 2]; // The ID comes after the song name
      const storefront = pathParts[1];     // "us", "gb", etc.
      return { type: 'song', id, storefront };
    }

    // Album link with song parameter: /us/album/album-name/123?i=456
    if (pathParts.includes('album')) {
      const songId = parsed.searchParams.get('i');
      const storefront = pathParts[1];

      if (songId) {
        return { type: 'song', id: songId, storefront };
      }

      // If no ?i= parameter, it's just an album link (we only support songs for now)
      return null;
    }

    return null;
  } catch {
    return null;
  }
}


// --- Playback Control ---
// IMPORTANT: Apple Music playback in a web app works differently from Spotify.
// Spotify controls playback on the user's Spotify app/device remotely via API.
// Apple Music uses MusicKit JS which plays audio DIRECTLY in the browser.
//
// This means the host's browser IS the player. The music comes out of the browser,
// not from a separate Apple Music app. This is actually simpler in some ways —
// no need to worry about which device is active. But it means the host needs
// to keep the browser tab open.
//
// Playback control happens on the FRONTEND using MusicKit JS, not through
// server-side API calls. So we don't have play/pause/skip functions here.
// Those will live in the React frontend.


// Export everything
module.exports = {
  generateDeveloperToken,
  searchTracks,
  getTrack,
  parseAppleMusicLink
};
