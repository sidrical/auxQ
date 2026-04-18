import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../utils/socket';
import * as api from '../utils/api';
import Queue from '../components/Queue';
import Search from '../components/Search';
import PasteLink from '../components/PasteLink';
import NowPlaying from '../components/NowPlaying';
import useRoomSession from '../utils/useRoomSession';
import '../styles/room.css';

const TABS = [
  { key: 'queue', label: 'Queue' },
  { key: 'search', label: 'Search' },
  { key: 'paste', label: 'Paste link' },
];

function RoomPage({ theme, toggleTheme: toggle }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const { userName, isHost } = useRoomSession(code);

  const [room, setRoom] = useState(null);
  const [activeTab, setActiveTab] = useState('queue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    // Re-join on every (re)connect. iOS Safari aggressively suspends WebSockets
    // when the tab loses focus; socket.io auto-reconnects but the new socket
    // isn't in the room anymore, so we must re-emit join-room on each connect.
    const joinRoom = () => socket.emit('join-room', { code, userName });

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
      joinRoom();
    }

    return () => {
      socket.off('connect', joinRoom);
      socket.off('room-updated', handleRoomUpdated);
      socket.off('error', handleError);
      socket.disconnect();
    };
  }, [code, userName]);

  const handleAddSong = useCallback((song) => {
    socket.emit('add-song', { code, song: { ...song, addedBy: userName } });
    setActiveTab('queue');
  }, [code, userName]);

  const currentTrackUri = room?.currentTrack?.spotifyUri;
  const isPlaying = room?.isPlaying;

  const handlePlay = useCallback(async () => {
    try {
      // Omit the URI after first play — resending it restarts the track from the beginning.
      const uri = hasStarted ? undefined : currentTrackUri;
      await api.playOnSpotify(code, uri);
      setRoom(prev => prev ? { ...prev, isPlaying: true } : prev);
      setHasStarted(true);
      socket.emit('play-started', { code });
    } catch (err) {
      setError(err.message);
    }
  }, [code, currentTrackUri, hasStarted]);

  const handlePause = useCallback(async () => {
    try {
      await api.pauseSpotify(code);
      setRoom(prev => prev ? { ...prev, isPlaying: false } : prev);
      socket.emit('pause-started', { code });
    } catch (err) {
      setError(err.message);
    }
  }, [code]);

  const handleSkip = useCallback(() => {
    socket.emit('next-song', { code });
  }, [code]);

  const handleBack = useCallback(async () => {
    try {
      await api.playOnSpotify(code, currentTrackUri);
      socket.emit('play-started', { code });
      if (!isPlaying) {
        await api.pauseSpotify(code);
        socket.emit('pause-started', { code });
      }
    } catch (err) {
      setError(err.message);
    }
  }, [code, currentTrackUri, isPlaying]);

  function handleLeave() {
    socket.disconnect();
    navigate('/');
  }

  if (loading) {
    return (
      <div className="room-page">
        <div className="loading">Joining room...</div>
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className="room-page">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-primary" onClick={() => navigate('/')}>Go home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page">
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
        <div className="room-header-right">
          <button className="theme-toggle" onClick={toggle}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="leave-btn" onClick={handleLeave}>Leave</button>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`tab ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

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
          />
        )}
        {activeTab === 'paste' && (
          <PasteLink
            roomCode={code}
            onAddSong={handleAddSong}
          />
        )}
      </div>

      {error && (
        <div className="error-toast" onClick={() => setError('')}>
          {error}
        </div>
      )}
    </div>
  );
}

export default RoomPage;
