import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import {
  login, register, clearSession, fetchMe,
  getUser, isLoggedIn, connectAppleMusic,
  disconnectSpotify, disconnectApple
} from '../utils/auth';
import { getAppleMusicDeveloperToken } from '../utils/api';
import { authorize as authorizeMusicKit } from '../utils/musickit';
import '../styles/account.css';

function AccountPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [connectingApple, setConnectingApple] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      fetchMe().then(setUser).catch(() => {
        clearSession();
      });
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = tab === 'login'
        ? await login(username, password)
        : await register(username, password);
      setUser(u);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setUsername('');
    setPassword('');
  }

  async function handleConnectApple() {
    setConnectingApple(true);
    setError('');
    try {
      const { token: developerToken } = await getAppleMusicDeveloperToken();
      const userToken = await authorizeMusicKit(developerToken);
      await connectAppleMusic(userToken);
      setUser(prev => ({ ...prev, appleMusicToken: userToken }));
    } catch (err) {
      setError('Could not connect Apple Music. Try again.');
    } finally {
      setConnectingApple(false);
    }
  }

  async function handleDisconnectSpotify() {
    try {
      await disconnectSpotify();
      setUser(prev => ({ ...prev, spotify: { accessToken: null, refreshToken: null, expiresAt: null } }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDisconnectApple() {
    try {
      await disconnectApple();
      setUser(prev => ({ ...prev, appleMusicToken: null }));
    } catch (err) {
      setError(err.message);
    }
  }

  const spotifyConnected = user?.spotify?.refreshToken;
  const appleConnected = !!user?.appleMusicToken;

  if (user) {
    return (
      <div className="account-shell">
        <div className="account-header">
          <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
          <Logo />
        </div>

        <div className="account-card">
          <p className="account-username">{user.username}</p>
          <p className="account-meta">Logged in</p>
        </div>

        <div className="account-card">
          <p className="account-section-title">Connected services</p>

          <div className="service-row">
            <div className="service-info">
              <span className="service-name">Spotify</span>
              <span className={`service-status ${spotifyConnected ? 'connected' : ''}`}>
                {spotifyConnected ? 'Connected' : 'Connect when hosting a room'}
              </span>
            </div>
            {spotifyConnected && (
              <button className="btn-disconnect" onClick={handleDisconnectSpotify}>Disconnect</button>
            )}
          </div>

          <div className="service-row">
            <div className="service-info">
              <span className="service-name">Apple Music</span>
              <span className={`service-status ${appleConnected ? 'connected' : ''}`}>
                {appleConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {appleConnected ? (
              <button className="btn-disconnect" onClick={handleDisconnectApple}>Disconnect</button>
            ) : (
              <button className="btn-primary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={handleConnectApple} disabled={connectingApple}>
                {connectingApple ? '...' : 'Connect'}
              </button>
            )}
          </div>

          {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        </div>

        <div className="account-card">
          <button className="btn-logout" onClick={handleLogout}>Log out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-shell">
      <div className="account-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
        <Logo />
      </div>

      <div className="account-card">
        <div className="account-tabs">
          <button className={`account-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(''); }}>
            Log in
          </button>
          <button className={`account-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(''); }}>
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="account-field">
            <label>Username</label>
            <input
              className="input-field"
              placeholder="your_username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="account-field">
            <label>Password</label>
            <input
              className="input-field"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? '...' : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AccountPage;
