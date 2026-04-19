---
name: server.listen was missing
description: The server had no listen() call and exited immediately on startup
type: project
---

`server/index.js` was missing `server.listen()` at the bottom — the server would start and immediately exit with a clean exit. Fixed by adding it at the end of the file.

**Why:** The listen call was accidentally omitted.
**How to apply:** If the server exits cleanly with no error on `npm run dev`, check that `server.listen()` is present at the bottom of `index.js`.
