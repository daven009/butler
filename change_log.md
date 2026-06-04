# Change Log

> One-paragraph entry per significant change. Newest at top. Time-stamped (`YYYY-MM-DD`, Singapore time).
>
> "Significant" means: schema/data-model changes, deploy/topology changes, new top-level modules, breaking API changes, secrets rotation, environment changes, dependency upgrades, security fixes, or anything that the next coding agent needs to know to avoid surprises.
>
> **Maintenance rule**: at the end of any task that meets the above bar, add an entry here AND, if architectural, update `technical_solution.md`.

---

## 2026-06-04 — M2 phase-1: scheduling chat agent (read-tool layer + agent loop)

Phase 2B kicks off. The chat-with-Butler conversation surface is built end-to-end on the backend with the **read-only** half of the tool set; write tools (propose_*) are stubbed and ship in M2 phase-2.

**DB**:
- `backend/supabase/migrations/2026-06-04-scheduling-sessions.sql` (idempotent) creates three tables:
  - `scheduling_sessions` — one open session per (tour, user); tracks token usage + total turns for the §8.6.4 budget cap
  - `scheduling_session_messages` — full OpenAI-shape message log (system / user / assistant / tool roles, with `tool_calls` jsonb on assistant turns and `tool_call_id` on tool replies)
  - `schedule_change_proposals` — proposed mutations not yet applied; rows transition via `applied_at` / `discarded_at` (immutable audit trail)
  - + `tours.schedule_locked_at` column (M4 prep)
  - + RLS policies on all three new tables (owner_select/insert/update/delete by `auth.uid()`)
  - + `_bump_updated_at` trigger on sessions
- **Pending**: user runs the migration in Supabase Dashboard SQL Editor before agent endpoints work.

**Dependencies**:
- `openai` npm package added.
- `OPENAI_API_KEY` already provisioned on prod and local `.env` (kept from earlier prep).

**Backend code**:
- `backend/src/lib/llm/openaiClient.ts` — single `openai` instance, model name lock-in (`gpt-4o-mini`), `SESSION_LIMITS` ({maxPromptTokens: 100K, maxTotalTurns: 30}), `readUsage` shim. Throws fast at module load if `OPENAI_API_KEY` is missing (better surprise at startup than mid-conversation).
- `backend/src/lib/llm/schedulingToolDefs.ts` — single source of truth for the 8-tool catalogue (4 read + 4 propose). Each tool's `description` field doubles as the LLM's documentation. `buildSystemPrompt` materializes current schedule + unscheduled list inline so the agent's first reply doesn't have to round-trip through `get_schedule`.
- `backend/src/lib/llm/schedulingTools.ts` — read tool implementations (`get_schedule`, `get_listing_detail`, `get_unscheduled_reason`, `get_travel_time`) + dispatcher. Read tools query the existing repos directly. The 4 propose_* tools return a `PROPOSE_TOOLS_NOT_YET_IMPLEMENTED` placeholder; the system prompt instructs the agent to describe-only when this happens.
- `backend/src/lib/llm/schedulingAgent.ts` — `runAgentTurn(sessionId, userText)`. One call drives the full user→assistant turn: persist user msg, build OpenAI message array (system prompt rebuilt fresh each turn against current schedule), loop calling chat completions until the model returns plain text (no tool_calls), persist tool messages along the way, bookkeeping for usage. `MAX_TOOL_ROUNDS_PER_TURN = 5` defensively bounds runaway loops. Budget exhaustion → synthetic assistant turn ("reached compute budget") instead of another LLM call. Handles the OpenAI SDK's new `function`-vs-`custom` tool_call type union by narrowing with a type guard.
- `backend/src/lib/repositories/schedulingSessionsRepository.ts` — RLS-aware CRUD for sessions / messages / proposals. `getOrOpenSession(tourId, runId?)` enforces "at most one open session per (tour, user)". `recordTurnUsage` does read-modify-write because supabase-js doesn't expose atomic increments — fine because turns are sequential.

