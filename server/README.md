# The Co-op server

One small Node program that runs Co-op tables (playing with friends online). The game itself is the same code the
page runs: the rules (`src/game/`), the computer guests (`src/bots/`), the referee and each person's own view
(`src/net/`). This folder is only the wire around it: the web socket, the safety limits, saving tables, and coming
back after a restart. The design is `docs/ONLINE_DESIGN.md` (§7-§12, §17).

Nothing here is live yet. Co-op shows "Coming soon" on the live site until the owner has approved the online rules
and opened a hosting account (`src/data/online.js`: `ONLINE.server.live` and `ONLINE.server.open`).

## Files

| File | What |
|---|---|
| `index.js` | The server: `GET /health`, the WebSocket upgrade (allowed pages only), per-socket limits, the heartbeat, the 250 ms tick, SIGTERM drain. Its brain is `src/net/rooms.js`. |
| `fileStore.js` | Tables saved as files when `DATA_DIR` is set (write to a temporary file, flush to the disk, rename). |
| `clientIp.js` | The client address the limits count by (behind Render: the right-most `X-Forwarded-For` entry; IPv6 by /64). |
| `package.json`, `package-lock.json` | The one package, `ws`, pinned to 8.22.0 (no other dependencies). |

## Run it on this computer (no account needed)

```
npm ci --prefix server            # once: installs ws into server/node_modules (git-ignored)
PORT=8787 node server/index.js     # then: curl 127.0.0.1:8787/health
```

A page on `http://localhost:*` or `http://127.0.0.1:*` may connect (not in production). The page finds a local server
with `?server=ws://127.0.0.1:8787` (only when the page itself is on localhost).

## Settings (environment values; no secrets)

| Setting | Meaning |
|---|---|
| `PORT` | The port (8787). |
| `HOST` | Where to listen: 127.0.0.1, or 0.0.0.0 when `NODE_ENV=production` (Render needs it). |
| `ALLOWED_ORIGINS` | The pages that may connect, comma-separated (`https://mohmdalmalik.github.io`). Any other page gets HTTP 403. |
| `DATA_DIR` | Save tables as files there (a disk). Without it tables live in memory and a restart ends them. |
| `TRUST_PROXY` | `render`: trust Render's own `X-Forwarded-For` entry for the client address. |
| `TABLES_OPEN` | `false`: nobody can start a new table (the kill switch). |
| `MAX_TABLES` | Open tables at most (300). |
| `NODE_ENV` | `production` on Render. |
| `HOTEL_RULES` | `pending`: play the PROPOSED rules, on this computer only (every allowed origin must be local). |
| `TIME_SCALE`, `LIMITS_SCALE` | Tests only: speed the game up / raise the per-address limits. Refused in production. |

## Tests

`npm ci --prefix server` once, then from the repo root:

- `node tests/protocol-check.mjs`: the server in-process over real sockets (origins, codes, limits, refusals,
  reconnects, a 5,000-message fuzz, the build filter, and a scan of 30 matches for secrets on the wire).
- `node tests/restore-check.mjs`: the real server killed (`kill -9`) and restarted mid-match from its files, and a
  SIGTERM drain.
- `node tools/load/coop-load.mjs --tables 300` (run alone): many tables at once; every match must finish and the
  server stay under 400 MB.

`tests/fairness-check.mjs` checks the server's brain (`src/net/rooms.js`) without a network.

## Putting it online (the owner, from the iPad, about 10 minutes, later)

1. render.com → **Sign up with GitHub** (no card for the free plan).
2. **New** → **Blueprint** → choose **Gaming-App**. Render reads `render.yaml` from the repository.
3. Check the region says **Singapore** (it can't be changed later) → **Apply**.
4. Send us the address Render gives (`…onrender.com`). We put its `wss://` form in `ONLINE.server.live` and publish.

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake; tables are kept in memory, so
a restart or a deploy ends the matches running then ("The hotel closed for a moment…"). A paid plan with a disk keeps
them (`render.yaml` has the lines to add). Render deploys again only when a file the server uses changes
(`buildFilter` in `render.yaml`; `tests/protocol-check.mjs` checks the list against the real imports).

## Updating ws

`ws` is pinned exactly, with its lockfile. Move to a newer version only once it is two weeks old (earlier only for a
security fix): change the version in `package.json`, run `npm install --prefix server`, and commit both files.
