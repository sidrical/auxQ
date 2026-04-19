import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createRoom, getRoom } from '../utils/api';
import { getUser, isLoggedIn, clearSession } from '../utils/auth';
import Logo from '../components/Logo';
import '../styles/home.css';

function HomePage() {
  const loggedInUser = isLoggedIn() ? getUser() : null;
  const location = useLocation();
  const notice = location.state?.notice || '';
  const [name, setName] = useState(loggedInUser?.username || '');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();


  async function handleCreateRoom() {
    if (!name.trim()) {
      setError('Enter your name to continue');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await createRoom(name.trim());
      navigate(`/room/${data.room.code}/setup`, {
        state: { userName: name.trim(), isHost: true }
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!name.trim()) {
      setError('Enter your name to continue');
      return;
    }
    if (!roomCode.trim() || roomCode.length !== 4) {
      setError('Enter a valid 4-digit room code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await getRoom(roomCode.trim());
      navigate(`/room/${roomCode.trim()}`, {
        state: { userName: name.trim(), isHost: false }
      });
    } catch (err) {
      setError('Room not found. Check the code and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="home-header">
        <Logo />
        <p className="tagline">the cross-platform music queue</p>
      </div>

      {notice && (
        <div style={{ background: '#E24B4A', color: '#fff', fontSize: 13, padding: '10px 20px', textAlign: 'center' }}>
          {notice}
        </div>
      )}

      <div className="home-content">
        {mode === 'home' && (
          <div className="home-form">
            <label className="label">Your name</label>
            <input
              className="input-field"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {error && <p className="error-text">{error}</p>}

            <button
              className="btn-primary"
              onClick={() => {
                if (!name.trim()) { setError('Enter your name to continue'); return; }
                setError('');
                handleCreateRoom();
              }}
              disabled={loading}
              style={{ marginTop: 16 }}
            >
              {loading ? 'Creating...' : 'Create a room'}
            </button>

            <button
              className="btn-secondary"
              onClick={() => {
                if (!name.trim()) { setError('Enter your name to continue'); return; }
                setError('');
                setMode('join');
              }}
              style={{ marginTop: 10 }}
            >
              Join a room
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="home-form">
            <button className="back-btn" onClick={() => setMode('home')}>
              ← Back
            </button>

            <h2 className="form-title">Join a room</h2>
            <p className="form-subtitle">Enter the 4-digit code from the host</p>

            <input
              className="input-field room-code-input"
              placeholder="0000"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
            />

            {error && <p className="error-text">{error}</p>}

            <button
              className="btn-primary"
              onClick={handleJoinRoom}
              disabled={loading}
            >
              {loading ? 'Joining...' : 'Join'}
            </button>
          </div>
        )}
      </div>

      <div className="home-footer">
        <p>Spotify + Apple Music users can queue together</p>
        {loggedInUser ? (
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Signed in as <strong>{loggedInUser.username}</strong>
            {' · '}
            <button
              className="link-btn"
              onClick={() => navigate('/account')}
              style={{ fontSize: 13 }}
            >
              Account
            </button>
            {' · '}
            <button
              className="link-btn"
              onClick={() => { clearSession(); setName(''); }}
              style={{ fontSize: 13 }}
            >
              Log out
            </button>
          </p>
        ) : (
          <p style={{ marginTop: 8, fontSize: 13 }}>
            <button className="link-btn" onClick={() => navigate('/account')} style={{ fontSize: 13 }}>
              Sign in
            </button>
            {' to save your music connections'}
          </p>
        )}
      </div>
    </div>
  );
}

export default HomePage;
