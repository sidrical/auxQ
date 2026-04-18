import React, { useState, useEffect } from 'react';
import * as api from '../utils/api';
import socket from '../utils/socket';

function Search({ roomCode, onAddSong, onTabChange, hostPlatform }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addedSongs, setAddedSongs] = useState([]);
  const [pendingSongs, setPendingSongs] = useState([]);

  useEffect(() => {
    function handleError() {
      setPendingSongs([]);
    }

    function handleRoomUpdated() {
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
      let results = [];
      if (hostPlatform === 'apple_music') {
        const data = await api.searchAppleMusic(query);
        results = data.results || [];
      } else {
        const data = await api.searchSpotify(roomCode, query).catch(() => ({ results: [] }));
        results = data.results || [];
      }
      setResults(results);
      if (results.length === 0) setError('No results found');
    } catch (err) {
      setError('Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleAdd(song) {
    const songId = song.spotifyId || song.appleMusicId;
    const effectivePlatform = hostPlatform || 'spotify';
    const needsMatching = song.source !== effectivePlatform;

    if (!needsMatching) {
      setAddedSongs(prev => [...prev, songId]);
      onAddSong(song);
      if (onTabChange) onTabChange('queue');
    } else {
      setPendingSongs(prev => [...prev, songId]);
      onAddSong(song);
    }
  }

  function isAdded(song) {
    return addedSongs.includes(song.spotifyId || song.appleMusicId);
  }

  function isPending(song) {
    return pendingSongs.includes(song.spotifyId || song.appleMusicId);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSearch();
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

export default Search;
