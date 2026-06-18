# Technical Solution — Butler / Appointment Scheduler

> **Audience**: future coding agents (Codebuddy, Claude, Cursor, GPT, …) and any developer joining the project.
> **Purpose**: a *concise* but *current* picture of the architecture so you don't have to re-scan the entire repo on every task.
>
> **Maintenance rule**: after any significant change (data model, routes, deployment topology, secrets, dependencies, dev workflow), update this file in the same turn. Then add a one-paragraph entry to `change_log.md`.

Last updated: **2026-06-14** (listing briefs are the only scheduling entry point).

---

## 1. Product, in one paragraph

Butler is a **viewing-tour planning platform** for independent property agents in Singapore. An agent creates a "plan" for a buyer client, imports candidate listings (manually, via PropertyGuru search/detail scraper, or via a Chrome extension that scrapes the page the agent is currently on), confirms buyer + opposing-agent availability, and lets the system compute a route-aware viewing schedule. Authentication is per-agent (one Supabase user = one agent's workspace). RLS enforces that one agent never sees another's plans/listings.

---

## 2. Repo layout

```
appointment_scheduler/
├── web/                     ← React + Vite + TS frontend (the active one).
│                              Origin: cloned from Daven's daven009/butler-web,
│                              now integrated. web/.git is a NESTED standalone
│                              git repo pointing at daven009/butler-web — DO NOT
│                              push to it; only push the parent repo's `staging`
│                              (or `staging-supabase-integration`) branch on
│                              `daven009/butler`.
├── backend/                 ← Express + TypeScript (tsx) API server.
├── extension/               ← Chrome MV3 extension "Butler PG Importer".
├── deploy/                  ← Aliyun deployment scripts + nginx configs.
├── frontend/                ← LEGACY Next.js prototype. Still in repo because
│                              root package.json's npm workspaces references it,
│                              but no longer the production UI. Safe to ignore.
├── _archive_2026-06-01/     ← Quarantined backups (gitignored). Contains the
│                              old phone-frame demo, recovery snapshots, the
│                              previous technical_solution.md. Don't push.
├── BUTLER.md                ← Visual / interaction design language.
├── DESIGN.md                ← Higher-level UX spec (older).
├── DEV_PLAN.md              ← Roadmap notes (sparse).
├── DEPLOYMENT_GUIDE.md      ← End-user deploy runbook (also kept current).
├── README.md                ← OUTDATED (Next.js era). Don't trust for arch info.
├── technical_solution.md    ← THIS FILE.
└── change_log.md            ← Running log of significant changes.
```

Extras at root (gitignored):
- `.env` — root-level. Used by `docker compose` build/run; mirrors `backend/.env`.
- `appointment-scheduler.tar.gz` — large local-only artifact (unrelated OCI image archive). Keep but never push.
- `node_modules/`, `web/node_modules/`, `backend/node_modules/`.

---

## 3. Stack at a glance

| Layer | Tech | Notes |
|---|---|---|
| Frontend | **React 19 + Vite 7 + TypeScript** | Single-file `web/src/App.tsx` (~2200 LOC) holds most of the UI. Tailwind + shadcn/ui (full library under `web/src/components/ui/`). |
| Routing | **No router** | App.tsx is one big SPA; no `react-router-dom` is imported by the actual code. (There's an `index.html` script tag pointing at `/src/main.tsx`.) |
| Auth | **Supabase Auth (email + password)** | `web/src/auth.ts` + `web/src/SignIn.tsx`. JWT carried in `localStorage` by `@supabase/supabase-js`. Backend verifies it on every `/api/*` call. |
| State | Local component state in App.tsx + Supabase client cache | No Redux/Zustand. |
| Frontend HTTP | `web/src/api.ts` | Reads `import.meta.env.VITE_API_BASE` (default `/api`); auto-attaches `Authorization: Bearer <jwt>` from the Supabase session. |
| Backend | **Node 22 + Express + tsx (dev) / `tsc` (prod)** | Single `backend/src/server.ts` (~570 LOC) declares all routes. |
| Backend HTTP middleware | `requireUser` mounted at `app.use('/api', requireUser)` | Decodes Supabase JWT, calls `runWithUser({userId, jwt}, next)` so each request runs in an `AsyncLocalStorage` user context. Repositories read `getCurrentUserId()` / `getCurrentJwt()` to call Supabase **as the user**, so RLS is enforced. |
| DB | **Supabase Postgres (Singapore region)** | Schema in `backend/supabase/schema.sql`. |
| LLM | **OpenAI** (`gpt-4o-mini`-class) | Used to extract structured fields from raw PG listing text. |
| Maps / geocoding | **OneMap (Singapore gov't)** | Free with login; `backend/src/lib/scheduling/oneMapClient.ts` auto-refreshes token via `ONEMAP_EMAIL` + `ONEMAP_PASSWORD`. Geocode results cached in `backend/data/geocode-cache.json` (gitignored, per-machine). |
| Scraper | **Playwright (Chromium)** | `backend/src/lib/scrapers/propertyGuru.ts` (~1300 LOC). On the server we run with `Xvfb :99` (see `deploy/start.sh`) so headed Chrome can pass Cloudflare Turnstile. Concurrency-limited via `backend/src/lib/scrapers/scrapeQueue.ts`. |
| Extension | **MV3, vanilla JS** (Manifest 3, service worker + content script) | Lives in `extension/`. See § 7 below. |
| Build / package | **npm workspaces** at root (`frontend`, `backend`); `web` is intentionally *outside* the workspace because it's a separate vendor-style project. | `npm install` from root only installs frontend+backend. For web, do `cd web && npm install` separately. |

---

## 4. Backend — routes & rules

All routes live in `backend/src/server.ts`. Auth boundary is the line `app.use('/api', requireUser)` — anything under `/api/*` requires a valid Supabase JWT in `Authorization: Bearer …`.

Public:
- `GET /health` — `{ ok: true }`. Used by docker healthcheck and host nginx.
- `GET /api/share/:token` — read-only client-facing route view (uses Supabase RPC).

Auth-required (`/api/*`):

| Group | Endpoints | Backed by |
|---|---|---|
| Plans | `GET /api/plans`, `POST /api/plans`, `GET /api/plans/:planId/tours`, `POST /api/plans/:planId/tours` | `lib/repositories/plansRepository.ts` (Supabase: `plans`, `tours`) |
| Tours | `GET/PATCH/POST /api/tours/:id...` (listings, buyer-availability, opposing-availability, coordination-events, status, generate-schedule, etc.) | Same repo + `lib/scheduling/planSchedule.ts` |
| Tour import | `POST /api/tours/:tourId/import` (server-side scrape via Playwright), `POST /api/tours/:tourId/import-from-extension` (extension already scraped DOM, server only enriches + persists) | `lib/scrapers/propertyGuru.ts` (search/detail), `lib/scrapers/scrapeQueue.ts` (concurrency), `lib/llm/pgListingParser.ts` (extract fields), `lib/scheduling/geoCache.ts` (geocoding), `lib/repositories/pgListingsRepository.ts` (cross-user archive) |
| Conversations / decision cards | `/api/tours/:id/listings/:lid/coordination-events`, `/api/conversations/...` | `lib/repositories/conversationsMock.ts` |
| Search (legacy) | `/api/search/parse-llm`, `/api/search/filter-llm`, `/api/scrape/propertyguru` | LLM + scraper; tour-less helpers from earlier prototype |
| PG raw listings | `GET /api/pg-listings`, `POST /api/pg-listings/check`, `POST /api/pg-listings/by-ids` | `pgListingsRepository.ts` (still local JSON, see § 6) |
| Clients / Settings | `/api/clients/...`, settings endpoints | Local JSON repos (legacy) |

When something "doesn't show up" for a user in production, it's almost always RLS — every Supabase-backed query runs under the user's JWT, so a row without `user_id = auth.uid()` is invisible. This is by design.

### Scheduling chat and import flow

- Extension import remains responsible for immediately seeding idempotent mock co-agent conversations and availability. This is the temporary WhatsApp substitute.
- The frontend focuses the imported listing, switches to AI Assistant, and opens that listing's `scheduling_sessions` conversation. Session creation requires `listingId`; new global Tour conversations are rejected.
- The Listing LLM interprets natural language and finalizes a structured brief through `submit_listing_brief`. It never mutates listings or directly invokes Tour-level proposal tools.
- The first ready brief creates the initial Tour proposal. Every later brief loads all ready briefs and jointly replans all ready, unconfirmed listings.
- Confirmed listings are immutable inputs to this replan. Their persisted slots plus a 15-minute buffer are subtracted from buyer availability before `planSchedule` handles the remaining candidates.
- Apply accepts local proposals and complete full-tour proposals. Unknown cascade destinations, stale source slots, and empty proposals return 409.
- `planSchedule` is a deterministic greedy/cluster heuristic. It optimizes the whole current candidate set under fixed confirmed slots, but does not provide a mathematical global-optimum guarantee.

---

## 5. Database schema (Supabase)

Source of truth: `backend/supabase/schema.sql`. To bring up a fresh project, paste the file into the Supabase SQL editor.

Per-user, RLS-protected tables (all carry `user_id uuid references auth.users(id)`):
- `plans`, `tours`, `listings`, `conversations`, `routes`, `scheduling_runs`, `attention_items`

Public (cross-user) cache, RLS disabled, **service-role only**:
- `pg_listings_archive` — one row per PG listing, dedup by `pg_listing_id`. Frontend never touches it; backend writes via `service_role`.

A single `set_updated_at` trigger mirrors `updated_at` on every UPDATE. RLS policies are the standard Supabase pattern: `using (auth.uid() = user_id)` + same for `with check`.

---

## 6. Where each piece of state lives

| Data | Location | Why |
|---|---|---|
| Auth users | `auth.users` (Supabase) | Provider-managed |
| Plans / tours / listings / conversations / routes / scheduling runs / attention items | `public.*` tables (Supabase, per-user RLS) | Multi-tenant, durable |
| PG raw listings cache (full DOM scrape) | `public.pg_listings_archive` (Supabase, cross-user, service_role) | One agent's scrape benefits all agents — no PII leaks because we don't store agent-private fields here |
| **Geocoding cache** | `backend/data/geocode-cache.json` (gitignored, **per-machine**) | TODO: move to DB so production and dev share one cache |
| **PG scrape result archive (legacy local copy)** | `backend/data/pg-listings.json` (gitignored, **per-machine**) | TODO: deprecate, only `pg_listings_archive` should exist |
| **Legacy: butler / clients / tours JSON** | `backend/data/butler-web-store.json` etc. (gitignored) | Older `/api/clients`, `/api/tours/...` routes still read from these. Slated for migration. |

If you see a stale-data bug ("the listing is there for me but not for them"), it's almost always one of: (a) the data is in the local JSON cache, not Supabase; or (b) the Supabase row has the wrong `user_id` and RLS hides it.

---

## 7. Chrome extension — "Butler PG Importer"

Location: `extension/`. Distributed as `extension/butler-pg-importer-1.0.2.zip` (current) and `1.0.1.zip` (previous, kept for diff). Source files (`manifest.json`, `background.js`, `content.js`, `popup.{html,css,js}`, `icons/`) are unzipped in the same folder so they're diffable in git.

### What it does
- **Manifest V3.** Service worker = `background.js`. Content script = `content.js`, runs on `https://www.propertyguru.com.sg/listing/*`.
- Two modes (set in popup):
  - **Basic** — read whatever PG already rendered. Cheap, instant, no clicks.
  - **Advanced (opt-in)** — smooth-scrolls, clicks "see more", cycles the carousel, clicks the "show phone" button (this triggers a "buyer interested" notification on PG, which is why it's opt-in). Then runs the basic extractor.
- Pushes the result to backend `POST /api/tours/:tourId/import-from-extension`.
- Also exposes an *external* API: the Butler web app calls `chrome.runtime.sendMessage(extensionId, …)` to (a) check it's installed, (b) push the user's Supabase JWT for backend auth, (c) trigger an "Import via tab" flow that opens PG, runs advanced mode, and closes the tab.

### Auth model (added 2026-06-01 in v1.0.2)
Before v1.0.2 the extension called the backend **without `Authorization`** — every call would 401 once `requireUser` was enabled. v1.0.2 fixes this:

1. After Butler web sign-in, `web/src/extensionBridge.ts → storeTokenInExtension(jwt)` posts `{type: 'STORE_TOKEN', token}` to the extension via `chrome.runtime.sendMessage`.
2. `background.js` now handles `STORE_TOKEN` (and `CLEAR_TOKEN`) in `onMessageExternal`, persists the JWT under `chrome.storage.local.butlerToken`.
3. All `postToBackend` / `getJsonFromBackend` calls in `background.js` go through `buildAuthHeaders()`, which auto-adds `Authorization: Bearer <jwt>`.
4. Backend RLS therefore sees the same `user_id` as the web app — the listing imported via extension belongs to the agent who's signed in. Users only ever see their own imports.

### Extension ID
- Production (Chrome Web Store): `melnenopfkellcalpdbopiickpmidjld`. Hardcoded as `DEFAULT_EXTENSION_ID` in `web/src/extensionBridge.ts`.
- Dev (unpacked): the ID is unstable per-machine. Override via `localStorage.setItem('butler.extensionId', '<id>')` in butler web devtools.

### Allowed origins (for `externally_connectable`)
`http://localhost`, `http://localhost:5173`, `http://127.0.0.1[:5173]`, `https://47.236.98.146`. If you change the production URL, update `manifest.json` and rebump version.

### To rebuild
```bash
cd extension
zip -r butler-pg-importer-1.0.X.zip manifest.json background.js content.js popup.{html,css,js} icons/
```
Then load unpacked in `chrome://extensions` (dev) or upload to Web Store (prod).

---

## 8. Local development

Prerequisites: Node 22+, npm 10+, a Supabase project (you can join the existing one if you have credentials, or spin up a fresh one and run `backend/supabase/schema.sql`).

```bash
# 1. Clone (one-time)
git clone git@github.com:daven009/butler.git
cd butler && git checkout staging-supabase-integration   # current active branch

# 2. Install (root npm workspaces installs frontend + backend; web is separate)
npm install
cd web && npm install && cd ..

# 3. Configure secrets — NEVER commit these
cp backend/.env.example backend/.env       # fill in Supabase URL/keys, OpenAI, OneMap
cp web/.env.example     web/.env.local     # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY

# 4. Run (two terminals)
cd backend && npm run dev      # → http://localhost:8787
cd web     && npm run dev      # → http://localhost:5173 (proxies /api → 8787)

# 5. Sign in: any email + ≥6-char password. Supabase "Confirm email" should be OFF
#    in Auth → Providers → Email for internal testing.
```

Loading the unpacked extension:
```
chrome://extensions → Developer mode ON → Load unpacked → select extension/
# Note the assigned ID, then in Butler devtools:
#   localStorage.setItem('butler.extensionId', '<that id>')
# Sign in to Butler — it will push the JWT into the extension automatically.
```

---

## 9. Deployment (Aliyun ECS)

### Topology
```
Browser ─── HTTPS ──→  47.236.98.146 (Aliyun ECS, Alibaba Cloud Linux 3)
                         ├── host nginx :443 (self-signed cert)
                         │     └── reverse-proxies to 127.0.0.1:3080
                         └── docker container "appointment-scheduler" (port :80 inside)
                                ├── in-container nginx
                                │      ├── /             → /usr/share/nginx/html (vite build)
                                │      ├── /api/*        → 127.0.0.1:8787
                                │      └── /health       → 127.0.0.1:8787/health
                                ├── node 22 + tsx running backend/src/server.ts on :8787
                                └── Xvfb :99 for Playwright headed mode
```

Server: `47.236.98.146`, root SSH (key-based), Docker 26 + Compose v2.27. Deploy dir `/opt/appointment-scheduler/` (compose runtime) + `/opt/appointment-scheduler/src/` (extracted source for `docker compose build`).

### Files
- `Dockerfile` — multi-stage. Stage 1 (`frontend-build`): `node:22-bookworm` runs `npm ci && npm run build` in `web/`. **Critical**: it reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE` as `ARG`s and bakes them into the JS bundle. If the build env doesn't have them, the bundle ships with empty strings and the front-end will throw `[supabase] Missing VITE_SUPABASE_URL` and white-screen on first load. **Always build with `docker compose build`**, never bare `docker build` — only `docker compose build` reads the `args:` block from `docker-compose.yml` and forwards env from `.env`.
- `docker-compose.yml` — exposes `127.0.0.1:3080:80`, runs healthcheck against `/health`, mounts named volumes for Playwright cache and per-tenant scratch data, reads runtime env from `.env`.
- `deploy/nginx.conf` — in-container nginx (port 80, splits `/`/`/api`/`/health`).
- `deploy/nginx-host.conf` — host-side nginx (port 80→443 redirect; 443 with self-signed → 127.0.0.1:3080).
- `deploy/start.sh` — container entrypoint: launches Xvfb, then backend, then nginx in foreground.

### Scripts
- `deploy/deploy-source-build.sh` — **the one we use**. Tars source locally, excluding local-only archives/cache/build outputs/browser profiles and secret env files, then scps it + `docker-compose.yml` + `.env` + nginx host conf to the server. It runs `docker compose build` on the server (so `VITE_*` envs are properly forwarded), then `docker compose up -d --force-recreate`, reloads host nginx, and runs healthcheck. Self-checks for local `.env` first; that `.env` is uploaded separately to the remote compose directory.
- `deploy/deploy.sh` — older variant that builds locally and ships the image as a tarball. Slow on Apple Silicon (cross-arch). Kept for reference.
- `deploy/deploy-registry.sh` — push to a docker registry then pull on server. Requires `IMAGE_REPO` env. Useful when you have an Aliyun ACR set up.

### One-time server prep (already done on 47.236.98.146)
```bash
# install docker if needed
sudo dnf install -y docker
sudo systemctl enable --now docker
# host nginx + self-signed cert at /etc/nginx/ssl/selfsigned.{crt,key}
# /etc/nginx/conf.d/appointment-scheduler.conf  ← from deploy/nginx-host.conf
```

### Redeploy
```bash
# from your laptop
cd appointment_scheduler
# make sure .env exists at repo root (cp backend/.env)
./deploy/deploy-source-build.sh
# → ~3-5 min total. Health check at the end. Browse to https://47.236.98.146.
```

### Rollback
We tag every deploy's previous image as `appointment-scheduler:backup-YYYY-MM-DD`. To roll back:
```bash
ssh root@47.236.98.146
cd /opt/appointment-scheduler
docker tag appointment-scheduler:backup-2026-06-01 appointment-scheduler:latest
docker compose up -d --force-recreate
```

### Common deploy failures we've actually hit
| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@supabase/supabase-js'` during backend tsc | Dep declared at repo root (npm workspaces hoisted), not in `backend/package.json`; Dockerfile only `COPY backend/` | Always declare backend deps inside `backend/package.json`, even if hoisted at root |
| `Node.js 20 detected without native WebSocket support` (supabase realtime) | `node:20-bookworm` base | Use `node:22-bookworm` (already done) |
| White screen + console: `[supabase] Missing VITE_SUPABASE_URL` | `docker build` instead of `docker compose build` (build args dropped) | Use `docker compose build` only |
| `405 METHOD_NOT_ALLOWED` on every `/api/*` from the web | Old `server.ts` is running (no Supabase routes) | Restart container with the new image; check `docker ps` shows the right image hash |
| `env file /opt/appointment-scheduler/.env not found` | `deploy.sh` didn't scp `.env` (the OG `deploy.sh` skipped it; fixed in `deploy-source-build.sh`) | Ensure `.env` is at repo root before deploy |

---

## 10. Secrets

All secrets live in `backend/.env` and `web/.env.local`. Both are gitignored (verified by `git check-ignore`). Repo root also has a `.env` used by docker-compose (mirror of `backend/.env`); also gitignored.

| Name | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | backend, root | Backend admin client + JWT verifier |
| `SUPABASE_ANON_KEY` | backend, web, root | Frontend & backend (user-scoped) calls |
| `SUPABASE_SERVICE_ROLE_KEY` | backend, root | Backend-only: pg_listings_archive writes, admin migrations. **NEVER ship to frontend** — Dockerfile only forwards `VITE_SUPABASE_ANON_KEY`, never service_role |
| `OPENAI_API_KEY` | backend, root | LLM listing parser |
| `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` | backend, root | OneMap (geocoding). Token is auto-fetched and refreshed |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | web | Built into the bundle by Vite |
| `VITE_API_BASE` | web (build arg in prod) | Defaults to `/api` (same origin) |

### Known historical leak (private repo, low impact)
Git history on `origin/staging` of `daven009/butler` includes 4 commits authored by `shufangsong@tencent.com <p@ssword1987>` — the email field was misconfigured to be the real OneMap password. The repo is private so impact is bounded, but **the password should be rotated** when convenient. New commits use `songshufang1@gmail.com`.

---

## 11. Branching

`daven009/butler` (parent repo) on GitHub:
- `main`, `master` — abandoned old prototypes. Don't push there.
- `staging` — Daven's old staging line. Currently 4 commits with the leaked-email author, content identical to the original Daven commits. Don't touch unless rewriting history.
- `staging-supabase-integration` — **active**. Where this whole Supabase + extension auth + Aliyun deploy work lives. Push here.

`daven009/butler-web` (Daven's web repo, embedded as `web/.git`): READ-ONLY for us. Never push.

---

## 12. Things future agents should know before changing stuff

1. **Don't `npm install` at root expecting it to install web's deps**. Web is a separate project. Always `cd web && npm install` for it.
2. **Don't put runtime backend deps only at the repo root**. Even if npm workspaces hoists them, docker only copies `backend/` and re-installs from `backend/package.json`. They must be declared there.
3. **Don't bare-`docker build`**. Use `docker compose build`. The build args matter (frontend env baking).
4. **Don't push to `web/.git`'s remote** — that's Daven's repo. Push to the parent repo only.
5. **Don't commit anything from `_archive_2026-06-01/`** or `appointment-scheduler.tar.gz`. They're recovery dumps, kept locally. The `.gitignore` already covers them.
6. **Don't lower the Node version below 22**. supabase-js v2 realtime requires native WebSocket.
7. **When changing the Supabase schema**, edit `backend/supabase/schema.sql` and apply it manually in Supabase SQL editor. There is no migration tool yet.
8. **When adding a new `/api/*` route**, it inherits `requireUser` automatically. If you need a public route, declare it BEFORE `app.use('/api', requireUser)` (e.g. `/api/share/:token` is declared above).
9. **When changing the extension's externally_connectable origins**, also rebump `manifest.json` version, repackage the zip, and (if published) re-upload to the Web Store.
10. **Update `change_log.md`** at the end of any task that satisfies (1)-(9).
## 13. Listing LLM and Tour Engine boundary

Butler scheduling now has two explicit ownership layers:

- **Listing Engine (LLM)**: one `scheduling_sessions` row and message history per listing. It clarifies natural-language scheduling requirements and calls `submit_listing_brief` only when the requirements are sufficiently clear.
- **Tour Engine (deterministic)**: after every finalized brief, loads all ready briefs plus current Tour state, buyer availability, seller availability, confirmed viewings, coordinates, and travel buffers. It jointly replans all ready unconfirmed listings through `proposalsService` / `planSchedule`; it does not infer user intent from chat history.

The structured brief, rather than the raw LLM transcript, is the contract between the two layers. Confirmed viewing slots are hard constraints, proposals require explicit Apply, and infeasible listings remain in the Tour with an explanation. Because the scheduler is greedy and confirmed slots cannot move, “global” here means optimizing all currently ready candidates under those locks, not proving an unconstrained mathematical optimum.
