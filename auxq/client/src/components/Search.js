import React, { useState, useEffect } from 'react';
import * as api from '../utils/api';
import socket from '../utils/socket';
import { isLoggedIn } from '../utils/auth';

function Search({ roomCode, onAddSong, onTabChange, hostPlatform, userName }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addedSongs, setAddedSongs] = useState([]);
  const [pendingSongs, setPendingSongs] = useState([]);

  const [searchMode, setSearchMode] = useState('songs');
  const [playlists, setPlaylists] = useState([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsNeedReconnect, setPlaylistsNeedReconnect] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);
  const [playlistQueued, setPlaylistQueued] = useState(false);

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

  useEffect(() => {
    if (searchMode !== 'playlists' || playlists.length > 0) return;

    async function loadPlaylists() {
      setPlaylistsLoading(true);
      setError('');
      setPlaylistsNeedReconnect(false);
      try {
        const data = await api.getSpotifyPlaylists(roomCode);
        setPlaylists(data.playlists || []);
      } catch (err) {
        if (err.message?.includes('Forbidden') || err.message?.includes('403')) {
          setPlaylistsNeedReconnect(true);
        } else {
          setError('Failed to load playlists');
        }
      } finally {
        setPlaylistsLoading(false);
      }
    }

    loadPlaylists();
  }, [searchMode, roomCode, playlists.length]);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      let res = [];
      if (hostPlatform === 'apple_music') {
        const data = await api.searchAppleMusic(query);
        res = data.results || [];
      } else {
        const data = await api.searchSpotify(roomCode, query).catch(() => ({ results: [] }));
        res = data.results || [];
      }
      setResults(res);
      if (res.length === 0) setError('No results found');
    } catch {
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

  async function handleSelectPlaylist(playlist) {
    setSelectedPlaylist(playlist);
    setPlaylistTracksLoading(true);
    setPlaylistQueued(false);
    setError('');
    try {
      const data = await api.getPlaylistTracks(roomCode, playlist.id);
      setPlaylistTracks(data.tracks || []);
    } catch {
      setError('Failed to load playlist tracks');
    } finally {
      setPlaylistTracksLoading(false);
    }
  }

  function handleQueuePlaylist() {
    socket.emit('queue-playlist', {
      roomCode,
      songs: playlistTracks,
      playlistName: selectedPlaylist.name,
      addedBy: userName || 'Anonymous'
    });
    setPlaylistQueued(true);
    if (onTabChange) onTabChange('queue');
  }

  function handleSwitchMode(mode) {
    setSearchMode(mode);
    setSelectedPlaylist(null);
    setError('');
  }

  async function handleReconnectSpotify() {
    try {
      const data = await api.getSpotifyLoginURL(roomCode);
      window.location.href = data.url;
    } catch {
      setError('Could not reach Spotify. Try again.');
    }
  }

  return (
    <div className="search">
      {hostPlatform === 'spotify' && (
        <div className="search-mode-toggle">
          <button
            className={`mode-btn${searchMode === 'songs' ? ' active' : ''}`}
            onClick={() => handleSwitchMode('songs')}
          >
            Songs
          </button>
          <button
            className={`mode-btn${searchMode === 'playlists' ? ' active' : ''}`}
            onClick={() => handleSwitchMode('playlists')}
          >
            Playlists
          </button>
        </div>
      )}

      {searchMode === 'songs' && (
        <>
          <div className="search-row">
            <input
              className="input-field"
              placeholder="Search for a song..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="search-btn" onClick={handleSearch} disabled={loading}>
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
        </>
      )}

      {searchMode === 'playlists' && (
        <>
          {selectedPlaylist ? (
            <div className="playlist-detail">
              <div className="playlist-detail-header">
                <button className="back-btn" onClick={() => setSelectedPlaylist(null)}>← Back</button>
                <div className="playlist-detail-meta">
                  {selectedPlaylist.imageUrl && (
                    <img src={selectedPlaylist.imageUrl} alt="" className="playlist-detail-art" />
                  )}
                  <div>
                    <div className="playlist-detail-name">{selectedPlaylist.name}</div>
                    <div className="song-artist">{selectedPlaylist.trackCount} tracks</div>
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={handleQueuePlaylist}
                  disabled={playlistTracksLoading || playlistTracks.length === 0 || playlistQueued}
                  style={{ marginTop: 12, width: '100%' }}
                >
                  {playlistQueued ? '✓ Queued' : 'Queue Playlist (Shuffle)'}
                </button>
              </div>

              {error && <p className="error-text">{error}</p>}

              {playlistTracksLoading ? (
                <p className="loading-text">Loading tracks...</p>
              ) : (
                <div className="search-results">
                  {playlistTracks.map((song, index) => (
                    <div className="search-result" key={`${song.spotifyId}-${index}`}>
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="playlist-grid-container">
              {playlistsNeedReconnect ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <p className="error-text" style={{ marginBottom: 16 }}>
                    Spotify needs additional permissions to read playlists.
                  </p>
                  <button className="btn-primary" onClick={handleReconnectSpotify}>
                    Reconnect Spotify
                  </button>
                </div>
              ) : error ? (
                <p className="error-text">{error}</p>
              ) : playlistsLoading ? (
                <p className="loading-text">Loading playlists...</p>
              ) : (
                <div className="playlist-grid">
                  {playlists.map(playlist => (
                    <div
                      className="playlist-card"
                      key={playlist.id}
                      onClick={() => handleSelectPlaylist(playlist)}
                    >
                      <div className="playlist-card-art">
                        {playlist.imageUrl ? (
                          <img src={playlist.imageUrl} alt="" className="playlist-art-img" />
                        ) : (
                          <div className="playlist-art-placeholder">♪</div>
                        )}
                      </div>
                      <div className="playlist-card-name">{playlist.name}</div>
                      <div className="playlist-card-count">{playlist.trackCount} songs</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Search;
