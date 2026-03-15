// Search.js — Song search functionality
//
// NEW CONCEPT: "Debouncing"
// When a user types in a search box, you don't want to fire an API request
// on EVERY keystroke. If they type "Drake", that's 5 API calls (D, Dr, Dra, Drak, Drake).
// Debouncing means "wait until the user STOPS typing for X milliseconds, then search."
// We're not implementing it here for simplicity, but it's a common optimization
// you'd add later. For now, the user clicks a Search button.

import React, { useState } from 'react';
import * as api from '../utils/api';

function Search({ roomCode, onAddSong }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addedSongs, setAddedSongs] = useState([]); // Track which songs were added

  async function handleSearch() {
    if (!query.trim()) return;

    setLoading(true);
    setError('');

    try {
      // Search both platforms simultaneously using Promise.all
      // This fires both requests at the same time instead of waiting for one to finish
      // before starting the other. Much faster.
      const [spotifyData, appleMusicData] = await Promise.all([
        api.searchSpotify(roomCode, query).catch(() => ({ results: [] })),
        api.searchAppleMusic(query).catch(() => ({ results: [] }))
      ]);

      // Combine and interleave results from both platforms
      // This gives the user a mix instead of all Spotify then all Apple Music
      const combined = interleaveResults(
        spotifyData.results || [],
        appleMusicData.results || []
      );

      setResults(combined);

      if (combined.length === 0) {
        setError('No results found');
      }
    } catch (err) {
      setError('Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  // Handle adding a song to the queue
  function handleAdd(song) {
    onAddSong(song);
    // Mark this song as added so we can show visual feedback
    setAddedSongs(prev => [...prev, song.spotifyId || song.appleMusicId]);
  }

  // Check if a song has already been added
  function isAdded(song) {
    return addedSongs.includes(song.spotifyId || song.appleMusicId);
  }

  // Handle Enter key in search box
  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }

  return (
    <div className="search">
      <div className="search-row">
        <input
          className="input-field"
          placeholder="Search for a song..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="search-btn"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? '...' : 'Search'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="search-results">
        {results.map((song, index) => (
          <div className="search-result" key={`${song.source}-${song.spotifyId || song.appleMusicId}-${index}`}>
            <div className="song-artwork">
              {song.albumArt ? (
                <img src={song.albumArt} alt="" className="album-art-img" />
              ) : (
                <div className="album-art-placeholder">♪</div>
              )}
            </div>
            <div className="song-info">
              <div className="song-title">{song.title}</div>
              <div className="song-artist">{song.artist}</div>
              <span className={`badge ${song.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
                {song.source === 'spotify' ? 'Spotify' : 'Apple Music'}
              </span>
            </div>
            <button
              className={`add-btn ${isAdded(song) ? 'added' : ''}`}
              onClick={() => handleAdd(song)}
              disabled={isAdded(song)}
            >
              {isAdded(song) ? '✓' : '+'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helper: Interleave two arrays ---
// Takes [S1, S2, S3] and [A1, A2, A3] and returns [S1, A1, S2, A2, S3, A3]
// This gives the user a balanced mix of results from both platforms.
function interleaveResults(arr1, arr2) {
  const result = [];
  const maxLen = Math.max(arr1.length, arr2.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < arr1.length) result.push(arr1[i]);
    if (i < arr2.length) result.push(arr2[i]);
  }

  return result;
}

export default Search;
