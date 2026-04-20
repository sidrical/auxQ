# AUXQ — Living State Document
_Last updated: 2026-04-20_

---

## Current State

### Room lifecycle
- Host creates a room → gets a 4-digit code
- Guests join by entering the code on the home page
- Host is directed to `/room/:code/setup` to pick a music platform before entering
- Room state is entirely in-memory on the server; a server restart destroys all active rooms

### Music platform support
- **Spotify** — host authenticates via OAuth; playback is driven by the Spotify Web API on the server side; tokens are refreshed automatically
- **Apple Music** — host authenticates via MusicKit JS in the browser; playback runs client-side in the host's tab (the host browser is the player); server just tells it what to play via Socket.io events

### Song input (three methods)
- **Search** — searches Spotify or Apple Music depending on the host's platform; results include album art and source badge
- **Paste link** — accepts Spotify or Apple Music URLs and resolves them server-side
- **Cross-platform matching** — if a guest adds a song from the non-host platform, the server tries ISRC match first (exact), then Odesli/Songlink API fallback; failure returns an error toast

### Queue
- Shared queue visible to all users in real time via Socket.io
- Each item shows title, artist, album art, who added it, and source badge
- First song added auto-populates `currentTrack` immediately (no separate "start" step)
- Auto-advance: Spotify rooms use a server-side poller (3 s interval, 60% progress threshold); Apple Music rooms use a `playbackStateDidChange` event from MusicKit in the host browser
- **Drag-and-drop reorder** — always available to the host; optionally enabled for guests via a toggle in the People tab

### Now Playing
- Displays current track with album art, title, artist, and source badge
- Progress bar with elapsed/total time
  - Spotify: server polls every 3 s and broadcasts snapshots; client interpolates forward between updates
  - Apple Music: host polls `MusicKit.getInstance().player` every 1 s and broadcasts via `apple-progress` socket event; guests receive the same snapshots
- Host-only transport controls: restart (⏮), play/pause, skip (⏭)
- Guests see a static "♪ Playing / ⏸ Paused" status

### People tab
- Lists all connected users with "you" / "host" tags
- Host can **kick** (removes from room, socket disconnected) or **ban** (kick + adds username + IP to ban list)
- Both actions require a two-click confirmation to prevent accidents
- Banned users are rejected at `join-room` time; ban list is checked on every join

### User accounts
- Optional — guests can use the app without an account
- Username/password auth, JWT stored in `localStorage`
- Account page at `/account` shows connected services (Spotify, Apple Music)
- **Spotify token persistence**: when a logged-in host connects Spotify, the refresh token is saved to their `User` document; on next visit, `SetupPage` auto-restores the session without re-doing OAuth
- **Apple Music token persistence**: MusicKit user token saved to the User document; `SetupPage` checks `music.isAuthorized` on load and auto-enters the room
- **Ban list persistence**: when a logged-in host bans a user, the username is written to `User.banList` in MongoDB and re-loaded when the host creates their next room

### UX / misc
- Dark/light mode toggle (persisted via `useDarkMode`)
- iOS Safari reconnect workaround: `join-room` re-emitted on every socket `connect` event
- iOS Safari double-tap skip guard: duplicate `next-song` events within 1 s are dropped
- Error toast (dismissible) for song-matching failures and playback errors

---

## Recent Changes
_Inferred from git log and code structure; most recent first._

- **Skip-back fixes** — fixed Apple Music skip-back accidentally resuming when paused (was calling `resumeTrack` instead of `pauseTrack`); fixed progress bar staying at paused position after skip-back by resetting `progress` state and `progressServerRef` to 0 immediately on seek for both Spotify and Apple Music
- **Guest queue reorder toggle** — `guestReorderEnabled` flag on room object; `set-guest-reorder` socket event; toggle UI in `People.js`; `canReorder` prop threads down to `Queue.js`
- **Kick and ban system** — `kick-user` / `ban-user` socket events; `bannedUsers` + `bannedIPs` arrays on room; ban persistence to `User.banList` in MongoDB; two-step confirmation UI in `People.js`
- **User account system** — `User` model, `auth-routes.js`, JWT middleware; `AccountPage` and auth utilities; Spotify/Apple token persistence; `SetupPage` auto-connect flow
- **Drag-and-drop reorder** — `@hello-pangea/dnd` added; `reorder-queue` socket event; `Queue.js` renders `DragDropContext` conditionally based on `canReorder`

---

## Known Issues

_Fill in as you discover them. Confirmed code-visible limitations listed below._

