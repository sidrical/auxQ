import React from 'react';

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function NowPlaying({ track, isPlaying, isHost, onPlay, onPause, onSkip, onBack, progress }) {
  if (!track) return null;

  const showProgress = progress && progress.durationMs > 0;
  const fillPct = showProgress
    ? Math.min((progress.progressMs / progress.durationMs) * 100, 100)
    : 0;

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

      {showProgress && (
        <div className="progress-container">
          <span className="progress-time">{formatTime(progress.progressMs)}</span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <span className="progress-time">{formatTime(progress.durationMs)}</span>
        </div>
      )}

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

      {!isHost && (
        <div className="playback-status">
          {isPlaying ? '♪ Playing' : '⏸ Paused'}
        </div>
      )}
    </div>
  );
}

export default NowPlaying;
