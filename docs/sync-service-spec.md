# Bridge sync service spec: Expense (pre-Group)

Spec date: 2026-08-16. Compiled from ["Bridge sync service for Expense (pre-Group)"](https://github.com/cloud-walker/buffi/issues/17) (wayfinder map) and its resolved tickets, ["Shape of the bridge apps/sync WS relay"](https://github.com/cloud-walker/buffi/issues/18) and ["Client integration: WsSynchronizer alongside the OPFS persister"](https://github.com/cloud-walker/buffi/issues/19). This is a decision spec, ready to hand off for implementation — no application code was written as part of producing it.

## Scope and status

This is a **temporary bridge**, not buffi's final sync architecture. It syncs only the `Expense` table — the one entity implemented in code today (`apps/app/src/appStore.ts`) — across clients, via a shared, unauthenticated, in-memory WebSocket relay. It exists so sync works end-to-end for the current codebase before two other efforts land:

- **["Local-first persistence for Expense"](https://github.com/cloud-walker/buffi/issues/1)** already locked the _final_ architecture: one `MergeableStore` per `Group`, and `apps/sync` with server-side SQLite-on-volume persistence (see ["Final technology decision (lock-in)"](https://github.com/cloud-walker/buffi/issues/5)). This bridge does not implement that — no per-Group scoping, no server-side persistence.
- **["Auth/identity for Expense"](https://github.com/cloud-walker/buffi/issues/10)** is still deciding how `apps/sync` authenticates/authorizes per-Group access. This bridge has no auth at all — a single shared channel open to any client that connects.

Both are conscious, temporary omissions, not oversights. This bridge is expected to be superseded once `Group` ships in code and #10 resolves.

**Explicitly out of scope** (see #17's "Out of scope" for full detail): moving the faker seeding from client to server (a separate future effort — note #5 already points toward "one-time Store seeding," a related but distinct question); the final per-Group/SQLite architecture itself; auth/per-Group isolation; a generalized multi-entity sync protocol.

## Server: `apps/sync`

**Function**: [`createWsServer`](https://tinybase.org/api/synchronizer-ws-server/functions/creation/createwsserver/), from `tinybase/synchronizers/synchronizer-ws-server`, called with **only** its required argument — no `createPersisterForPath`. Deliberately _not_ the stripped-down `createWsServerSimple` sibling: `createWsServer` with no persister factory behaves identically to `createWsServerSimple` for this bridge (a pure in-memory relay, no persistence), but keeps the exact parameter #5's eventual SQLite-on-volume persistence will need already in place — unused today, added later without a function/import/type swap. (#18)

**Minimal entry point**:

```ts
// apps/sync/src/index.ts
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { WebSocketServer } from 'ws'

const port = Number(process.env.PORT ?? 8043)

createWsServer(new WebSocketServer({ port }))
```

Requires the `ws` package directly (an optional peer dependency of `tinybase`) — no HTTP framework (Express/Hono/Koa). `ws`'s `WebSocketServer` constructed with `{port}` runs its own internal Node `http.Server` and handles the WebSocket upgrade handshake itself. (#18)

Clients connect to `wss://<sync-domain>/<pathId>`. Since there's no `Group` concept yet and no isolation in this bridge, `pathId` is a fixed constant for now — not derived from anything, since there is exactly one shared `Expense` collection. (#18, #17 Notes)

## Deployment: Railway

`apps/sync` becomes its own Railway service, deployed the same way as `apps/app`: `railway up`, no GitHub↔Railway integration. (#17 Notes) It differs from `apps/app` in one respect: it's a long-running process, not a static build, so it needs a `deploy.startCommand` in addition to a build step, and it must bind to `process.env.PORT` per Railway convention (the entry point above already does this). (#18)

Proposed `apps/sync/railway.json`, mirroring `apps/app/railway.json`'s shape:

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

`apps/sync/package.json` (currently an empty scaffold, `"name": "@buffi/sync"`, no dependencies or scripts) needs `build`/`start` scripts added when the package is actually implemented — out of scope for this spec. (#18)

## Client: `apps/app/src/appStore.ts`

Add [`createWsSynchronizer`](https://tinybase.org/api/the-essentials/synchronizing-stores/createwssynchronizer/) (from `tinybase/synchronizers/synchronizer-ws-client`) alongside the existing `createOpfsPersister` wiring, with these rules: (#19)

1. **Startup ordering — fire-and-forget.** The app always renders immediately from local OPFS state, exactly as it does today. `createWsSynchronizer`/`startSync()` are created and started in the background, never awaited before the store is exported/used — nothing in the API requires blocking first render on sync.
2. **Sync server unreachable at startup.** Wrap synchronizer creation/`startSync()` in `try`/`catch`; log the error to console only. No UI indicator. The app stays fully usable offline — local OPFS read/write is unaffected, since clients remain the source of truth in this bridge.
3. **Sync server URL.** A new Vite env var, `VITE_SYNC_WS_URL`, read via `import.meta.env.VITE_SYNC_WS_URL`. `.env.development` supplies the local value (pointing at the port the server binds to, §"Server" above); production sets it as a Railway environment variable on the `apps/app` service, pointing at `apps/sync`'s Railway domain (`wss://...`). This is the first environment-variable convention in the repo.

### Known limitation: no reconnection

TinyBase documents no built-in reconnection for `WsSynchronizer` — if the underlying `WebSocket` closes after a successful connection, sync stops silently until the page is reloaded. This bridge does not add reconnection logic; it's an accepted consequence of keeping the bridge minimal, not an oversight. (#19)

## What this spec does not decide

Per ["Local-first persistence for Expense"](https://github.com/cloud-walker/buffi/issues/1) / [#5](https://github.com/cloud-walker/buffi/issues/5) and the still-open ["Auth/identity for Expense"](https://github.com/cloud-walker/buffi/issues/10): per-`Group` store isolation, server-side persistence (SQLite-on-volume), and authentication/authorization for `apps/sync`. When `Group` ships in code and #10 resolves, this bridge is expected to be replaced, not extended — see #17's Notes for the relationship between these three efforts.
