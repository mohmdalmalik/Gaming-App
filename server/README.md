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
| `README.md` | This page. |
| `fileStore.js` | Tables saved as files when `DATA_DIR` is set (write to a temporary file, flush to the disk, rename). |
| `clientIp.js` | The client address the limits count by (behind Render: the right-most `X-Forwarded-For` entry; IPv6 by /64). |
| `package.json`, `package-lock.json` | The one package, `ws`, pinned to 8.22.0 (no other dependencies). |

## Run it on this computer (no account needed)

```
cd server && npm ci && node index.js   # npm ci once: installs ws into server/node_modules (git-ignored)
curl 127.0.0.1:8787/health             # in another terminal: {"ok":true,"protocol":[1,1],"data":"0a07d6b0",...}
```

(From the repo root the same is `npm ci --prefix server` and `PORT=8787 node server/index.js`.) A page on
`http://localhost:*` or `http://127.0.0.1:*` may connect (not in production). Serve the page with
`python3 -m http.server 8080 --bind 127.0.0.1` from the repo root and open
`http://127.0.0.1:8080/?server=ws://127.0.0.1:8787` (`?server=` works only when the page itself is on localhost or
127.0.0.1; without it a local page tries `ws://localhost:8787`). Two players need two browser profiles or a private
window, so each has its own device key.

`/health` answers `ok`, the protocol range, the shared data's fingerprint (`data`, which the page must match), the
open tables, the matches being played, the people connected and the uptime, plus a few measurements (`loopP99Ms`,
`rssMB`, `heapMB`, `saves`, `sockets`).

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
- `node tests/connection-check.mjs`: the page's side of the connection, ending with two devices at this server.
- `node tests/browser-coop.mjs` (a browser suite, about 20 minutes alone): several browsers play a whole match against
  this server, killed and restarted mid-trade.
- `node tools/load/coop-load.mjs --tables 300` (run alone): many tables at once; every match must finish and the
  server stay under 400 MB.

`tests/fairness-check.mjs` checks the server's brain (`src/net/rooms.js`) without a network.

## Putting it online (the owner, from the iPad, about 10 minutes, later)

Nothing here costs money on the free plan, and nothing changes for players until the last step.

1. Open **render.com** in Safari and tap **Sign up with GitHub** (the free plan needs no card).
2. Tap **New**, then **Blueprint**, and choose the **Gaming-App** repository. Render reads `render.yaml` from it: one
   web service called hotel-escape, on the free plan, with every setting already filled in (no secrets to type).
3. Check that the region says **Singapore**. It can't be changed later, so tell us first if most players will be
   somewhere else. Then tap **Apply**. The first build takes a few minutes.
4. Send us the address Render shows (it ends in `.onrender.com`). We put its `wss://` form in `ONLINE.server.live`
   (`src/data/online.js`) and publish. Co-op still says "Coming soon" to players.
5. Try it yourself on two devices with the live link plus `?coop=preview`
   (`https://mohmdalmalik.github.io/Gaming-App/?coop=preview`): only that link reaches the server.
6. When the online rule list is approved and the test went well, we set `ONLINE.server.open` to true and publish:
   Co-op opens to players.

Before inviting friends for real, the recommendation is the paid **Starter** plan (about $7 a month) with a 1 GB disk
(about $0.25 a month), so a match survives our updates and Render's maintenance: in Render, change the service's plan
to Starter, add a disk mounted at `/var/data`, and add the setting `DATA_DIR` = `/var/data` (the lines are in
`render.yaml`, commented out). Prices come from third-party summaries: check them on Render's own page before paying.

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake; tables are kept in memory, so
a restart or a deploy ends the matches running then ("The hotel closed for a moment…"). A paid plan with a disk keeps
them (`render.yaml` has the lines to add). Render deploys again only when a file the server uses changes
(`buildFilter` in `render.yaml`; `tests/protocol-check.mjs` checks the list against the real imports).

## Updating ws

`ws` is pinned exactly, with its lockfile. Move to a newer version only once it is two weeks old (earlier only for a
security fix): change the version in `package.json`, run `npm install --prefix server`, and commit both files.
(8.22.0 was published on 26 Sep 2026; 8.22.1 came out on 31 Oct 2026 and can be taken after 14 Nov 2026.)

## Memory

`render.yaml` starts the server with a 256 MB heap cap (`node --max-old-space-size=256 server/index.js`). A table
needs about half a megabyte of live memory, but without the cap Node let garbage pile up to about 600 MB in the
300-table load test, over the free plan's 512 MB. With the cap: 300 tables, every match finished, at most 281 MB.
