import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

function Queue({ queue, onAddClick, canReorder, onReorder }) {
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

  function handleDragEnd(result) {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    onReorder(result.source.index, result.destination.index);
  }

  const list = (
    <div className="queue">
      {queue.map((song, index) => (
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
              <span className="badge badge-user">{song.addedBy}</span>
              <span className={`badge ${song.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
                {song.source === 'spotify' ? 'Spotify' : 'Apple'}
              </span>
            </div>
          </div>
        </div>
      ))}
      <div style={{ padding: '16px 0' }}>
        <button className="btn-primary" onClick={onAddClick}>+ Add a song</button>
      </div>
    </div>
  );

  if (!canReorder) return list;

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="queue">
        {(provided) => (
          <div className="queue" ref={provided.innerRef} {...provided.droppableProps}>
            {queue.map((song, index) => (
              <Draggable key={song.id} draggableId={song.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    className={`queue-item${snapshot.isDragging ? ' dragging' : ''}`}
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                  >
                    <div className="drag-handle" {...provided.dragHandleProps}>⠿</div>
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
                        <span className="badge badge-user">{song.addedBy}</span>
                        <span className={`badge ${song.source === 'spotify' ? 'badge-spotify' : 'badge-apple'}`}>
                          {song.source === 'spotify' ? 'Spotify' : 'Apple'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            <div style={{ padding: '16px 0' }}>
              <button className="btn-primary" onClick={onAddClick}>+ Add a song</button>
            </div>
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

export default Queue;