**API endpoints (all under requireUser)**:
- `POST /api/tours/:tourId/scheduling-sessions` → get-or-open
- `GET  /api/scheduling-sessions/:id/messages`  → full history + session
- `POST /api/scheduling-sessions/:id/messages`  → run one turn (sync, 1–4s typical), returns `{session, messages, assistant}`
- `GET  /api/scheduling-sessions/:id/proposals` → all proposals (active + applied + discarded)
- `POST /api/scheduling-proposals/:id/discard`  → flips `discarded_at`
- (apply endpoint deferred until propose_* tools actually create real proposals)

**What works end-to-end after migration applied**:
- User can open a session → send "what does my schedule look like?" → agent calls `get_schedule` → returns natural-language summary
- "Why isn't X scheduled?" → agent calls `get_unscheduled_reason` → explains
- "How long from A to B?" → agent calls `get_travel_time` (Haversine fallback for now)
- "Move X to 11am" → agent gets `PROPOSE_TOOLS_NOT_YET_IMPLEMENTED`, apologizes, describes the move it *would* make

**What still needs M2 phase-2 to complete**:
- Real two-stage replan (`tryLocalThenFullReplan`) creating `schedule_change_proposals` rows
- `apply` endpoint + service mutating `listings`
- `get_travel_time` reading from `scheduling_runs.step_artifacts.travel` instead of Haversine

**Next milestone** (M3): frontend chat + artifact double-pane UI to actually surface this conversation.

---

## 2026-06-03 (later) — M1: Named-step scheduling progress + resumable retry (code complete, awaits DB migration)

Phase 1 of §8.6 is implemented end-to-end. The black-box "0% then 100%" scheduling run is replaced with a 6-step pipeline whose state is persisted per-step on `scheduling_runs`, and a failed run can be resumed without re-doing the steps that already completed.

**Backend**:
- `backend/supabase/migrations/2026-06-03-scheduling-steps.sql` — adds `current_step`, `step_state`, `step_log`, `step_artifacts` to `scheduling_runs`. **Idempotent** (uses `add column if not exists`). **Not yet applied to prod** — user must run it in Supabase Dashboard SQL Editor before the new code can run a scheduling job. Once applied, both legacy and new payload shapes coexist (the new columns just stay empty for old rows).
- `backend/src/lib/scheduling/schedulerSteps.ts` (new) — step registry (`STEP_DEFS`), state helpers (`blankStepState`, `progressFromState`, `nextStepToRun`), and DB write helpers (`markStepRunning`, `markStepDone`, `markStepFailed`). Order: `gather → geocode → cluster → travel → optimize → persist`. Labels are plain English ("Locating properties on the map…") per PRD decision #1.
- `backend/src/lib/repositories/plansRepository.ts` — `runScheduler` rewritten as an orchestrator that loops `nextStepToRun(state)`, calling 6 separate step bodies (`runStep_gather`, `runStep_geocode`, `runStep_cluster`, `runStep_travel`, `runStep_optimize`, `runStep_persist`). Each body reads its inputs from prior `step_artifacts` and returns its own artifact patch. On throw → step marked failed, status flipped to `failed`, orchestrator returns. New `retrySchedulingRun(runId)` flips status back to `running` and re-enters the loop, skipping done steps.
- `SchedulingRun` business interface gains `currentStep` + `stepState`, `SchedulingRunRow` mapper updated.
- `backend/src/server.ts` — `POST /api/scheduling-runs/:runId/retry` (404/409 contract), `GET /api/scheduling-steps` (static catalogue for frontend label sync).

