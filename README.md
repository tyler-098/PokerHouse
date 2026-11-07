# Private Card Platform — Phase 1 MVP (Custom Texas Hold'em)

Implements the SRS: private rooms (6-char code + share link), nickname sessions, up to 6 seats, 1-credit ante (no blinds),
two betting cycles per street, raise-to input, all-in, side pots, secure shuffle, server-authoritative state, host-managed
replenishment (20–500, between hands), chip rendering (1/5/10/25), chat, reconnect, turn timer, game-module registry.

    npm install
    npm test        # engine tests
    npm start       # http://localhost:3000  (serves the web client too)

Deploy: Render web service (`npm start`, env PORT/FRONTEND_ORIGIN). The client is static (`web/`) and can go on Vercel;
set `window.SERVER_URL` in `web/config.js` to the Render URL. Virtual credits only — no money features.

Not yet built (Phase 2/3): PostgreSQL/Prisma persistence, state recovery after restart, spectators, Redis, Playwright e2e.
Game rules sit behind `games/texas-holdem/index.js` (GameModule contract); register new games in `server/registry.js`.
