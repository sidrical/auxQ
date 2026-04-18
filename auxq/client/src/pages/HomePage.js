// HomePage.js — The first screen users see
//
// REACT HOOKS: You'll see useState and useNavigate here. "Hooks" are special
// functions that give your components superpowers:
//
//   useState — lets your component remember things (like what the user typed).
//     const [name, setName] = useState('');
//     This creates a variable "name" (starts as empty string '')
//     and a function "setName" to update it.
//     When you call setName('Michael'), React re-renders the component with the new value.
//
//   useNavigate — lets you programmatically change the URL (go to a different page)
//     navigate('/room/4821') sends the user to the room page.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, getRoom } from '../utils/api';
import '../styles/home.css';

function HomePage() {
  // --- State ---
  // Each piece of state is something that can change and needs to trigger a re-render.
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState('home'); // 'home', 'create', or 'join'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Hook to navigate between pages
  const navigate = useNavigate();

  // --- Create a room ---
  // "async" because we're making a network request to the server
  async function handleCreateRoom() {
    if (!name.trim()) {
      setError('Enter your name to continue');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call our API — this sends a POST request to /api/rooms
      const data = await createRoom(name.trim());

      // Navigate to the room page with state
      // The second argument passes data to the next page without putting it in the URL
      navigate(`/room/${data.room.code}`, {
        state: { userName: name.trim(), isHost: true }
      });
    } catch (err) {
      setError(err.message);
    } finally {
      // "finally" runs whether the try succeeded OR failed — good for cleanup
      setLoading(false);
    }
  }

  // --- Join a room ---
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
      // Check if the room exists first
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

  // --- Render ---
  // JSX looks like HTML but it's actually JavaScript.
  // Key differences:
  //   - "class" becomes "className" (class is a reserved word in JS)
  //   - Style uses objects: style={{ color: 'red' }} not style="color: red"
  //   - Event handlers use camelCase: onClick not onclick
  //   - Curly braces {} let you embed JavaScript expressions

  return (
    <div className="home-page">
      <div className="home-header">
        <h1 className="logo">aux<span>Q</span></h1>
        <p className="tagline">the cross-platform music queue</p>
      </div>

      <div className="home-content">
        {/* This is a JSX comment. The && below is a common React pattern:
            if the left side is true, render the right side. If false, render nothing.
            It's a shorthand for: if (mode === 'home') { show this } */}

        {mode === 'home' && (
          <div className="home-form">
            <label className="label">Your name</label>
            <input
              className="input-field"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              // onChange fires every time the user types a character.
              // e.target.value is what's currently in the input field.
              // We update our state so React keeps the input in sync.
            />

            {error && <p className="error-text">{error}</p>}

            <button
              className="btn-primary"
              onClick={() => {
                if (!name.trim()) {
                  setError('Enter your name to continue');
                  return;
                }
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
                if (!name.trim()) {
                  setError('Enter your name to continue');
                  return;
                }
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
              onChange={(e) => {
                // Only allow numbers, max 4 digits
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setRoomCode(val);
              }}
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
      </div>
    </div>
  );
}

export default HomePage;
