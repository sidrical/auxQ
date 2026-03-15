// SpotifyCallback.js — Handles the redirect after Spotify login
//
// When the host logs into Spotify, Spotify redirects them to /callback
// with a code in the URL. Our server handles the token exchange,
// then redirects the user back to their room. This page is just a
// brief loading screen the user sees during that process.
//
// In practice, this page flashes for less than a second because the
// server immediately redirects. But it's good to have a fallback UI.

import React, { useEffect } from 'react';

function SpotifyCallback() {
  useEffect(() => {
    // The server-side /api/spotify/callback handles the actual token exchange
    // and redirects to /room/:code. If we end up on this page, it means
    // something went wrong or the redirect hasn't happened yet.

    // Check URL for error parameters
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      console.error('Spotify auth error:', params.get('error'));
    }
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      flexDirection: 'column',
      gap: 12,
      padding: 24
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Connecting to Spotify...</h2>
      <p style={{ fontSize: 14, color: '#6B6B6B' }}>You'll be redirected back to your room</p>
    </div>
  );
}

export default SpotifyCallback;
