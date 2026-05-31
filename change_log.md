# Change Log

> One-paragraph entry per significant change. Newest at top. Time-stamped (`YYYY-MM-DD`, Singapore time).
>
> "Significant" means: schema/data-model changes, deploy/topology changes, new top-level modules, breaking API changes, secrets rotation, environment changes, dependency upgrades, security fixes, or anything that the next coding agent needs to know to avoid surprises.
>
> **Maintenance rule**: at the end of any task that meets the above bar, add an entry here AND, if architectural, update `technical_solution.md`.

---

## 2026-06-01 — Supabase auth + multi-tenant integration + first auth-enabled Aliyun deploy

**What landed (one big day):**

- **Frontend (`web/`)** — wired up Supabase email/password auth (`SignIn.tsx`, `auth.ts`, `supabaseClient.ts`). `App.tsx` now subscribes to the auth session and redirects to `<SignIn />` while unauthenticated. The whole TS toolchain (tsconfig, Tailwind, full shadcn/ui under `web/src/components/ui/`) was restored from `web/.git` (Daven's `daven009/butler-web` repo embedded as a nested standalone git). Removed the legacy iOS phone-frame demo (`App.jsx`, `screens/`, `components/`, `clientStore.jsx`) — archived under `_archive_2026-06-01/_legacy_phoneframe/`.
- **Backend** — added `supabase.ts` (admin + per-user clients), `userContext.ts` (per-request `AsyncLocalStorage` carrying `userId` + `jwt`), refactored `plansRepository`, `conversationsMock`, `planSchedule` to call Supabase via the user's JWT (so RLS auto-filters). Mounted `requireUser` middleware at `app.use('/api', requireUser)`. New endpoints: `GET/POST /api/plans`, `GET/POST /api/plans/:planId/tours`. Added `scrapeQueue.ts` (PropertyGuru scraper concurrency control, used by both `/api/scrape/...` and the extension import path).
- **DB schema** — `backend/supabase/schema.sql` introduces `plans`, `tours`, `listings`, `conversations`, `routes`, `scheduling_runs`, `attention_items` (all `user_id`-scoped, RLS enabled) and `pg_listings_archive` (cross-user cache, service-role only).
- **Chrome extension v1.0.2** — closed the auth gap. v1.0.1's `background.js` called the backend without `Authorization`, which would 401 once `requireUser` was on. v1.0.2:
  - Handles `STORE_TOKEN` / `CLEAR_TOKEN` in `onMessageExternal`. The Butler web app pushes the user's Supabase JWT via `chrome.runtime.sendMessage` after sign-in.
  - JWT cached in `chrome.storage.local.butlerToken`.
  - All `postToBackend` / `getJsonFromBackend` go through `buildAuthHeaders()` which auto-adds `Authorization: Bearer <jwt>`.
  - `PING` now returns `{ version, hasToken }` so the web app can tell whether token push succeeded.
  - Friendlier 401 message ("Not signed in to Butler. Open Butler in another tab and sign in, then retry.").
  - Bumped `manifest.json` version 1.0.1 → 1.0.2. Rezipped as `extension/butler-pg-importer-1.0.2.zip`. **Not yet uploaded to Chrome Web Store** — needs manual upload by the developer account holder.
- **Deployment** — first Aliyun deploy of the Supabase-integrated build. Server: `47.236.98.146`, Alibaba Cloud Linux 3, Docker 26 + Compose v2.27. Dockerfile multi-stage (vite frontend build → tsc backend build → node:22 runtime with nginx + Xvfb for Playwright headed). Host nginx terminates TLS (self-signed) and reverse-proxies 443 → 127.0.0.1:3080.
- **Deploy scripts** — `deploy/deploy-source-build.sh` rewritten:
  - Now scps the local `.env` to the server (the original script forgot this step, causing `env file not found`).
  - Switched server-side build from bare `docker build` to `docker compose build` so the `args:` block in `docker-compose.yml` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE=/api`) is properly forwarded into the Vite build, baking the right env into the JS bundle. Without this, the front-end ships with empty `import.meta.env.VITE_SUPABASE_URL` and white-screens with `[supabase] Missing VITE_SUPABASE_URL`.
  - Pre-flight check: aborts if local `.env` is missing.
  - Tar-excludes `web/.git`, `_archive_*`, `_recovered`.
- **Stack bumps**:
  - `backend/package.json` — added `@supabase/supabase-js@^2.106.2` (was hoisted at root only, breaking docker build).
  - `Dockerfile` — node:20 → node:22 in all three stages (supabase-js v2 realtime needs native WebSocket which Node 22 has).
  - `web/package.json` — restored from Daven's repo (was reduced to a 3-dep stub by an earlier overwrite event); now includes the full Tailwind + shadcn + radix dep set, plus our new `@supabase/supabase-js`. React 18 → 19.
- **Tooling / hygiene**:
  - `.gitignore` overhauled: covers `**/.env*`, `_archive_*`, `_recovered`, `appointment-scheduler.tar.gz`, `debug_video/`, all caches (`**/.vite`, `**/.playwright`, `**/.playwright-cli`), `backend/data/butler-web-store.json`, `backend/data/geocode-cache.json`, `*.before-restore`, `*.bak`.
  - Recovered ~30 files from CodeBuddy local history after a workspace overwrite event clobbered today's work (App.tsx + 20 sibling files, full deploy/ scripts, several backend lib files). All recovery snapshots archived under `_archive_2026-06-01/_recovered/` for reference.
  - Git author for this repo set to `songshufang <songshufang1@gmail.com>` (was incorrectly `shufangsong@tencent.com` previously).
- **Branch** — landed on a new branch `staging-supabase-integration` (based on Daven's `bb9c5d4`). The remote `staging` had been force-pushed with author `<p@ssword1987>` (a misconfigured email = real OneMap password) — same code, different author metadata. We didn't touch that history; rotate the OneMap password when convenient.

**Known limitations carried into next iteration:**
- `backend/data/pg-listings.json` and `backend/data/geocode-cache.json` are still local JSON, per-machine. Should move into Postgres tables.
- Legacy local-JSON repos under `backend/data/butler-web-store.json` (clients, settings, old tours) still power some endpoints; not yet migrated.
- `frontend/` (Next.js prototype) still in repo because root npm workspaces references it. Plan to delete once we're sure no script references it.
- Extension v1.0.2 is built but not yet uploaded to the Chrome Web Store. Until then, agents using v1.0.1 from the Web Store will still 401 on every backend call. Workaround: load v1.0.2 unpacked from `extension/`.
- `scrapePropertyGuruListingDetail` in `propertyGuru.ts` is a stub that throws "not implemented" (the original implementation was lost in the overwrite and was never in IDE local history). Single-detail import via the `/api/tours/:id/import` route is currently broken; search-results URLs and the extension path both work.

---

## (older entries)

This is a brand new file — earlier history is captured in git log on `daven009/butler` (`bb9c5d4` and ancestors). For pre-2026-06-01 changes refer to commit messages.
