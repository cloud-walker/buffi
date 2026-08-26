# Client update detection: mechanisms for a Vite SPA

Research date: 2026-08-26. This document supports GitHub issue #33, a child of wayfinder map #31 "Safe change mechanism for buffi," in `cloud-walker/buffi`.

**Context.** `apps/app` is a Vite + React SPA built with `vite build` and deployed as a static bundle to Railway (`railway up`, no GitHub↔Railway integration). It has no service-worker or PWA infrastructure today (confirmed below). Map #31 treats "detecting that a client is running stale code" and "migrating a client's local TinyBase schema" as the two halves of a broader "safe change mechanism" — the schema half is covered separately in [tinybase-schema-migration.md](/Users/cw/dev/buffi/docs/research/tinybase-schema-migration.md) (on branch `research/tinybase-schema-migration`, not yet in `main` at the time of this research). **This document is scoped strictly to update *detection*** — the mechanism by which a running client can learn a newer build exists. What a client does once it knows (toast, forced reload, banner, etc.) is an explicitly separate downstream ticket and is out of scope here.

**Method.** All claims below are sourced directly from MDN Web Docs (Service Worker API, `updatefound`, `skipWaiting()`, `Clients.claim()`, `Client.postMessage()`, `ServiceWorkerRegistration.update()`, Web App Manifest), the official vite-pwa documentation site (vite-pwa-org.netlify.app) and its GitHub repository (github.com/vite-pwa/vite-plugin-pwa), Vite's own official docs (vite.dev), and caniuse.com for browser-support tables — fetched directly via WebFetch/WebSearch on 2026-08-26. No blog posts or secondary write-ups are used as a source of truth; where a search surfaced one, it was used only to locate the primary page, which was then read directly.

---

## 0. Repo grounding: what exists today

- **`apps/app`** has no PWA/service-worker footprint at all. `apps/app/vite.config.ts` registers only `@vitejs/plugin-react` and `tsconfigPaths` — no `vite-plugin-pwa`, no Workbox plugin. `apps/app/package.json` lists no `vite-plugin-pwa`, `workbox-*`, or any service-worker-related dependency among its `dependencies`/`devDependencies` (`react`, `react-dom`, `remeda`, `tinybase`, `zod` / `@faker-js/faker`, `@pandacss/dev`, `@types/react*`, `@vitejs/plugin-react`, `typescript`, `vite`). `apps/app/index.html` has no `<link rel="manifest">` and no service-worker registration script — just the React mount point and `src/main.tsx`. There is no `sw.js` or `manifest.json`/`manifest.webmanifest` anywhere in the app source.
- **`apps/sync`** (the WebSocket relay server) has no HTTP surface to extend for a version endpoint. `apps/sync/src/main.ts` is thirteen lines: it creates a bare `ws` `WebSocketServer({ port })`, wraps it in TinyBase's `createWsServer`, and handles `SIGINT`/`SIGTERM`. There is no Express/Fastify/Koa app, no `/health` or `/version` route, nothing HTTP at all — it's a raw WebSocket listener with no request/response HTTP layer to hang a version endpoint off of. Adding an HTTP version endpoint there would mean introducing an HTTP server into `apps/sync` for the first time, not just adding a route to an existing one. Serving a static `version.json` alongside `apps/app`'s own build output (which is what gets served as static files) requires no new server at all.
- `docs/domain-model.md` was skimmed for background: buffi's domain is `User`/`Group`/`Membership`/`Expense`/`ExpensePayment`/`ExpenseParticipant`, with `Group` as the sync boundary — not directly relevant to update detection, but confirms buffi is still small/pre-multi-entity, consistent with "no deadline pressure, invest in infra" rather than needing the heaviest solution immediately.

## 1. Full PWA + service worker approach

### 1.1 The actual lifecycle (primary source: MDN "Using Service Workers")

Registering a service worker (`navigator.serviceWorker.register("/sw.js")`) fetches and runs the worker's code in a `ServiceWorkerGlobalScope`, "a special kind of worker context, running off the main script execution thread, with no DOM access" — [developer.mozilla.org/.../Service_Worker_API/Using_Service_Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). The lifecycle from there:

