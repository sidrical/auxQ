// Queue.js — Displays the song queue
//
// PROPS: When a parent component renders a child like <Queue queue={[...]} />,
// those values (queue, onAddClick) are called "props" — short for properties.
// They're how data flows DOWN from parent to child in React.
// Props are READ-ONLY — a child should never modify its props directly.
// If the child needs to change something, it calls a function that the parent
// passed down (like onAddClick), and the parent updates its own state.
// This one-way data flow is a core React principle.

import React from 'react';

function Queue({ queue, onAddClick }) {
  // If the queue is empty, show a helpful message
  if (queue.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎵</div>
        <h3>Queue is empty</h3>
        <p>Add songs to get the party started</p>
        <button className="btn-primary" onClick={onAddClick} style={{ marginTop: 16 }}>
          + Add a song
        </button>
      </div>
    );
  }

  return (
    <div className="queue">
      {/* .map() is how you render a list in React.
          It takes each item in the array and returns JSX for it.
          The "key" prop is required — React uses it to efficiently track
          which items changed when the list updates. Use a unique ID, not the index. */}
      {queue.slice(1).map((song, index) => (
        <div className="queue-item" key={song.id}>
          <div className="queue-number">{index + 1}</div>
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
            <div className="song-meta">
              Added by {song.addedBy}
              <span className={`badge ${song.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
                {song.source === 'spotify' ? 'Spotify' : 'Apple'}
              </span>
            </div>
          </div>
        </div>
      ))}

      <div style={{ padding: '16px 0' }}>
        <button className="btn-primary" onClick={onAddClick}>
          + Add a song
        </button>
      </div>
    </div>
  );
}

export default Queue;
