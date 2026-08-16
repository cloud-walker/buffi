# Sync server shape: `createWsServer` and a minimal `apps/sync`

Research date: 2026-08-16.

**Context.** `docs/research/local-first-persistence-survey.md` (section 9, "TinyBase") already locked in TinyBase for buffi's local-first persistence, noting only in passing that TinyBase ships `WsSynchronizer` (client) and `createWsServer` (server) for multi-client sync — "a small self-hostable Node.js WebSocket server" — without digging into `createWsServer`'s actual API. The team is now planning `apps/sync`, currently an empty scaffold (`apps/sync/package.json`, no dependencies, no source), to run that relay. It is deliberately minimal: no server-side persistence (clients remain the source of truth via the OPFS persister already wired in `apps/app/src/appStore.ts`), no auth, no per-`Group` isolation — just a shared in-memory relay so `MergeableStore` can sync the app's one entity, `Expense`, across tabs/devices. `apps/app` deploys to Railway today via `apps/app/railway.json` (`RAILPACK` builder, a `buildCommand`, `railway up` with no GitHub↔Railway integration); `apps/sync` needs to become its own Railway service deployed the same way.

**Method.** All claims are sourced from tinybase.org docs pages, the `tinyplex/tinybase` GitHub repo (source files, `package.json`, and the repo's own reference deployment under `support/tinybase-demo-server/`, fetched via raw GitHub URLs and the GitHub API), the `websockets/ws` README (since TinyBase's WS server wraps that package), and Railway's own JSON schema (`https://railway.com/railway.schema.json`, which redirects to `https://backboard.railway.app/railway.schema.json`) for the `railway.json` shape. No blogs or secondary write-ups. This document is scoped purely to research; no application code was written or scaffolded as part of it.

This document is written as an addendum to the survey above — it does not re-litigate the choice of TinyBase, only fills in the `createWsServer` gap.

---

## 1. `createWsServer`'s API surface

