import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../utils/socket';
import * as api from '../utils/api';
import * as musickit from '../utils/musickit';
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
  const { userName, isHost, hostPlatform } = useRoomSession(code);

  const [room, setRoom] = useState(null);
  const [activeTab, setActiveTab] = useState('queue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [progress, setProgress] = useState({ progressMs: 0, durationMs: 0 });
  const appleMusicStartedRef = useRef(false);
  const progressServerRef = useRef({ progressMs: 0, durationMs: 0, receivedAt: 0 });
  const progressIntervalRef = useRef(null);

  // ---- Socket: room connection ----
  useEffect(() => {
    // Re-join on every (re)connect. iOS Safari aggressively suspends WebSockets
    // when the tab loses focus; socket.io auto-reconnects but the new socket
    // isn't in the room anymore, so we must re-emit join-room on each connect.
    const joinRoom = () => {
      socket.emit('join-room', { code, userName });
      if (isHost && hostPlatform === 'apple_music') {
        socket.emit('set-host-platform', { code, platform: 'apple_music' });
      }
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
      joinRoom();
    }

    return () => {
      socket.off('connect', joinRoom);
      socket.off('room-updated', handleRoomUpdated);
      socket.off('error', handleError);
      socket.disconnect();
    };
  }, [code, userName, isHost, hostPlatform]);

  // ---- Apple Music: init MusicKit and handle server-initiated playback ----
  useEffect(() => {
    if (!isHost || hostPlatform !== 'apple_music') return;

    let music = null;

    function handlePlaybackStateChange({ state }) {
      const states = window.MusicKit?.PlaybackStates;
      if (states && state === states.completed) {
        socket.emit('apple-track-ended', { code });
      }
    }

    async function handleApplePlayTrack({ appleMusicId }) {
      appleMusicStartedRef.current = false;
      try {
        await musickit.playTrack(appleMusicId);
        appleMusicStartedRef.current = true;
        socket.emit('apple-play-started', { code });
      } catch (err) {
        setError('Apple Music playback failed. Keep this tab open and try again.');
      }
    }

    async function init() {
      try {
        const { token: devToken } = await api.getAppleMusicDeveloperToken();
        music = await musickit.configureMusicKit(devToken);
        music.addEventListener('playbackStateDidChange', handlePlaybackStateChange);
      } catch (err) {
        console.error('MusicKit init error:', err);
      }
    }

    init();
    socket.on('apple-play-track', handleApplePlayTrack);

    return () => {
      if (music) music.removeEventListener('playbackStateDidChange', handlePlaybackStateChange);
      socket.off('apple-play-track', handleApplePlayTrack);
    };
  }, [code, isHost, hostPlatform]);

  const currentTrackKey = room?.currentTrack?.appleMusicId || room?.currentTrack?.spotifyId;
  const currentTrackUri = room?.currentTrack?.spotifyUri;
  const currentTrackAppleMusicId = room?.currentTrack?.appleMusicId;
  const isPlaying = room?.isPlaying;

  // Reset Apple Music started flag and progress when the current track changes.
  // Initialize durationMs from the track object so the bar appears immediately.
  useEffect(() => {
    appleMusicStartedRef.current = false;
    const dur = room?.currentTrack?.durationMs || 0;
    setProgress({ progressMs: 0, durationMs: dur });
    progressServerRef.current = { progressMs: 0, durationMs: dur, receivedAt: Date.now() };
  }, [currentTrackKey]);

  // Spotify: receive server progress snapshots
  useEffect(() => {
    if (hostPlatform === 'apple_music') return;
    const handleProgress = ({ progressMs, durationMs }) => {
      progressServerRef.current = { progressMs, durationMs, receivedAt: Date.now() };
      setProgress({ progressMs, durationMs });
    };
    socket.on('playback-progress', handleProgress);
    return () => socket.off('playback-progress', handleProgress);
  }, [hostPlatform]);

  // Spotify: interpolate progress forward between server updates
  useEffect(() => {
    if (hostPlatform === 'apple_music') return;
    if (!isPlaying || !currentTrackKey) {
      clearInterval(progressIntervalRef.current);
      return;
    }
    const id = setInterval(() => {
      const { progressMs, durationMs, receivedAt } = progressServerRef.current;
      if (!durationMs) return;
      const interpolated = Math.min(progressMs + (Date.now() - receivedAt), durationMs);
      setProgress({ progressMs: interpolated, durationMs });
    }, 1000);
    progressIntervalRef.current = id;
    return () => clearInterval(id);
  }, [isPlaying, currentTrackKey, hostPlatform]);

  // Apple Music: poll MusicKit player directly (host only)
  useEffect(() => {
    if (!isHost || hostPlatform !== 'apple_music') return;
    if (!isPlaying || !currentTrackKey) {
      clearInterval(progressIntervalRef.current);
      return;
    }
    const id = setInterval(() => {
      const mk = window.MusicKit?.getInstance?.();
      if (!mk) return;
      const progressMs = (mk.player.currentPlaybackTime || 0) * 1000;
      const durationMs = (mk.player.currentPlaybackDuration || 0) * 1000;
      if (durationMs > 0) setProgress({ progressMs, durationMs });
    }, 1000);
    progressIntervalRef.current = id;
    return () => clearInterval(id);
  }, [isHost, hostPlatform, isPlaying, currentTrackKey]);

  const handleAddSong = useCallback((song) => {
    socket.emit('add-song', { code, song: { ...song, addedBy: userName } });
    setActiveTab('queue');
  }, [code, userName]);

  const handleReorder = useCallback((fromIndex, toIndex) => {
    socket.emit('reorder-queue', { code, fromIndex, toIndex });
  }, [code]);

  const handlePlay = useCallback(async () => {
    try {
      if (hostPlatform === 'apple_music') {
        if (!appleMusicStartedRef.current && currentTrackAppleMusicId) {
          // First play of this track: load and start it
          await musickit.playTrack(currentTrackAppleMusicId);
          appleMusicStartedRef.current = true;
        } else {
          await musickit.resumeTrack();
        }
        socket.emit('apple-play-started', { code });
      } else {
        // Omit URI after first play — resending it restarts the track from the beginning.
        const uri = hasStarted ? undefined : currentTrackUri;
        await api.playOnSpotify(code, uri);
        setRoom(prev => prev ? { ...prev, isPlaying: true } : prev);
        setHasStarted(true);
        socket.emit('play-started', { code });
      }
    } catch (err) {
      setError(err.message);
    }
  }, [code, currentTrackUri, currentTrackAppleMusicId, hasStarted, hostPlatform]);

  const handlePause = useCallback(async () => {
    try {
      if (hostPlatform === 'apple_music') {
        await musickit.pauseTrack();
        socket.emit('apple-pause-started', { code });
      } else {
        await api.pauseSpotify(code);
        setRoom(prev => prev ? { ...prev, isPlaying: false } : prev);
        socket.emit('pause-started', { code });
      }
    } catch (err) {
      setError(err.message);
    }
  }, [code, hostPlatform]);

  const handleSkip = useCallback(() => {
    socket.emit('next-song', { code });
  }, [code]);

  const handleBack = useCallback(async () => {
    try {
      if (hostPlatform === 'apple_music') {
        await musickit.seekToStart();
        if (!isPlaying) {
          await musickit.resumeTrack();
          socket.emit('apple-play-started', { code });
        }
      } else {
        await api.playOnSpotify(code, currentTrackUri);
        socket.emit('play-started', { code });
        if (!isPlaying) {
          await api.pauseSpotify(code);
          socket.emit('pause-started', { code });
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [code, currentTrackUri, isPlaying, hostPlatform]);

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
          progress={progress}
        />
      )}

      <div className="tab-content">
        {activeTab === 'queue' && (
          <Queue
            queue={room?.queue || []}
            onAddClick={() => setActiveTab('search')}
            isHost={isHost}
            onReorder={handleReorder}
          />
        )}
        {activeTab === 'search' && (
          <Search
            roomCode={code}
            onAddSong={handleAddSong}
            onTabChange={setActiveTab}
            hostPlatform={hostPlatform}
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