1. **`install`** fires first, always: "An `install` event is always the first one sent to a service worker... During this step, the application is preparing to make everything available for use offline" — the same source. This is where Workbox-style precaching happens.
2. **Installed / waiting.** Once the `install` handler completes, "the service worker is considered installed. At this point a previous version of the service worker may be active and controlling open pages. Because we don't want two different versions of the same service worker running at the same time, the new version is not yet active." The new worker sits in `registration.waiting` — deliberately inert — until every page still controlled by the old worker closes.
3. **`activate`.** "Once all pages controlled by the old version of the service worker have closed, it's safe to retire the old version, and the newly installed service worker receives an `activate` event," whose "primary use... is to clean up resources used in previous versions of the service worker" (e.g. deleting stale Workbox caches).
4. **Active, but not yet controlling everyone.** Even after activation, "the service worker will now control pages, but only those that were opened after the `register()` is successful... documents will have to be reloaded to actually be controlled, because a document starts life with or without a service worker and maintains that for its lifetime."

`registration.installing` / `.waiting` / `.active` directly expose which of these states the worker is in. The **`updatefound`** event fires on a `ServiceWorkerRegistration` when the browser has found and started fetching/installing a new worker script for that registration; at the moment it fires, `registration.installing` is the newly-discovered worker — this is the idiomatic hook apps use to learn "an update exists" ([developer.mozilla.org/.../ServiceWorkerContainer/updatefound_event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/updatefound_event)).

**Why the waiting state matters, and how to bypass it.** Two versions of a worker controlling the same open tab at once would be unsafe/unpredictable, so the browser holds the new worker in `waiting` until old clients close on their own. Two APIs let an app force this instead:

- **`skipWaiting()`** — "forces the waiting service worker to become the active service worker," moving it straight to `activating` without waiting for old pages to close. It's "common to call `self.skipWaiting()` from inside of an `InstallEvent` handler" — [developer.mozilla.org/.../ServiceWorkerGlobalScope/skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting). Critically, `skipWaiting()` alone only changes which worker is "active" in the registration — it does **not** by itself make already-open tabs start being served by it: "Use this method with `Clients.claim()` to ensure that updates... take effect immediately for both the current client and all other active clients," per the same page.
- **`Clients.claim()`** — lets "an active service worker to set itself as the controller for all clients within its scope." Without it, "when a service worker is initially registered, pages won't use it until they next load. The `claim()` method causes those pages to be controlled immediately" — [developer.mozilla.org/.../Clients/claim](https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim). This is the other half of the pair: `skipWaiting()` gets the new worker active; `Clients.claim()` gets already-open tabs to actually route their fetches through it.

Even with both, an already-open tab's *already-loaded* JS/CSS/HTML is still the old bundle sitting in memory — claiming control over its future network requests doesn't rewrite code that's already executing. That's what a hard reload is for, and the mechanism to trigger one from inside the worker is **`Client.postMessage()`**: "allows a service worker to send a message to a client (a `Window`, `Worker`, or `SharedWorker`)," received "in the `message` event on `navigator.serviceWorker`" on the page side — [developer.mozilla.org/.../Client/postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage). The common pattern is: worker activates → posts a `{type: 'NEW_VERSION_ACTIVE'}`-shaped message to its clients → the page's `navigator.serviceWorker.addEventListener('message', ...)` handler calls `window.location.reload()` (or, in the "prompt" strategy below, just flips a "refresh available" flag instead of reloading immediately).

**Automatic re-check behavior.** `ServiceWorkerRegistration.update()` "attempts to update the service worker. It fetches the worker's script URL, and if the new worker is not byte-by-byte identical to the current worker, it installs the new worker" — [developer.mozilla.org/.../ServiceWorkerRegistration/update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update). Browsers call this automatically on navigation to a page in the registration's scope, and "the fetch of the worker bypasses any browser caches if the previous fetch occurred over 24 hours ago" (same page) — i.e. there's a built-in, once-a-navigation check, but nothing that polls on a timer by itself. A long-lived SPA tab that the user never navigates away from will not automatically notice a new deploy without extra app code.

### 1.2 vite-plugin-pwa (primary source: vite-pwa-org.netlify.app and github.com/vite-pwa/vite-plugin-pwa)

vite-plugin-pwa describes itself as a "Zero-config PWA Framework-agnostic Plugin for Vite" (MIT-licensed, ~4.3k GitHub stars) — [github.com/vite-pwa/vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa). It wraps **Workbox** — using the `workbox-build` library to generate the actual service-worker file (asset precaching manifest, runtime caching strategies) — and, in its default `generateSW` mode, produces the manifest, the `sw.js`, and registration boilerplate for you; a `injectManifest` mode exists if you want to hand-write the worker and just have Workbox inject the precache list into it.

It exposes a `registerType` option with two strategies, and a `virtual:pwa-register` module apps import in their entry point:

