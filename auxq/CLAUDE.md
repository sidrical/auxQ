# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is AuxQ

AuxQ is a collaborative music queue app. A host creates a room (4-digit code), connects their Spotify account, and guests join to add songs. Playback runs on the host's Spotify; songs from Apple Music or other sources are matched to Spotify URIs before being queued.

## Commands

**Server** (in `server/`):
```bash
npm run dev   # development with nodemon
npm start     # production
```

**Client** (in `client/`):
```bash
npm start     # React dev server on port 3000
npm run build # production build
```

There are no automated tests. Node 24.x is required for the client.

## Architecture

The app is a monorepo with independent `client/` and `server/` directories.

### Communication
- **REST** (`/api/*`): room creation, Spotify OAuth, search, link parsing
- **Socket.io**: all real-time state — queue updates, playback events, user presence

### Server (`server/index.js`)
Single-file server that owns all room state in memory (a `rooms` Map). Each room holds queue, current track, Spotify tokens, connected users, and a polling interval. Key flows:

- **Spotify OAuth**: `server/routes/spotify-routes.js` handles the OAuth redirect; state parameter carries the room code so the token lands on the right room.
- **Playback polling**: Every 3 seconds per active room, `server/utils/spotify.js` checks Spotify playback state. Natural song endings are detected by comparing >60% prior progress against ~0% current progress; this drives queue auto-advance.
- **Song matching**: `server/utils/song-matcher.js` takes a song from any source (Apple Music link, text search) and finds the best Spotify URI match using title/artist fuzzy matching.
- **Skip debounce**: Duplicate skip signals within 1 second are dropped — iOS Safari workaround.

### Client (`client/src/`)
React SPA with three routes (`/`, `/room/:code`, `/callback`). `RoomPage` is the main view with tabs for queue, search, and paste-link. Socket.io connection lives in `client/src/utils/socket.js`; the REST helpers are in `client/src/utils/api.js`.

Session storage persists username and host flag across the Spotify OAuth redirect.

### Environment Variables

Server requires `server/.env`:
```
PORT=3001
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/spotify/callback
APPLE_MUSIC_KEY_ID=
APPLE_MUSIC_TEAM_ID=
APPLE_MUSIC_PRIVATE_KEY=
```

Client uses `REACT_APP_SERVER_URL` (defaults to `http://localhost:3001`) if set in `client/.env`.