**Import path.** `createWsServer` is exported from the `tinybase/synchronizers/synchronizer-ws-server` subpath, not from the `tinybase` root package — [tinybase.org/api/synchronizer-ws-server](https://tinybase.org/api/synchronizer-ws-server/):

```ts
import {createWsServer} from 'tinybase/synchronizers/synchronizer-ws-server';
```

**Signature** — [tinybase.org/api/synchronizer-ws-server/functions/creation/createwsserver](https://tinybase.org/api/synchronizer-ws-server/functions/creation/createwsserver/):

```ts
createWsServer<PathPersister>(
  webSocketServer: WebSocketServer,
  createPersisterForPath?: (pathId: string) =>
    | undefined
    | PathPersister
    | [PathPersister, (store: MergeableStore) => void]
    | Promise<PathPersister>
    | Promise<[PathPersister, (store: MergeableStore) => void]>,
  onIgnoredError?: (error: any) => void,
  requestTimeoutSeconds?: number,
  fragmentSize?: number,
): WsServer
```

- `webSocketServer` (required) — "a `WebSocketServer` object from your server environment," i.e. an already-constructed `ws` package server instance. TinyBase does not construct it for you.
- `createPersisterForPath` (optional) — a factory invoked per WS "path" the first time a client connects to it, letting the server optionally back that path's `MergeableStore` with a `Persister` (e.g. file, SQLite). Only exists while clients are active on that path.
- `onIgnoredError` (optional) — error callback for sync errors the server would otherwise swallow silently; useful for logging.
- `requestTimeoutSeconds` (optional) — timeout for sync requests/incomplete fragments, default 1s.
- `fragmentSize` (optional) — max UTF-8 byte size per WS message fragment.

**Return value / hooks — the `WsServer` interface** — [tinybase.org/api/synchronizer-ws-server/interfaces/server/wsserver](https://tinybase.org/api/synchronizer-ws-server/interfaces/server/wsserver/) (available since TinyBase v5.0.0):

- `getWebSocketServer()` — returns the underlying `ws` `WebSocketServer` you passed in.
- `getClientIds()` / `getPathIds()` — inspect currently-connected clients / active sync paths.
- `addClientIdsListener(pathId, listener)` / `addPathIdsListener(listener)` / `delListener(id)` — event hooks for connect/disconnect and path lifecycle, e.g. for logging or metrics. TinyBase's own reference deployment uses `addClientIdsListener` purely to update peak-usage stats (see §3).
- `getStats()` — diagnostic counts (paths, clients) for monitoring.
- `destroy()` — shuts the server down.

So it is not just "give it a `ws` server instance and it handles the rest" in a black-box sense — it *is* that for the minimal case, but it also exposes listener hooks and stats if you want observability layered on top, all optional.

**A simpler sibling exists.** TinyBase also ships `createWsServerSimple` from `tinybase/synchronizers/synchronizer-ws-server-simple`, described as creating a server "without the complications of listeners, persistence, or statistics" — explicitly a stripped-down reference-grade implementation — [tinybase.org/api/synchronizer-ws-server-simple](https://tinybase.org/api/synchronizer-ws-server-simple/). Its signature is a single required argument — [tinybase.org/api/synchronizer-ws-server-simple/functions/creation/createwsserversimple](https://tinybase.org/api/synchronizer-ws-server-simple/functions/creation/createwsserversimple/):

```ts
createWsServerSimple(webSocketServer: WebSocketServer): WsServerSimple
```

This maps almost exactly onto buffi's stated constraints (no persistence, no auth, no stats) and is arguably the better starting point than the full `createWsServer` — see recommendation in §3.

## 2. What it needs to run

`createWsServer` (and `createWsServerSimple`) require a raw `ws`-package `WebSocketServer` instance directly — there is no HTTP framework (Express/Hono/Koa) anywhere in the dependency chain:

- `ws` is an **optional peer dependency** of `tinybase` (`"ws": "^8.21.3"`, `peerDependenciesMeta.ws.optional: true`), and also appears as a `devDependency` with `@types/ws` — [raw.githubusercontent.com/tinyplex/tinybase/main/package.json](https://raw.githubusercontent.com/tinyplex/tinybase/main/package.json).
- Every doc example (`tinybase.org/guides/synchronization/using-a-synchronizer`, both `createWsServer` and `createWsServerSimple` API pages) constructs the server as `new WebSocketServer({port: N})` from `import {WebSocketServer} from 'ws'` and passes that straight into `createWsServer`/`createWsServerSimple`.
- Per `ws`'s own README, passing `{port}` to `WebSocketServer` makes `ws` create and manage its own internal plain Node `http.Server` for you — no Express/Hono/Koa/etc. needed: "a simple server" example is exactly `new WebSocketServer({port: 8080})` with no other HTTP server object in scope — [raw.githubusercontent.com/websockets/ws/master/README.md](https://raw.githubusercontent.com/websockets/ws/master/README.md). (`ws` also supports `{server}` to attach to an *existing* HTTP/S server, and `{noServer: true}` for manual `handleUpgrade()` routing — TinyBase's own multi-subdomain demo server uses that third mode; see §3 — but neither is required for a single-path relay.)

So: **no HTTP framework is needed.** `ws` handles the WebSocket upgrade handshake itself when constructed with `{port}`.

## 3. The minimal entry point for a pure in-memory relay

The closest primary-source example to buffi's exact use case is TinyBase's own production deployment for its collaborative demos, `support/tinybase-demo-server/index.ts` in the `tinyplex/tinybase` repo, referenced from the "Todo App v6 (collaboration)" demo docs, which state the server there "is not saving a copy of the data itself — it is merely acting as a broker between clients" — [tinybase.org/demos/todo-app/todo-app-v6-collaboration](https://tinybase.org/demos/todo-app/todo-app-v6-collaboration/), source at [github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/index.ts](https://github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/index.ts). That file is more elaborate than buffi needs — it fans out across multiple subdomains via `noServer: true` + manual `handleUpgrade`, and exposes a second HTTP server on a separate port serving Prometheus-style `/metrics` text — because it's a shared multi-tenant demo host, not a single-service relay.

For buffi's simpler shape (one Railway service, one relay, no multi-tenant routing, no metrics endpoint), the base API example from the docs is a better direct template — [tinybase.org/api/synchronizer-ws-server-simple/functions/creation/createwsserversimple](https://tinybase.org/api/synchronizer-ws-server-simple/functions/creation/createwsserversimple/) and [tinybase.org/guides/synchronization/using-a-synchronizer](https://tinybase.org/guides/synchronization/using-a-synchronizer/). In prose/pseudocode (not a real file — nothing under `apps/sync/src` was created for this research task):

```ts
// apps/sync/src/index.ts (illustrative only — not written to the repo)
import {createWsServerSimple} from 'tinybase/synchronizers/synchronizer-ws-server-simple';
import {WebSocketServer} from 'ws';

const port = Number(process.env.PORT ?? 8043);

createWsServerSimple(new WebSocketServer({port}));
```

That's the entire server. `WsSynchronizer` clients (already the sync-side counterpart to the OPFS persister pattern) connect to `wss://<railway-domain>/<pathId>` — where `pathId` is presumably a `Group` id or similar room key once that concept exists, or just a fixed constant today since there's only one `Expense` collection and no per-Group isolation yet — and TinyBase's own wire protocol handles merging `MergeableStore` CRDT state across all connected clients on that path. No route handlers, no request parsing, no auth middleware needed for this scope.

If observability (connection counts, logging on connect/disconnect) is wanted later without persistence, swap `createWsServerSimple` for `createWsServer` and add `wsServer.addClientIdsListener(null, (wsServer, clientId) => ...)` — this stays a pure relay; the listener/stats surface on `WsServer` is separate from persistence.

**Built-in persistence hooks, and why they can be left unused.** `createWsServer`'s second parameter, `createPersisterForPath`, is the *only* built-in persistence hook, and it is entirely optional — the doc examples show the base case with just the required `webSocketServer` argument and no persister factory, and the docs' own persistence example is captioned "a very crude example" of an opt-in extra, not a required piece — [tinybase.org/guides/synchronization/using-a-synchronizer](https://tinybase.org/guides/synchronization/using-a-synchronizer/). Omitting it (or using `createWsServerSimple`, which has no such parameter at all) gives exactly the "no server-side persistence, clients are source of truth" shape buffi wants: the server holds merged state only in memory for the lifetime of the process/connections, matching the existing OPFS-persister-on-client architecture in `apps/app/src/appStore.ts`.

## 4. Deployability on Railway

**What it needs to run:**
- A **start command** that runs the compiled/interpreted entry point (e.g. `node dist/index.js`, or a TS runtime like the reference server's `bun index.ts` — [github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/Dockerfile](https://github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/Dockerfile)). This is a long-running process, not a build artifact served statically — unlike `apps/app`, which only needs a `buildCommand` because Railpack serves the static Vite output itself.
- It **must bind to `process.env.PORT`**, per Railway convention. The snippet in §3 already does this (`Number(process.env.PORT ?? 8043)`); TinyBase's own reference deployment instead hardcodes ports (8043 for WS, 8044 for `/metrics`) because it targets Fly.io with an explicit `internal_port` mapping in `fly.toml` rather than Railway's `$PORT`-injection convention — [github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/fly.toml](https://github.com/tinyplex/tinybase/blob/main/support/tinybase-demo-server/fly.toml) — so that hardcoding is a Fly-specific choice, not something to copy for Railway.
- **No HTTP framework is required for the WS upgrade to work** — confirmed in §2: `ws`'s `WebSocketServer` constructed with `{port}` stands up its own internal plain Node `http.Server` and handles the WS upgrade handshake itself. A bare `ws` server is sufficient; nothing else needs to sit "underneath" it.
- Railway's build system needs to know how to build/run a Node/TS package inside the monorepo the same way it already does for `apps/app` — i.e. a `builder: "RAILPACK"` plus a `pnpm --filter @buffi/sync ...` command (matching `apps/app/railway.json`'s `pnpm --filter buffi build`, and `apps/sync/package.json`'s current `"name": "@buffi/sync"`).

**Proposed `apps/sync/railway.json`** (illustrative — not written to the repo; field names `builder`, `buildCommand`, `startCommand` confirmed against Railway's own JSON schema at [railway.com/railway.schema.json](https://railway.com/railway.schema.json), which redirects to [backboard.railway.app/railway.schema.json](https://backboard.railway.app/railway.schema.json)):

```json
{
	"$schema": "https://railway.com/railway.schema.json",
	"build": {
		"builder": "RAILPACK",
		"buildCommand": "pnpm --filter @buffi/sync build"
	},
	"deploy": {
		"startCommand": "pnpm --filter @buffi/sync start"
	}
}
```

This mirrors `apps/app/railway.json`'s shape (same `$schema`, same `RAILPACK` builder, same `pnpm --filter <pkg> <script>` pattern) and adds the one thing a long-running server needs that a static SPA build doesn't: an explicit `deploy.startCommand`, per the schema's `deploy.startCommand: string | null` field. `apps/sync/package.json` currently has no `build`/`start` scripts at all — those would need to be added when the package is actually scaffolded (out of scope for this research doc), e.g. a `tsc` or `bun build` step plus `node dist/index.js`/`bun index.ts` respectively.

---

## Summary / recommendation

1. **API**: `createWsServer(webSocketServer, createPersisterForPath?, onIgnoredError?, requestTimeoutSeconds?, fragmentSize?) => WsServer`, imported from `tinybase/synchronizers/synchronizer-ws-server`. `WsServer` exposes `getClientIds`/`getPathIds`/`getWebSocketServer`/`getStats`, plus `addClientIdsListener`/`addPathIdsListener`/`delListener` hooks for logging/metrics, and `destroy()`. All of the extra parameters and hooks are optional.
2. **Requirements**: A raw `ws` `WebSocketServer` instance, nothing more. `ws` is an optional peer dependency of `tinybase`. No Express/Hono/Koa needed — `ws` constructed with `{port}` runs its own internal HTTP server for the WS handshake.
3. **Minimal relay**: `createWsServerSimple(new WebSocketServer({port: process.env.PORT ?? 8043}))` is the entire server — one import pair, no route handlers, no auth, no persistence. `createWsServerSimple` (from `tinybase/synchronizers/synchronizer-ws-server-simple`) is purpose-built for exactly this "no listeners, no persistence, no stats" shape and is a better starting template than the fuller `createWsServer`/its reference Fly.io deployment, which solve problems (multi-tenant routing, Prometheus metrics) buffi doesn't have yet. `createWsServer`'s only persistence hook (`createPersisterForPath`) is opt-in and can simply be omitted.
4. **Railway**: bind to `process.env.PORT`, add a `deploy.startCommand` (Railpack/`pnpm --filter @buffi/sync start` pattern, mirroring `apps/app/railway.json`'s build-only shape plus the one thing a long-running process needs beyond a static build).

**Most surprising finding**: TinyBase ships a second, purpose-built minimal server function — `createWsServerSimple` — that the original survey never surfaced (only `createWsServer` was mentioned) and whose entire raison d'être, per its own docs, is "without the complications of listeners, persistence, or statistics." That is a closer match to buffi's stated constraints than `createWsServer` itself, and turns the "minimal entry point" question in §3 into a two-line file rather than something requiring `createWsServer`'s persistence parameter to be deliberately left `undefined`.
