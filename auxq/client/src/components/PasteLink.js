// PasteLink.js — Add songs by pasting a Spotify or Apple Music link
//
// This component detects which platform the link is from and calls the
// appropriate API to look up the track details, then adds it to the queue.

import React, { useState } from 'react';
import * as api from '../utils/api';

function PasteLink({ roomCode, onAddSong }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // Shows track info before adding

  // Detect which platform the URL belongs to
  function detectPlatform(link) {
    if (link.includes('open.spotify.com') || link.includes('spotify.link')) {
      return 'spotify';
    }
    if (link.includes('music.apple.com')) {
      return 'apple_music';
    }
    return null;
  }

  // Look up the track from the pasted link
  async function handleLookup() {
    if (!url.trim()) {
      setError('Paste a link first');
      return;
    }

    const platform = detectPlatform(url.trim());

    if (!platform) {
      setError('Not a valid Spotify or Apple Music link');
      return;
    }

    setLoading(true);
    setError('');
    setPreview(null);

    try {
      let track;

      if (platform === 'spotify') {
        const data = await api.parseSpotifyLink(roomCode, url.trim());
        track = data.track;
      } else {
        const data = await api.parseAppleMusicLink(url.trim());
        track = data.track;
      }

      // Show the track preview so the user can confirm before adding
      setPreview(track);
    } catch (err) {
      setError(err.message || 'Could not find that track');
    } finally {
      setLoading(false);
    }
  }

  // Add the previewed track to the queue
  function handleAdd() {
    if (preview) {
      onAddSong(preview);
      setUrl('');
      setPreview(null);
    }
  }

  return (
    <div className="paste-link">
      <div className="paste-area">
        <div className="paste-icon">🔗</div>
        <p>Paste a Spotify or Apple Music link</p>
      </div>

      <input
        className="input-field"
        placeholder="https://open.spotify.com/track/..."
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError('');
          setPreview(null);
        }}
      />

      {error && <p className="error-text">{error}</p>}

      {/* Track preview — shows up after a successful lookup */}
      {preview && (
        <div className="link-preview">
          <div className="song-artwork">
            {preview.albumArt ? (
              <img src={preview.albumArt} alt="" className="album-art-img" />
            ) : (
              <div className="album-art-placeholder">♪</div>
            )}
          </div>
          <div className="song-info">
            <div className="song-title">{preview.title}</div>
            <div className="song-artist">{preview.artist}</div>
            <span className={`badge ${preview.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
              {preview.source === 'spotify' ? 'Spotify' : 'Apple Music'}
            </span>
          </div>
        </div>
      )}

      {/* Show "Look up" button first, then "Add to queue" after preview loads */}
      {!preview ? (
        <button
          className="btn-primary"
          onClick={handleLookup}
          disabled={loading || !url.trim()}
          style={{ marginTop: 12 }}
        >
          {loading ? 'Looking up...' : 'Look up song'}
        </button>
      ) : (
        <button
          className="btn-primary"
          onClick={handleAdd}
          style={{ marginTop: 12 }}
        >
          Add to queue
        </button>
      )}

      {/* Supported links info */}
      <div className="supported-links">
        <div className="supported-label">Supported links</div>
        <div className="supported-item">open.spotify.com/track/...</div>
        <div className="supported-item">music.apple.com/.../song/...</div>
        <div className="supported-item">music.apple.com/.../album/...?i=...</div>
      </div>
    </div>
  );
}

export default PasteLink;