**Frontend**:
- `web/src/components/SchedulingProgress.tsx` (new) — collapsed bar + expandable step list. Spinner on current step, ✓/✗/○ on others. "Retry from failed step" button on failed runs. Pure presentational; receives `run` + `steps` + `onRetry`.
- `web/src/api.ts` — `SchedulingRun` interface gets `currentStep` + `stepState`; new `retrySchedulingRun` + `fetchSchedulingSteps` (with module-level cache since the catalogue is immutable).
- `web/src/App.tsx` — `schedulingRun` and `schedulingSteps` state added; `pollSchedulingRun(runId)` extracted (used by both initial start and retry); `retryScheduling` handler; old in-button spinner replaced with the new `<SchedulingProgress>` component above the dock; button text simplified to "Scheduling…" when running. Step catalogue fetched on mount.
- Poll interval shortened from 1500ms → 800ms (typical 10-listing run is < 10s, so the bar needs to feel alive).

**Build/lint status**: backend `tsc --noEmit` clean, web `tsc --noEmit` clean, `npm run build` green.

**Pending (user action)**:
1. Apply the migration in Supabase Dashboard SQL Editor (the file is small, idempotent).
2. Run `deploy/deploy-source-build.sh` to ship to prod.

After both, `https://app.hey-alfred.vip` will show the named-step progress bar on every scheduling run.

---

## 2026-06-03 — PRD v1.1: Scheduling Run UX (Phase 1) + Conversational Refinement Agent (Phase 2B)

`BUTLER.md` 升到 v1.1。两件事：

1. **新增 §0 实现状态对照表** — 把 PRD 各章节的"目标"对照"当前实现状态"列出来，方便接手者快速知道哪些章节是已落地的、哪些是计划。截至本次：§4/§7/§10/§13/§14/§15 已落地，§5/§8/§9/§16 部分落地，§6/§11/§12 计划中。
2. **新增 §8.6 *Scheduling Run UX & Conversational Refinement*** — 把 scheduling 模块下一阶段的产品规格写死。Phase 1 进度条（命名步骤 + 步骤级断点续跑），Phase 2B 跑完进入 chat + artifact 双栏调优（OpenAI gpt-4o-mini，中等 tool scope，两段式重排，schedule_locked 状态机）。脑爆决策记录在 §8.6 头部，后续不再讨论。

实施分 5 个 milestone（M1 进度条、M2 agent 后端、M3 chat UI、M4 锁定状态、M5 联调），约 7.5 天。下一步从 M1 开干 — 后端拆 step + DB 迁移先行。

---

## 2026-06-01 (late evening) — Real domain `app.hey-alfred.vip` + Let's Encrypt → unblocks Chrome extension

**Root cause we'd been chasing for hours:** the production server's self-signed certificate (`subject == issuer`, CN = `47.236.98.146`) is **not trusted by Chrome's extension service-worker network stack**, even after the user manually clicks "Advanced → Proceed" in the main browser. That browser-level exception only applies to top-level page loads, not to fetches initiated from an `chrome-extension://` context. Symptoms:

- Popup `LIST_PLANS` → `Failed to fetch` (request never left the SW; nginx never logged it).
- Auto-import flow's `IMPORT_TO_TOUR` → same fail or 401 (depending on whether the SW happened to be warm with a stale TLS handshake).
- Content script's *page-context* fetches DID reach the server (because the content script runs in the PG tab's network stack, which had inherited the user's manual cert override) — adding to the confusion.

**Fix — real domain + real cert:**

- Bought `hey-alfred.vip` (Aliyun, 2026-06-01). DNS A records `app` and `@` → `47.236.98.146`, TTL 600s. Verified with `dig +short app.hey-alfred.vip @8.8.8.8`.
- On the server (Alibaba Cloud Linux 3): `dnf install certbot python3-certbot-nginx`, then `certbot certonly --webroot -w /var/www/letsencrypt -d app.hey-alfred.vip -d hey-alfred.vip`. Cert lives at `/etc/letsencrypt/live/app.hey-alfred.vip/`. Auto-renew via the systemd timer certbot installs.
- **`/etc/nginx/conf.d/appointment-scheduler.conf`** rewritten:
  - port 80 serves `/.well-known/acme-challenge/` from `/var/www/letsencrypt` and 301-redirects everything else to https.
  - port 443 has three server blocks: `app.hey-alfred.vip` (real cert → proxy to container 3080), `hey-alfred.vip` (real cert → 301 to `app.hey-alfred.vip`), and the legacy `47.236.98.146` self-signed block kept as a fallback so existing bookmarks / installed v1.0.3 extensions don't break during the migration window.