- **No queue deletion** — songs can be reordered but not removed once added
- **Server restart wipes all rooms** — no persistence layer for room/queue state
- **Rooms never expire** — rooms accumulate in memory until the server restarts; no TTL or cleanup
- **Apple Music host must keep the tab open** — MusicKit playback dies if the host backgrounds the tab or the browser suspends it
- **`reorder-queue` has no server-side permission check** — any socket client can send the event regardless of `guestReorderEnabled`; enforcement is client-only
- **Bans are username-string only** — a banned user can re-join with a different display name (IP ban is a partial mitigation)
- **3 s Spotify progress lag** — poll interval means guests can see progress up to 3 s behind actual playback

---

## Stack & Architecture

### Tech stack
| Layer | Tech |
|---|---|
| Server runtime | Node.js 24, Express |
| Real-time | Socket.io |
| Database | MongoDB (Mongoose) |
| Auth | JWT (`jsonwebtoken`), bcrypt |
| Client | React 18 (CRA), react-router-dom v6 |
| Drag-and-drop | @hello-pangea/dnd |
| Music APIs | Spotify Web API, Apple MusicKit JS, Odesli/Songlink |

### File structure
```
auxq/
├── server/
│   ├── index.js              # All room state, socket handlers, queue logic
│   ├── routes/
│   │   ├── spotify-routes.js # OAuth flow + getValidToken export
│   │   ├── apple-music-routes.js # Developer token endpoint
│   │   └── auth-routes.js    # Register, login, /me, service connect/disconnect
│   ├── utils/
│   │   ├── spotify.js        # getPlaybackState, playTrack
│   │   └── song-matcher.js   # ISRC + Odesli cross-platform matching
│   ├── middleware/
│   │   └── auth.js           # verifyToken, optionalToken
│   └── models/
│       └── User.js           # username, hashedPassword, spotify{}, appleMusicToken, banList
└── client/src/
    ├── App.js                # Routes: /, /account, /room/:code/setup, /room/:code, /callback
    ├── pages/
    │   ├── HomePage.js       # Create/join room entry point
    │   ├── SetupPage.js      # Platform picker + auto-connect for logged-in hosts
    │   ├── RoomPage.js       # Main room view — tabs, socket lifecycle, playback handlers
    │   ├── AccountPage.js    # Login/register + connected services management
    │   └── SpotifyCallback.js# Handles OAuth redirect, resumes room session
    ├── components/
    │   ├── NowPlaying.js     # Track display, progress bar, host controls
    │   ├── Queue.js          # Queue list, drag-and-drop wrapper
    │   ├── Search.js         # Search input + results, pending/added state
    │   ├── PasteLink.js      # Link paste input, server-side resolution
    │   ├── People.js         # User list, kick/ban UI, reorder toggle
    │   └── Logo.js           # Shared logo component
    └── utils/
        ├── socket.js         # Singleton Socket.io client
        ├── api.js            # REST helpers (search, playback, OAuth URLs, etc.)
        ├── auth.js           # JWT storage, login/register, service connect helpers
        ├── musickit.js       # MusicKit JS wrappers (configure, play, pause, seek)
        ├── useDarkMode.js    # Theme hook
        └── useRoomSession.js # Reads userName/isHost/hostPlatform from sessionStorage
```

### How the pieces connect
1. **Room creation** (`POST /api/rooms`) creates an in-memory room object; `hostUserId` is set if the requester has a valid JWT so the ban list can be pre-loaded and future bans persisted.
2. **Host platform setup** — `SetupPage` triggers Spotify OAuth (redirect → callback → session restore) or MusicKit JS authorization in-browser, then emits `set-host-platform` so the server knows which path to take for playback commands.
3. **Song add** — client emits `add-song`; server runs `song-matcher` if the song's source ≠ host platform, then pushes to `room.queue`. If `currentTrack` is null it pops the queue immediately and starts playback.
4. **Playback control** — host-only UI in `NowPlaying.js` calls REST endpoints (Spotify) or MusicKit JS directly (Apple Music), then emits socket events so the server can update `room.isPlaying` and broadcast to all clients.
5. **Auto-advance** — Spotify rooms: server poller detects natural end via progress heuristic and calls `advanceQueue()`. Apple Music rooms: host browser detects `playbackStateDidChange → completed` and emits `apple-track-ended`.
6. **Reorder** — client emits `reorder-queue { fromIndex, toIndex }`; server does an in-place splice on `room.queue` and broadcasts the updated room.

---

## Next Up

- Add ability to remove a song from the queue