- **`registerType: 'autoUpdate'`** — "the plugin will force `workbox.clientsClaim` and `workbox.skipWaiting` to `true`" for you. The app calls `registerSW({ immediate: true })`; once a new version is detected, the plugin updates caches and reloads open tabs automatically, with no user prompt. Vite-pwa's own guidance flags the risk directly: this can interrupt a user mid-task (e.g. discard in-progress form input) since the reload is silent and unannounced — [vite-pwa-org.netlify.app/guide/auto-update.html](https://vite-pwa-org.netlify.app/guide/auto-update.html).
- **`registerType: 'prompt'`** (the default) — leaves `skipWaiting`/`clientsClaim` off by default and hands the app an explicit signal instead: `registerSW({ onNeedRefresh(), onOfflineReady() })` returns an `updateSW` function. `onNeedRefresh` fires once updated content is detected — the docs' own instruction is to "show a prompt to the user with refresh and cancel buttons inside `onNeedRefresh`" — and calling `updateSW(true)` reloads the page with the new worker's `skipWaiting`+`clients.claim` now applied — [vite-pwa-org.netlify.app/guide/prompt-for-update.html](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html).

Neither strategy polls on its own — the plugin's docs are explicit that periodic re-checking is app-authored, via the `onRegisteredSW` callback plus a manual `setInterval` calling `registration.update()`:

```ts
import { registerSW } from 'virtual:pwa-register'

const intervalMS = 60 * 60 * 1000 // e.g. hourly
const updateSW = registerSW({
  onRegisteredSW(swUrl, r) {
    r && setInterval(() => { r.update() }, intervalMS)
  },
})
```