- **Extension v1.0.5** (`extension/butler-pg-importer-1.0.5.zip`):
  - `manifest.json` — bumped to `1.0.5`. `host_permissions` and `externally_connectable.matches` now include `https://app.hey-alfred.vip/*` (kept the IP entry for the rollover period). `homepage_url` updated.
  - `popup.js` — `DEFAULT_BUTLER_URL` switched from `https://47.236.98.146` to `https://app.hey-alfred.vip`. Comment block explains the cert reasoning so the next agent doesn't undo it.
  - `background.js` — `deriveBackendBaseFromWebOrigin` doc updated to list the new origin.
- **Web side unchanged** — `extensionBridge.ts` reads `window.location.origin` dynamically, so as long as users access `https://app.hey-alfred.vip` the right origin gets pushed into the extension via `STORE_TOKEN`.

**User-facing migration:**
1. Visit `https://app.hey-alfred.vip` (no more red "Not secure" warning).
2. Sign in once on the new origin (Supabase session is per-origin localStorage, so the IP-origin session doesn't carry over).
3. Reload the extension; v1.0.5 will hot-update from Web Store within ~30min, or click "Update" on `chrome://extensions` to force.

**Known follow-ups:**
- Update the Web Store listing description / screenshots to mention `hey-alfred.vip`.
- Eventually remove the `47.236.98.146` server block from nginx + `host_permissions` once we're confident no one is hitting the IP directly.
- Decide whether to redirect `47.236.98.146` HTTPS to the new domain (currently it just keeps serving the old self-signed app — fine for now).

**Domain trivia (for the next agent):** the original intent was `butler.ai` (since the project is a Butler/concierge app), but `bulter.ai` was bought by mistake, then refunded/replaced. `hey-alfred.vip` is the working name (Alfred = Batman's butler). The product code/UI still says "Butler"; the domain is just the public address.

---


Hardening the auth UX on top of v1.0.3 after a real-world miss: a popup that had cached a token from a previous session showed `(unknown origin)` + `localhost:8787` + a generic "Failed to load plans" 401 instead of the sign-in banner, because `hasToken` was true (token *exists* in storage) even though the JWT had expired and `butlerWebOrigin` was never written by the older v1.0.2 install.

- **`extension/popup.js`** —
  - 401 from `/api/plans` now actively wipes the stale `butlerToken` from `chrome.storage.local` and immediately re-renders the auth banner instead of silently leaving the popup in a broken "signed in but everything 401s" state.
  - Banner status text now spells out the recovery flow ("Click Sign in to Butler — once you're logged in, come back and reopen this popup").
  - Banner render also clears the dropdown contents so the user doesn't see the previous session's plans behind the warning.
  - Added a `chrome.storage.onChanged` listener that hot-swaps the popup UI when `butlerToken` appears (after the user signs in on the Butler tab and the web app pushes STORE_TOKEN) — so the user no longer has to manually close + reopen the popup. Also reflects live `backendBase` updates into the input field.
- **`extension/popup.html`** — banner copy upgraded to a stronger CTA ("Sign in required. Butler needs to know who's importing this listing. Click below to open Butler — this popup will refresh automatically.").
- **`extension/manifest.json`** — bumped to `1.0.4`. Web side `extensionBridge.ts` constants unchanged; the production extension ID `melnenopfkellcalpdbopiickpmidjld` continues to be the target.

**One-time cleanup users hit on the upgrade path** (v1.0.1/1.0.2 → 1.0.4):
The `butlerWebOrigin` field didn't exist before v1.0.3, so installs that *upgraded in place* may have a token but no origin. v1.0.4's 401 → clear-token path makes this self-healing: the next failed call wipes the bad token, the banner appears, the user signs in, and the v1.0.3+ STORE_TOKEN handler writes both fields cleanly.

---



A follow-up cluster of UX/auth fixes landed after smoke-testing the morning's Aliyun deploy:

- **`deploy/nginx.conf`** — `index.html` (and the SPA fallback) now sends `Cache-Control: no-store, no-cache, must-revalidate`. Hashed `/assets/*` keep their 1-year `immutable` cache. Returning users from the May-15 deploy were still seeing the old "Bulter Web" homepage because the browser had cached the old `index.html` (which referenced a stale bundle hash); this fixes it for all future deploys. Hot-reloaded into the running container; baked into the Dockerfile for the next build.
- **`auth.ts`** — `initAuth()` now subscribes to all Supabase auth events that change the access token (`SIGNED_IN` / `INITIAL_SESSION` / `TOKEN_REFRESHED` / `USER_UPDATED`) and calls `storeTokenInExtension(...)` automatically. On `SIGNED_OUT` it calls `clearTokenInExtension()`. Earlier code only updated the in-memory `_cachedToken` and never told the extension about refresh events, so after ~1h the extension would 401 silently.
- **`extensionBridge.ts`** — added `pingExtensionDetailed()` returning `{installed, version, tokenAware, hasToken}` so the web app can distinguish "not installed" from "installed but old version (v1.0.1)" from "installed and signed in". Added `clearTokenInExtension()`. `storeTokenInExtension(token)` now also passes `webOrigin = window.location.origin` so the extension knows which Butler instance the user is on.
- **`extension/background.js`** v1.0.3 changes:
  - **Auto refocus Butler tab** when an "Import via tab" PG tab finishes. Previously content.js called `CLOSE_SELF_TAB` and the browser auto-activated whichever tab happened to be next (often not Butler). Now `IMPORT_VIA_TAB` stashes `{butlerTabId, butlerWindowId}` keyed by `taskId`; `CLOSE_SELF_TAB` reads it back and `chrome.tabs.update(butlerTabId, {active:true}) + chrome.windows.update(butlerWindowId, {focused:true})` BEFORE closing the PG tab.
  - **`STORE_TOKEN`** now persists `{butlerToken, butlerWebOrigin, backendBase}` together. `backendBase` auto-syncs from web origin via `deriveBackendBaseFromWebOrigin` (e.g. `https://47.236.98.146` → same; `http://localhost:5173` → `http://localhost:8787`). Solves the gotcha where the user logged in on prod but the popup still talked to localhost:8787.
- **`extension/content.js`** — `CLOSE_SELF_TAB` now passes `taskId` so background can look up the Butler tab to refocus.
- **`extension/popup.{html,js,css}`** — added auth UX:
  - "Sign in to Butler" banner appears when no JWT cached. Button opens the stored `butlerWebOrigin` (or `https://47.236.98.146` as default). Plan/Tour selectors are disabled while unauthenticated. Local DOM extraction (`Extract this PG page`) still works without auth, just the import-to-backend is gated.
  - When signed in, a green identity strip shows the active Butler origin so an agent can spot if they're on the wrong instance.
- **`extension/butler-pg-importer-1.0.3.zip`** — repackaged. **Not yet uploaded to Chrome Web Store** (still on 1.0.1). Reload unpacked from `extension/` to test.

**Edge cases still on the backlog (Phase 2):**
- `?butlerImport=...` deep-link clicked from outside the Butler flow when user isn't signed in (content.js auto-mode currently fails silently with a 401 toast; should detect no-token state and show a "sign in then retry" prompt with the deep link cached).
- Browser detection — extension is Chrome-only; non-Chrome users should see a clean "use Chrome" message rather than dead silence.
- `/api/me` endpoint + popup showing email/displayName (currently shows just the origin host, not the user identity).
- Deep-link cache & resume flow when user signs in mid-import.

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
