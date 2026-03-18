// Search.js — Song search functionality
//
// NEW CONCEPT: "Debouncing"
// When a user types in a search box, you don't want to fire an API request
// on EVERY keystroke. If they type "Drake", that's 5 API calls (D, Dr, Dra, Drak, Drake).
// Debouncing means "wait until the user STOPS typing for X milliseconds, then search."
// We're not implementing it here for simplicity, but it's a common optimization
// you'd add later. For now, the user clicks a Search button.

import React, { useState, useEffect } from 'react';
import * as api from '../utils/api';
import socket from '../utils/socket';

function Search({ roomCode, onAddSong, onTabChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addedSongs, setAddedSongs] = useState([]);   // Confirmed adds
  const [pendingSongs, setPendingSongs] = useState([]); // Waiting for server confirmation

  // Listen for server errors on Apple Music song matching.
  // If the server couldn't match a song, remove it from pending so the
  // user can try again — don't leave it stuck in a loading state.
  useEffect(() => {
    function handleError(err) {
      // When a match fails, clear all pending songs so the + buttons
      // become active again and the user can try a different result.
      setPendingSongs([]);
    }

    // Listen for room-updated to confirm a pending Apple Music song was added.
    // We compare the queue length — if it grew, the song made it through.
    function handleRoomUpdated() {
      // On any successful room update, move pending songs to confirmed added.
      // This is safe because the server only emits room-updated after
      // successfully pushing to the queue.
      setPendingSongs(prev => {
        if (prev.length > 0) {
          setAddedSongs(confirmed => [...confirmed, ...prev]);
          return [];
        }
        return prev;
      });
    }

    socket.on('error', handleError);
    socket.on('room-updated', handleRoomUpdated);

    return () => {
      socket.off('error', handleError);
      socket.off('room-updated', handleRoomUpdated);
    };
  }, []);

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

  function handleAdd(song) {
    const songId = song.spotifyId || song.appleMusicId;

    if (song.source === 'spotify') {
      // Spotify songs: optimistically mark as added and switch to queue tab.
      // No matching needed server-side — it'll go straight through.
      setAddedSongs(prev => [...prev, songId]);
      onAddSong(song);
      if (onTabChange) onTabChange('queue');
    } else {
      // Apple Music songs: mark as PENDING (spinner state) and don't switch tabs yet.
      // The server needs to find a Spotify match first — this can fail.
      // We wait for either a room-updated (success) or error (failure) event.
      setPendingSongs(prev => [...prev, songId]);
      onAddSong(song);
      // Don't switch tabs — keep the user here so they can see the error
      // toast if matching fails and try a different result.
    }
  }

  function isAdded(song) {
    const songId = song.spotifyId || song.appleMusicId;
    return addedSongs.includes(songId);
  }

  function isPending(song) {
    const songId = song.spotifyId || song.appleMusicId;
    return pendingSongs.includes(songId);
  }

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
              disabled={isAdded(song) || isPending(song)}
            >
              {isAdded(song) ? '✓' : isPending(song) ? '...' : '+'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helper: Interleave two arrays ---
// Takes [S1, S2, S3] and [A1, A2, A3] and returns [S1, A1, S2, A2, S3, A3]
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