— with a documented "edge case" hardened version that additionally skips the check while `r.installing` is set, skips it while `navigator.onLine` is false, and only calls `r.update()` after confirming the server is reachable via a `cache: 'no-store'` fetch that returns HTTP 200 — [vite-pwa-org.netlify.app/guide/periodic-sw-updates](https://vite-pwa-org.netlify.app/guide/periodic-sw-updates). This is effectively the same "poll on an interval" shape as the lightweight approach in §2, just triggering `registration.update()` (a byte-comparison against the SW script) instead of comparing a version string.

### 1.3 Web App Manifest

A separate, JSON metadata file linked via `<link rel="manifest">`, describing name/icons/`start_url`/`display` mode/theme colors, used by browsers to drive "Add to Home Screen" installability and splash screens — [developer.mozilla.org/.../Web_app_manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest). It is not itself part of the update-detection mechanism — vite-plugin-pwa bundles manifest generation because it targets full "PWA" installability, not because a manifest is required to detect or manage updates. Browser support for the manifest is broad in Chromium/Firefox but has historically been uneven member-by-member (no single unified compatibility table exists on caniuse; individual manifest members like `display`, `id`, `related_applications` each have their own support page — [caniuse.com/web-app-manifest](https://caniuse.com/web-app-manifest)). If buffi ever wants installability as its own goal, this needs separate evaluation; it's not a cost or benefit of update detection specifically.

### 1.4 Browser support (Service Worker API)

Per caniuse.com/serviceworkers (fetched 2026-08-26): ~96% global usage; supported since Chrome 45 (2015), Firefox 44 (2016), Safari 11.1 / iOS Safari 11.3 (2018), Edge 17 (2018), Opera 32 — [caniuse.com/serviceworkers](https://caniuse.com/serviceworkers). Effectively every evergreen browser buffi's users would plausibly run supports it today; the only real gaps are dead browsers (legacy IE, Opera Mini). Service workers additionally require a secure context (HTTPS, with `http://localhost` exempted for local dev) — [developer.mozilla.org/.../Service_Worker_API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) — which Railway-hosted deployments already satisfy.

### 1.5 Offline-capability implication

This is the load-bearing asymmetry for buffi's future direction: a service worker's `install`-time precaching and Workbox's runtime caching strategies are what give an app the ability to load and function without a network connection at all — and that capability is a **side effect of the same infrastructure** used for update detection, not an independent add-on. Adopting vite-plugin-pwa to get update prompts means you now also own a caching layer (what to precache, which runtime strategy per route/asset type, cache invalidation, storage-quota behavior) whether or not you wanted offline support yet.

## 2. Lightweight non-PWA approach: polling a version marker

### 2.1 How the client would know its own "current" version (primary source: vite.dev)

Vite's `define` config option performs "global constant replacements. Entries will be defined as globals during dev and statically replaced during build" — values "must be a string that contains a JSON-serializable value... or a single identifier," with non-string values auto-stringified via `JSON.stringify`. The documented example is exactly the version-constant use case:

```ts
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('v1.0.0'),
  },
})
```

— [vite.dev/config/shared-options.html#define](https://vite.dev/config/shared-options.html#define). This is a build-time, static replacement — the value is baked into the shipped bundle, not read at runtime.

`import.meta.env` is Vite's related but distinct mechanism: built-ins `MODE`/`BASE_URL`/`PROD`/`DEV`/`SSR` are always present; custom variables must be prefixed `VITE_` to be exposed client-side ("Variables prefixed with `VITE_` will be exposed in client-side source code after Vite bundling"), and — like `define` — are injected at build time, statically replaced, not readable/changeable at runtime — [vite.dev/guide/env-and-mode.html](https://vite.dev/guide/env-and-mode.html). Either mechanism (`define` with an explicit constant, or a `VITE_`-prefixed env var set by the build script) is a viable way to bake something like a git commit SHA or build timestamp into the running bundle as "the version this client was built with."

Separately, Vite's production build customizes chunk/asset output filenames via `build.rolldownOptions.output` (Vite 8 delegates bundling to Rolldown) — [vite.dev/config/build-options.html](https://vite.dev/config/build-options.html) — and, as with prior Rollup-based Vite, output filenames are conventionally content-hashed for cache-busting. That hash is a mechanism for the *browser's HTTP cache*, though, not something an app is meant to fetch and compare — it changes per-file whenever that file's bytes change, not once per deploy, so it isn't a clean single "build version" signal on its own. The `define`/`import.meta.env` constant is the right tool for "what version am I," not the filename hash.

### 2.2 The polling mechanism itself

The shape (not building it here, just describing the mechanism and its tradeoffs):

- On an interval (`setInterval`, e.g. every few minutes) and/or on `visibilitychange`/`focus` (re-checking when the user returns to a backgrounded tab, which is when a stale long-lived SPA session is most likely to be encountered), `fetch()` a small resource — either a static `version.json` emitted alongside the build output (e.g. `{ "version": "<git-sha>", "builtAt": "<iso-timestamp>" }`, written by a small build script or Vite plugin hook, requiring no server at all since `apps/app`'s build output is already served as static files) or an HTTP endpoint if one exists.
- Compare the fetched value against the `define`/`VITE_`-injected constant compiled into the currently-running bundle.
- On mismatch, surface a "stale" signal — what to do with that signal (toast, banner, forced reload) is the separate downstream UX ticket, not this one.
- Request should be cache-busted (e.g. `fetch('/version.json', { cache: 'no-store' })`, or a query-string/`If-None-Match` strategy) so a stale HTTP cache entry for `version.json` itself doesn't defeat the check.

### 2.3 Implementation complexity

Materially lower than §1: no new runtime dependency, no build-plugin-generated service worker, no cache-strategy decisions, no manifest. The moving parts are: one build-time constant (`define`), one generated static file or endpoint, and a handful of lines of polling/visibility-listener code — all ordinary application code, not a new subsystem with its own lifecycle to reason about (contrast with §1.1's install/waiting/activate/skipWaiting/clients.claim/postMessage chain, which vite-plugin-pwa mostly hides but which still governs the underlying behavior and shows up in edge cases like the "reload doesn't work on first load" and "not detecting updates" issues visible in vite-plugin-pwa's own GitHub issue tracker during this research).

### 2.4 Browser support

Universal — `fetch`, `setInterval`, and the `visibilitychange`/`focus` events are baseline web-platform features with no meaningful support gap in any browser buffi would target; nothing here requires a secure context, a service worker, or a manifest.

### 2.5 Offline-capability implication

None, by itself, in either direction. A polling check that fails while offline (the `fetch()` simply rejects/times out) should be treated as "no information," not as "update needed" or an error — it neither grants nor requires offline capability. If buffi wants the app itself to keep working offline, that is a wholly separate investment (most naturally arrived at via §1) that polling does nothing to provide or preclude.

---

## Summary

**Full PWA + service worker (§1):**
- Update detection rides on a real lifecycle — `install` → waiting → `activate` — that exists to prevent two worker versions controlling one tab at once; `updatefound` is the event that surfaces "a new worker is installing" to app code.
- `skipWaiting()` and `Clients.claim()` are two separate, composable escape hatches (activate immediately; take over already-open tabs immediately) — neither alone rewrites code already executing in an open tab, which is why a `postMessage`-triggered reload is the usual last step.
- Browsers auto-check for a new worker script on navigation (bypassing HTTP cache if last checked >24h ago), but nothing polls a long-lived tab on a timer without app code calling `registration.update()` — vite-plugin-pwa's own recommended pattern is a manual `setInterval` + `r.update()`, hardened with online/installing/response-status guards.
- vite-plugin-pwa (MIT, ~4.3k stars) wraps Workbox and gives you `registerType: 'autoUpdate'` (silent, forced `skipWaiting`+`clientsClaim`, real risk of interrupting the user) or `'prompt'` (default; exposes `onNeedRefresh`/`updateSW` for the app to drive its own UI).
- Service Worker API support is effectively universal today (~96% global usage per caniuse, since Chrome 45/Firefox 44/Safari 11.1/Edge 17); the Web App Manifest is a separate, installability-focused concern with less uniform per-member support, and isn't required for update detection at all.
- True offline capability (asset precaching, offline fallback) is a side effect of the same install/activate infrastructure — adopting this path for update detection means also owning a caching layer, wanted or not.

**Lightweight polling (§2):**
- Vite's `define` (global constant replacement, e.g. `__APP_VERSION__: JSON.stringify(...)`) and `import.meta.env` (`VITE_`-prefixed custom vars) are both build-time-only static replacements — either is a viable way to bake a "built with version X" constant into the shipped bundle.
- Content-hashed output filenames (via `build.rolldownOptions.output`, Vite 8's Rolldown-backed bundler) are a cache-busting mechanism for individual files, not a single deploy-wide version signal — the injected constant is the right tool for that, not the filename hash.
- The mechanism itself (interval/visibility-triggered `fetch` of a small marker, compared to the compiled-in constant) uses only baseline, universally-supported web APIs — no service worker, no manifest, no secure-context requirement beyond what's already in place.
- Provides zero offline capability by itself, in either direction — a failed check while offline should be treated as "no signal," not a special state.
- `apps/app` today has no PWA/service-worker code or dependency of any kind (confirmed by reading `vite.config.ts`, `package.json`, `index.html`); `apps/sync` today has no HTTP surface at all (a bare `ws` `WebSocketServer`, no Express/Fastify/routes) — so a version-endpoint approach would mean adding an HTTP layer to `apps/sync` for the first time, whereas a static `version.json` emitted next to `apps/app`'s own build output needs no new server.

## Recommendation for buffi

**Start with the lightweight polling approach now; treat full PWA/service-worker adoption as a later, offline-driven upgrade, not a prerequisite for update detection.**

The two mechanisms are not equally-weighted alternatives for this ticket's actual scope. Update detection alone needs nothing more than "compare a build-time constant to a fetched marker" — every piece of that (`define`, a static JSON file, `fetch` + `visibilitychange`) is plain application code using baseline web APIs, with no new dependency, no cache-strategy design space, and no lifecycle (install/waiting/activate/`skipWaiting`/`clients.claim`/`postMessage`) to get right. The service-worker path buys real capability — genuine offline use — but that capability is bundled in whether or not it's wanted yet, and buffi has stated no offline requirement today; adopting vite-plugin-pwa now to solve a detection problem would mean signing up for asset-caching decisions (what to precache, which Workbox strategy per route, cache invalidation) as an unavoidable side effect, which cuts against "don't build more infrastructure than necessary right now" even though buffi is otherwise happy to invest ahead of need.

This isn't a narrow stopgap in the sense map #31 warns against, though, because the two paths converge on the same *interface*. Whatever detection mechanism sits underneath, the rest of the app (and specifically the downstream stale-client-UX ticket) only needs a single signal: "a newer build exists." Design that signal now as its own small seam — e.g. a hook/event that says `{ updateAvailable: boolean }` — backed today by the polling comparison described in §2.2. If/when offline support becomes an explicit buffi requirement, vite-plugin-pwa's `'prompt'` strategy produces the *same shaped* signal (`onNeedRefresh`) from a service worker instead of a poll; swapping the implementation behind that seam is a contained change, not a rewrite of whatever UX was built to consume it. Concretely, that means: inject a build-time version constant via Vite's `define` (a git commit SHA is the natural choice, and would need to be threaded in via a build-time env var since buffi's Railway deploys go through `railway up` rather than a GitHub-integrated build that might supply this automatically); emit a small static `version.json` into `apps/app`'s own build output requiring no changes to `apps/sync`; and poll it on an interval plus `visibilitychange`, cache-busted, comparing against the compiled-in constant. Revisit the service-worker path specifically when — and because — offline support is asked for on its own merits, not as a side effect of solving update detection.
