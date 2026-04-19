import React, { useState } from 'react';

function People({ users, hostName, isHost, currentUser, guestReorderEnabled, onKick, onBan, onToggleGuestReorder }) {
  const [confirming, setConfirming] = useState(null); // { user, action }

  function handleAction(user, action) {
    if (confirming?.user === user && confirming?.action === action) {
      if (action === 'kick') onKick(user);
      if (action === 'ban') onBan(user);
      setConfirming(null);
    } else {
      setConfirming({ user, action });
    }
  }

  return (
    <div className="people-list">
      {isHost && (
        <div className="people-settings">
          <span className="people-settings-label">Guest queue reordering</span>
          <button
            className={`toggle-btn ${guestReorderEnabled ? 'toggle-btn--on' : ''}`}
            onClick={() => onToggleGuestReorder(!guestReorderEnabled)}
          >
            {guestReorderEnabled ? 'On' : 'Off'}
          </button>
        </div>
      )}
      {users.map((user) => {
        const isCurrentUser = user === currentUser;
        const isRoomHost = user === hostName;
        const pendingKick = confirming?.user === user && confirming?.action === 'kick';
        const pendingBan = confirming?.user === user && confirming?.action === 'ban';

        return (
          <div key={user} className="people-row">
            <div className="people-info">
              <span className="user-dot" style={{ marginRight: 8 }} />
              <span className="people-name">
                {user}
                {isCurrentUser && <span className="people-tag">you</span>}
                {isRoomHost && <span className="people-tag host-tag">host</span>}
              </span>
            </div>

            {isHost && !isCurrentUser && (
              <div className="people-actions">
                <button
                  className={`people-btn ${pendingKick ? 'people-btn--confirm' : ''}`}
                  onClick={() => handleAction(user, 'kick')}
                >
                  {pendingKick ? 'Confirm kick' : 'Kick'}
                </button>
                <button
                  className={`people-btn people-btn--danger ${pendingBan ? 'people-btn--confirm' : ''}`}
                  onClick={() => handleAction(user, 'ban')}
                >
                  {pendingBan ? 'Confirm ban' : 'Ban'}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {confirming && (
        <p className="people-cancel">
          <button className="link-btn" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </p>
      )}
    </div>
  );
}

export default People;
