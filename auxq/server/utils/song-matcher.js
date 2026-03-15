// song-matcher.js — Cross-platform song matching
//
// This is the secret sauce of your app. When someone adds a song from Apple Music
// but the host is playing through Spotify, we need to find that SAME song on Spotify.
//
// There are two approaches, and we use both:
//
// 1. ISRC Matching (primary method)
//    ISRC = International Standard Recording Code. It's like a social security number
//    for songs. Every song recording has a unique one, and it's the SAME across all
//    platforms. If we know a song's ISRC, we can search for it on any platform.
//    Example: Drake's "God's Plan" has ISRC "USCM51800004" on both Spotify AND Apple Music.
//
// 2. Odesli/Songlink API (fallback)
//    This is a free API that takes a link from one platform and gives you links
//    to the same song on every other platform. We use this when we have a link
//    but not an ISRC, or as a backup when ISRC matching fails.

const querystring = require('querystring');

// Odesli (formerly Songlink) API — free, no auth required
const ODESLI_API = 'https://api.song.link/v1-alpha.1/links';


// --- Method 1: Match via Odesli API ---
// Takes a URL from any platform and returns links for all platforms
async function matchViaOdesli(songUrl) {
  try {
    const params = querystring.stringify({ url: songUrl });
    const response = await fetch(`${ODESLI_API}?${params}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Odesli returns a complex object. Here's what we care about:
    // - linksByPlatform: { spotify: { url: "..." }, appleMusic: { url: "..." }, ... }
    // - entitiesByUniqueId: detailed track info from each platform

    const result = {
      spotify: null,
      appleMusic: null
    };

    // Extract Spotify info
    if (data.linksByPlatform?.spotify) {
      const spotifyData = data.linksByPlatform.spotify;
      // The entityUniqueId points to the full track details
      const entityId = spotifyData.entityUniqueId;
      const entity = data.entitiesByUniqueId?.[entityId];

      result.spotify = {
        url: spotifyData.url,
        id: entity?.id || null,
        // Construct the Spotify URI from the ID
        uri: entity?.id ? `spotify:track:${entity.id}` : null
      };
    }

    // Extract Apple Music info
    if (data.linksByPlatform?.appleMusic) {
      const appleData = data.linksByPlatform.appleMusic;
      const entityId = appleData.entityUniqueId;
      const entity = data.entitiesByUniqueId?.[entityId];

      result.appleMusic = {
        url: appleData.url,
        id: entity?.id || null
      };
    }

    return result;
  } catch (err) {
    console.error('Odesli matching error:', err);
    return null;
  }
}


// --- Method 2: Match via ISRC on Spotify ---
// If we have an ISRC from an Apple Music track, search Spotify for that exact ISRC.
// Spotify's search supports "isrc:" as a filter, which gives us an exact match.
async function matchIsrcOnSpotify(isrc, spotifyAccessToken) {
  if (!isrc || !spotifyAccessToken) return null;

  try {
    const params = querystring.stringify({
      q: `isrc:${isrc}`,
      type: 'track',
      limit: 1
    });

    const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${spotifyAccessToken}`
      }
    });

    const data = await response.json();
    const track = data.tracks?.items?.[0];

    if (!track) return null;

    return {
      spotifyId: track.id,
      spotifyUri: track.uri,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url || null
    };
  } catch (err) {
    console.error('ISRC Spotify match error:', err);
    return null;
  }
}


// --- Main matching function ---
// This is what the rest of your app calls.
// Given a song from one platform, find it on the other.
//
// Parameters:
//   song — the song object (must have at least source + a URL or ISRC)
//   targetPlatform — 'spotify' or 'apple_music'
//   spotifyAccessToken — needed if matching TO Spotify via ISRC
async function findMatch(song, targetPlatform, spotifyAccessToken = null) {
  // If the song is already from the target platform, no matching needed
  if (song.source === targetPlatform) {
    return song;
  }

  // Strategy 1: Try ISRC matching (faster and more accurate)
  if (song.isrc && targetPlatform === 'spotify' && spotifyAccessToken) {
    const match = await matchIsrcOnSpotify(song.isrc, spotifyAccessToken);
    if (match) {
      return {
        ...song,
        spotifyId: match.spotifyId,
        spotifyUri: match.spotifyUri,
        matchedVia: 'isrc'
      };
    }
  }

  // Strategy 2: Try Odesli API (works with URLs from either platform)
  const songUrl = song.appleMusicUrl || song.spotifyUrl ||
    (song.spotifyId ? `https://open.spotify.com/track/${song.spotifyId}` : null) ||
    (song.appleMusicId ? `https://music.apple.com/us/song/${song.appleMusicId}` : null);

  if (songUrl) {
    const match = await matchViaOdesli(songUrl);
    if (match) {
      if (targetPlatform === 'spotify' && match.spotify) {
        return {
          ...song,
          spotifyId: match.spotify.id,
          spotifyUri: match.spotify.uri,
          spotifyUrl: match.spotify.url,
          matchedVia: 'odesli'
        };
      }
      if (targetPlatform === 'apple_music' && match.appleMusic) {
        return {
          ...song,
          appleMusicId: match.appleMusic.id,
          appleMusicUrl: match.appleMusic.url,
          matchedVia: 'odesli'
        };
      }
    }
  }

  // If both strategies fail, return null — we couldn't find a match
  // The app should handle this gracefully (show "song not available on this platform")
  return null;
}


module.exports = {
  matchViaOdesli,
  matchIsrcOnSpotify,
  findMatch
};
