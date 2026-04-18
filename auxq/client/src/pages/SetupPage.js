import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSpotifyLoginURL, getAppleMusicDeveloperToken, restoreSpotifySession } from '../utils/api';
import { authorize as authorizeMusicKit, configureMusicKit } from '../utils/musickit';
import { isLoggedIn, getUser, connectAppleMusic } from '../utils/auth';
import useRoomSession from '../utils/useRoomSession';
import Logo from '../components/Logo';
import '../styles/setup.css';

function SetupPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { userName } = useRoomSession(code);

  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [connectingApple, setConnectingApple] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(null); // 'spotify' | 'apple' | null
  const [error, setError] = useState('');

  // Auto-connect if the logged-in user already has a music service linked
  useEffect(() => {
    if (!isLoggedIn()) return;
    const user = getUser();

    async function tryAutoConnect() {
      // Try Spotify first
      if (user?.spotify?.refreshToken) {
        setAutoConnecting('spotify');
        try {
          await restoreSpotifySession(code);
          navigate(`/room/${code}`, { state: { userName, isHost: true } });
          return;
        } catch {
          setAutoConnecting(null);
        }
      }

      // Try Apple Music — MusicKit stores auth in the browser across sessions
      if (user?.appleMusicToken) {
        setAutoConnecting('apple');
        try {
          const { token: devToken } = await getAppleMusicDeveloperToken();
          const music = await configureMusicKit(devToken);
          if (music.isAuthorized) {
            sessionStorage.setItem(`auxq-platform-${code}`, 'apple_music');
            navigate(`/room/${code}`, { state: { userName, isHost: true, hostPlatform: 'apple_music' } });
            return;
          }
        } catch {}
        setAutoConnecting(null);
      }
    }

    tryAutoConnect();
  }, []);

  const busy = connectingSpotify || connectingApple;

  async function handleConnectSpotify() {
    setConnectingSpotify(true);
    setError('');
    try {
      const data = await getSpotifyLoginURL(code);
      window.location.href = data.url;
    } catch (err) {
      setError('Could not reach Spotify. Try again.');
      setConnectingSpotify(false);
    }
  }

  async function handleConnectAppleMusic() {
    setConnectingApple(true);
    setError('');
    try {
      const { token: developerToken } = await getAppleMusicDeveloperToken();
      const userToken = await authorizeMusicKit(developerToken);
      sessionStorage.setItem(`auxq-platform-${code}`, 'apple_music');

      if (isLoggedIn() && userToken) {
        connectAppleMusic(userToken).catch(() => {}); // save to account in background
      }

      navigate(`/room/${code}`, {
        state: { userName, isHost: true, hostPlatform: 'apple_music' }
      });
    } catch (err) {
      setError('Could not connect to Apple Music. Try again.');
      setConnectingApple(false);
    }
  }

  if (autoConnecting) {
    return (
      <div className="page-shell">
        <div className="setup-header">
          <Logo />
        </div>
        <div className="setup-content">
          <p className="setup-subtitle">
            {autoConnecting === 'spotify' ? 'Restoring your Spotify connection...' : 'Restoring your Apple Music connection...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="setup-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
        <Logo />
      </div>

      <div className="setup-content">
        <h2 className="setup-title">Connect your music</h2>
        <p className="setup-subtitle">
          Connect to control playback and queue songs from your library
        </p>

        {error && <p className="error-text">{error}</p>}

        <button
          className="service-btn service-btn--spotify"
          onClick={handleConnectSpotify}
          disabled={busy}
        >
          <span className="service-btn__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
          </span>
          <span className="service-btn__label">
            {connectingSpotify ? 'Redirecting...' : 'Connect Spotify'}
          </span>
        </button>

        <button
          className="service-btn service-btn--apple"
          onClick={handleConnectAppleMusic}
          disabled={busy}
        >
          <span className="service-btn__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
          </span>
          <span className="service-btn__label">
            {connectingApple ? 'Connecting...' : 'Connect Apple Music'}
          </span>
        </button>
      </div>
    </div>
  );
}

export default SetupPage;
