// NowPlaying.js — Displays the currently playing track with controls
//
// CONDITIONAL RENDERING: Notice how the play/pause/skip buttons only show
// when isHost is true. In React, you control what shows up on screen using
// JavaScript expressions inside JSX. The pattern {condition && <Component />}
// only renders the component when the condition is true.

import React from 'react';

function NowPlaying({ track, isPlaying, isHost, onPlay, onPause, onSkip, onBack }) {
  if (!track) return null;

  return (
    <div className="now-playing">
      <div className="now-playing-label">Now playing</div>
      <div className="now-playing-track">
        <div className="song-artwork">
          {track.albumArt ? (
            <img src={track.albumArt} alt="" className="album-art-img" />
          ) : (
            <div className="album-art-placeholder">♪</div>
          )}
        </div>
        <div className="song-info">
          <div className="song-title">{track.title}</div>
          <div className="song-artist">{track.artist}</div>
        </div>
        <span className={`badge ${track.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
          {track.source === 'spotify' ? 'Spotify' : 'Apple'}
        </span>
      </div>

      {/* Host-only playback controls */}
      {isHost && (
        <div className="controls">
          <button className="ctrl-btn" onClick={onBack} title="Restart">
            ⏮
          </button>
          <button
            className="ctrl-btn play-btn"
            onClick={() => isPlaying ? onPause() : onPlay(track.spotifyUri)}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="ctrl-btn" onClick={onSkip} title="Skip">
            ⏭
          </button>
        </div>
      )}

      {/* Non-host users see a simpler status */}
      {!isHost && (
        <div className="playback-status">
          {isPlaying ? '♪ Playing' : '⏸ Paused'}
        </div>
      )}
    </div>
  );
}

export default NowPlaying;
