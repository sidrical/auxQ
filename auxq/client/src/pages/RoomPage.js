// RoomPage.js — The main room experience
//
// NEW HOOKS:
//   useEffect — runs code when a component "mounts" (first appears on screen)
//     or when specific values change. Think of it as "do this when X happens."
//     Example: "when this page loads, connect to the WebSocket"
//
//   useParams — reads URL parameters. If the URL is /room/4821,
//     useParams() returns { code: '4821' }
//
//   useLocation — reads the state we passed from navigate() on the home page
//     (the userName and isHost values)
//
// COMPONENT ARCHITECTURE:
//   This page has sub-components (Queue, Search, PasteLink) that it switches
//   between using tabs. The room data lives HERE and gets passed DOWN to each
//   sub-component as "props" (properties). This pattern is called "lifting state up" —
//   the parent owns the data, children just display it or request changes.

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import socket from '../utils/socket';
import * as api from '../utils/api';
import Queue from '../components/Queue';
import Search from '../components/Search';
import PasteLink from '../components/PasteLink';
import NowPlaying from '../components/NowPlaying';
import '../styles/room.css';
import useDarkMode from '../utils/useDarkMode';

function RoomPage() {
  // --- Read URL params and navigation state ---
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Get the data we passed from the home page
  // Check URL state first, then sessionStorage (survives Spotify redirect), then default
  const userName = location.state?.userName || sessionStorage.getItem(`auxq-name-${code}`) || 'Guest';
  const isHost = location.state?.isHost || sessionStorage.getItem(`auxq-host-${code}`) === 'true' || false;

  // Save to sessionStorage so we survive the Spotify redirect
  if (location.state?.userName) {
    sessionStorage.setItem(`auxq-name-${code}`, location.state.userName);
  }
  if (location.state?.isHost) {
    sessionStorage.setItem(`auxq-host-${code}`, 'true');
  }

  // --- State ---
  const [room, setRoom] = useState(null);
  const [activeTab, setActiveTab] = useState('queue');
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const { theme, toggle } = useDarkMode();

  // --- Connect to room on mount ---
  // useEffect with an empty dependency array [] runs ONCE when the component mounts.
  // This is where we set up our WebSocket connection and join the room.
  useEffect(() => {
  // Re-join on every (re)connect. iOS Safari aggressively suspends WebSockets
  // when the tab loses focus; socket.io auto-reconnects, but the new socket
  // isn't in the room anymore, so server broadcasts wouldn't reach us until
  // we re-emit join-room. Registering this on the 'connect' event covers the
  // initial connect and every reconnect.
  const joinRoom = () => {
    socket.emit('join-room', { code, userName });
  };

  const handleRoomUpdated = (updatedRoom) => {
    setRoom(updatedRoom);
    setLoading(false);
  };

  const handleError = (err) => {
    setError(err.message);
    setLoading(false);
  };

  socket.on('connect', joinRoom);
  socket.on('room-updated', handleRoomUpdated);
  socket.on('error', handleError);

  if (!socket.connected) {
    socket.connect();
  } else {
    // Already connected (e.g., tab was still warm): join immediately since
    // the 'connect' event won't fire again.
    joinRoom();
  }

  return () => {
    socket.off('connect', joinRoom);
    socket.off('room-updated', handleRoomUpdated);
    socket.off('error', handleError);
  };
}, [code, userName]);

  // --- Check Spotify connection status ---
  useEffect(() => {
    if (isHost) {
      api.getSpotifyStatus(code)
        .then(data => setSpotifyConnected(data.connected))
        .catch(() => setSpotifyConnected(false));
    }
  }, [code, isHost]);

  // --- Song added handler ---
  // useCallback is a hook that "memoizes" a function — it remembers the function
  // between renders so it doesn't get recreated every time. This is important
  // when passing functions to child components as props.
  const handleAddSong = useCallback((song) => {
    socket.emit('add-song', {
      code,
      song: {
        ...song,
        addedBy: userName
      }
    });
    // Switch to queue tab to show the newly added song
    setActiveTab('queue');
  }, [code, userName]);

  // --- Playback controls (host only) ---
  const handlePlay = useCallback(async () => {
    try {
      // Only send the URI on the FIRST play of a track. Sending it again
      // would tell Spotify to restart from the beginning.
      // If we've already started, omit the URI so the server resumes from
      // the last playback position.
      const uri = hasStarted ? undefined : room?.currentTrack?.spotifyUri;
      await api.playOnSpotify(code, uri);
      setRoom(prev => prev ? { ...prev, isPlaying: true } : prev);
      setHasStarted(true);
      socket.emit('play-started', { code });
    } catch (err) {
      setError(err.message);
    }
  }, [code, room, hasStarted]);

const handlePause = useCallback(async () => {
  try {
    await api.pauseSpotify(code);
    setRoom(prev => prev ? { ...prev, isPlaying: false } : prev);
    socket.emit('pause-started', { code }); // ← add this
  } catch (err) {
    setError(err.message);
  }
}, [code]);

  const handleSkip = useCallback(async () => {
  try {
    // Tell the server to advance the queue and play the next song.
    // The server's advanceQueue() handles both the Spotify call and room state.
    socket.emit('next-song', { code });
  } catch (err) {
    setError(err.message);
  }
}, [code]);

const handleBack = useCallback(async () => {
  try {
    await api.playOnSpotify(code, room?.currentTrack?.spotifyUri);
    socket.emit('play-started', { code });

    if (!room?.isPlaying) {
      await api.pauseSpotify(code);
      socket.emit('pause-started', { code });
    }
  } catch (err) {
    setError(err.message);
  }
}, [code, room]);

  // --- Connect Spotify (host only) ---
  async function handleConnectSpotify() {
    try {
      const data = await api.getSpotifyLoginURL(code);
      // Redirect the browser to Spotify's login page
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Leave room ---
  function handleLeave() {
    socket.disconnect();
    navigate('/');
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="room-page">
        <div className="loading">Joining room...</div>
      </div>
    );
  }

  // --- Error state ---
  if (error && !room) {
    return (
      <div className="room-page">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-primary" onClick={() => navigate('/')}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="room-page">
      {/* Header */}
      <div className="room-header">
        <div className="room-header-left">
          <h2 className="room-title">
            Room <span className="room-code">{code}</span>
          </h2>
          <div className="room-users">
            {room?.users?.map((user, i) => (
              <span key={i} className="user-pill">
                <span className="user-dot" />
                {user}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="theme-toggle" onClick={toggle}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="leave-btn" onClick={handleLeave}>Leave</button>
        </div>
      </div>

      {/* Spotify connection prompt (host only) */}
      {isHost && !spotifyConnected && (
        <div className="connect-banner">
          <p>Connect Spotify to enable playback</p>
          <button className="connect-btn" onClick={handleConnectSpotify}>
            Connect Spotify
          </button>
        </div>
      )}

      {/* Tab navigation */}
      <div className="tab-bar">
        <button
          className={`tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Queue
        </button>
        <button
          className={`tab ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Search
        </button>
        <button
          className={`tab ${activeTab === 'paste' ? 'active' : ''}`}
          onClick={() => setActiveTab('paste')}
        >
          Paste link
        </button>
      </div>

      {/* Now Playing (visible on queue tab) */}
      {activeTab === 'queue' && room?.currentTrack && (
        <NowPlaying
          track={room.currentTrack}
          isPlaying={room.isPlaying}
          isHost={isHost}
          onPlay={handlePlay}
          onPause={handlePause}
          onSkip={handleSkip}
          onBack={handleBack}
        />
      )}

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 'queue' && (
          <Queue
            queue={room?.queue || []}
            onAddClick={() => setActiveTab('search')}
          />
        )}
        {activeTab === 'search' && (
          <Search
            roomCode={code}
            onAddSong={handleAddSong}
            onTabChange={setActiveTab}
            hostPlatform={spotifyConnected ? 'spotify' : null}
          />
        )}
        {activeTab === 'paste' && (
          <PasteLink
            roomCode={code}
            onAddSong={handleAddSong}
          />
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="error-toast" onClick={() => setError('')}>
          {error}
        </div>
      )}
    </div>
  );
}

export default RoomPage;
