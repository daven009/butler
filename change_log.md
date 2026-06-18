# Change Log

> One-paragraph entry per significant change. Newest at top. Time-stamped (`YYYY-MM-DD`, Singapore time).
>
> "Significant" means: schema/data-model changes, deploy/topology changes, new top-level modules, breaking API changes, secrets rotation, environment changes, dependency upgrades, security fixes, or anything that the next coding agent needs to know to avoid surprises.
>
> **Maintenance rule**: at the end of any task that meets the above bar, add an entry here AND, if architectural, update `technical_solution.md`.

---

## 2026-06-18 — Shrink Aliyun source deploy package

`deploy/deploy-source-build.sh` now excludes local-only deployment archives (`deploy/dist`), Playwright browser profiles, build outputs, node modules, npm caches, logs and local secret files from the source tarball it uploads to Aliyun. The tar command also disables macOS xattrs, which removes the noisy `LIBARCHIVE.xattr...` warnings on the server. A local package-size check after the change reduced the upload artifact from about 830MB to about 600KB while keeping `Dockerfile`, `docker-compose.yml`, backend/web package manifests and deploy configs in the archive. Runtime/build env is unchanged because the script still uploads root `.env` separately to `/opt/appointment-scheduler/.env`.

## 2026-06-14 — Make listing briefs the only scheduling entry point

The separate Tour-level scheduling button and global Butler session path have been retired. A Tour with listings now opens directly into the selected listing's AI Schedule Brief; the first finalized brief creates the initial Tour proposal, and every later `submit_listing_brief` reloads all `ready` briefs for that Tour and jointly replans every ready, unconfirmed listing. On the first successful brief, the tool returns an explicit initialization signal and Butler deterministically tells the user that Tour scheduling has been established and the first valid listing has joined the initial proposal. Existing confirmed viewings remain fixed: their slots plus a travel buffer are removed from buyer availability before the deterministic scheduler runs, so later proposals cannot move them. Listing priority influences candidate order, proposals still require explicit Apply, and session creation now rejects requests without `listingId`. This is whole-candidate replanning under locked confirmed constraints, but `planSchedule` remains a greedy heuristic and does not claim mathematically proven global optimality. No migration was added or run.

## 2026-06-14 — Split Butler into listing sessions and a deterministic Tour Engine

Scheduling conversations are now scoped to one listing instead of sharing a single message history across the whole Tour. `scheduling_sessions.listing_id` identifies the listing thread, while the new RLS-protected `listing_scheduling_briefs` table stores the LLM's versioned structured output (`constraints`, priority, flexibility, summary, and ready/clarifying status). The Listing LLM finalizes requirements through `submit_listing_brief`; that function adds the product defaults (`include_listing` and `preserve_confirmed`) and hands the brief to the existing deterministic proposal/scheduling service, which remains the only component allowed to calculate Tour-wide changes. The frontend caches a separate session id per listing, restores existing clarification conversations after reload, and clears local chat state immediately when switching listings. A migration file was added but not executed.

## 2026-06-13 — Make buyer availability required and editable on Tours

Tour creation now requires an ISO viewing date and at least one valid 24-hour buyer availability range (`HH:MM-HH:MM`, one per line). Clicking the active Tour in the planning sidebar opens an edit dialog for its name, date, buyer availability and AI scheduling requirements; `PATCH /api/tours/:tourId` persists those edits using the existing `target_date` and `time_window` columns, so no migration is required. The scheduler and constraint proposal engine now parse buyer slots from the Tour instead of using fixed weekend mock availability, and seeded buyer-conversation copy reflects the persisted ranges. Tour sidebar metadata displays the configured availability for quick verification.

## 2026-06-13 — Show seller-agent availability above Butler chat

The focused listing's persisted seller/co-agent availability is now exposed in the frontend `Listing` type and displayed directly beneath the Butler conversation title, grouped as localized date and time windows. Listings without availability show an explicit “尚未提供” state, making infeasible scheduling explanations auditable from the chat surface. No migration was added or run.

## 2026-06-13 — Reject overlapping and cross-date scheduling proposals

Full-tour constraint proposals now re-plan only on the tour's `targetDate`, preventing two same-clock slots from different days from being collapsed into the date-less `suggested_time` field. `propose_add_constraint` now accepts a set of constraints in one call and supports `exclude_time_window`, so a lunch break such as 12:30–13:30 is represented as a blackout interval rather than being misread as “no viewings before 13:30.” It also supports `preserve_confirmed`; when requested, a re-plan that drops any confirmed listing is rejected as infeasible. Generated schedules are checked for overlaps, Apply rejects overlapping destination slots defensively, and the proposal card disables Apply for historical proposals that already contain conflicts. Infeasible insertions now report the tour date, buyer windows and co-agent windows; Butler is instructed not to retry the same failed proposal tool, and the UI exposes the concrete tool error instead of repeating opaque trace pills. No migration was added or run.

## 2026-06-13 — Gate new listings behind AI scheduling constraints

Seed-on-import still prepares deterministic mock co-agent conversations and availability because WhatsApp is not connected, but it no longer advances a newly imported listing from `imported` to `contacting`. The AI Assistant now treats each listing independently: any unscheduled listing shows the existing AI Schedule Brief start page in the center column, where the user submits natural-language scheduling preferences scoped to that listing; the request is sent through the scheduling session with listing context. The co-agent conversation is shown only after that listing is confirmed with a concrete suggested time. Starting scheduling promotes previously seeded imported listings into the active coordination state before running the scheduler. No migration was added or run.

## 2026-06-13 — Ground PropertyGuru listing identity in primary-page evidence

The extension import previously sent the entire PropertyGuru detail-page text dump to the LLM, allowing FAQ, recommendation and footer content to compete with the actual listing header and description; this caused an FAQ question to be selected as a condo/project name. Import now sends structured metadata plus bounded primary-listing and agent-contact sections, and the mapper accepts a project name only when it is present in the relevant source content. The earlier English question-prefix blacklist was removed. Existing listing `500082653` was corrected in Supabase to `291 Bishan Street 24` with an empty condo/project name, and the matching stops in the current tour's persisted route snapshots were updated to the same display data. No migration was added or run.

## 2026-06-13 — Seed conversation display and idempotency fix

The AI Assistant's co-agent panel now loads the persisted conversation for the selected tour/listing instead of deriving a hard-coded negative thread from listing status. This fixes the misleading UI where every listing appeared to receive the same "not available / change slot" response even when the deterministic seed had generated a happy-path conversation. Seed idempotency now treats an existing per-listing conversation row as the source of truth; a null listing availability is no longer normalized to `[]` and mistaken for proof that a fresh import was already seeded. The optional seed `force` flag is now wired through the API and correctly replaces the tour's mock conversations instead of appending duplicates. No migration was added or run.

## 2026-06-13 — Import-to-AI flow + constraint-driven full-tour proposals

The primary product flow now continues from Chrome-extension import directly into real Butler scheduling chat. Import still seeds idempotent mock co-agent conversations/availability because WhatsApp is not connected. After the extension returns, the frontend refreshes the tour, focuses the imported listing, switches to the AI Assistant workspace, and opens the tour's scheduling session. Scheduling messages now include optional `{ context: { listingId } }`; the agent prompt materializes that listing's status, current slot, mock availability, and attention reason so references such as "这套" resolve correctly. The previous local-only "single listing scheduling brief" textarea was removed from this path and replaced with the actual `SchedulingChat`.

`propose_add_constraint` now supports `include_listing`, `before_time`, `after_time`, `must_morning`, and `must_afternoon` by narrowing buyer/listing availability, running deterministic `planSchedule`, and storing the complete requested change + cascade diff as a `mode='full'` proposal. Full proposals with concrete destinations can be applied; Apply checks for stale source slots and performs best-effort rollback if a multi-row write fails. Proposal cards show listing names and allow full-tour Apply. Historical/manual-review proposals with unknown cascade destinations remain non-applicable in both UI and backend. Changing tour date and exact-time moves with multiple conflicts are still pending. No schema migration was added or run.

## 2026-06-13 — Merge of remote UI rewrite + retraction of M4 (lock) / persona feature set

Co-worker (`daven009`) pushed two commits to `origin/staging-supabase-integration` (`c453c47 "UI updates"` + `839a623 "Refactor scheduling activity into listing bullets"`) that effectively rewrite the frontend on a new direction: Plan/Tour CRUD UI, full Chinese (zh) localization via a new `i18n.ts`, side-panel chat retained but pulled out of the listing-detail card, scheduling activity demoted from `SchedulingProgress` mega-component to inline listing bullets. In parallel, the local branch had 6 commits adding M4 listing-lock + Butler-persona + side-by-side dock + seed-on-import. The two histories diverged from `ba09884`. **Strategy (user-approved): adopt remote frontend 100%, trim backend to match.**

**Frontend — pulled wholesale from origin/staging-supabase-integration**:
- 13 modified web/src files (App.tsx now ~3300 lines, SignIn now zh by default, api.ts gains `updatePlan/deletePlan/deleteTour` & drops `unlockListing/fetchMyPreferences/saveMyPreferences`, domain.ts removes `lockStatus/lockedSlot`)
- New: `web/src/i18n.ts` (minimal zh dictionary)
- New top-level: `AGENTS.md` (LLM behavior guidelines from co-worker; complements existing `CLAUDE.md`)

**Backend — surgical changes to match**:
- *Added* to match remote UI:
  - `PATCH /api/plans/:planId` (edit client plan from UI)
  - `DELETE /api/plans/:planId`
  - `DELETE /api/tours/:tourId`
  - `updatePlan / removePlan / removeTour` in `plansRepository.ts`
- *Removed* (no longer referenced by UI):
  - `POST /api/listings/:listingId/unlock` route
  - `GET /api/me/preferences` + `PUT /api/me/preferences` routes
  - `backend/src/lib/repositories/userPreferencesRepository.ts` (deleted)
  - All `lockStatus / lockedSlot / lockedAt` reads/writes in `plansRepository.ts`, `proposalsService.ts`, `conversationsMock.ts`
  - Step 0 "honor user-pinned slots" + `lockedInBlock` retry in `planSchedule.ts`
  - `persona` parameter on `buildSystemPrompt` + `getMyPreferences()` injection in `schedulingAgent.ts`
- *Migrations deleted from source tree* (DB rows persist — see drift note below):
  - `backend/supabase/migrations/2026-06-05-listing-locks.sql`
  - `backend/supabase/migrations/2026-06-06-user-preferences.sql`
- *Preserved* (not coupled to lock/persona; useful regardless):
  - `appendConversationsForTour` helper + seed-on-import idempotent mock (so re-running scheduling never rewrites already-seeded conversations)
  - `applyProposal()` `.select('id')` defensive check (catches silent half-applies when RLS hides the row)
  - Deploy slim-down (Dockerfile without Playwright/Chromium runtime, deploy/rollback scripts)

**DB ↔ code drift (action required, not yet done)**: prod listings table still has `lock_status / locked_slot / locked_at` columns; prod still has `user_preferences` table + RLS policies + trigger. Code no longer references any of them. Should write a down-migration but **first audit existing data** — there may be rows with `lock_status='user_locked'` from earlier testing that would need to be inspected before being dropped.

**Verification**:
- `backend npx tsc --noEmit` → exit 0
- `web npx tsc -b` → exit 0
- PATCH/DELETE routes verified live on local backend via curl (401 = route registered, just no token)
- `lockStatus|lockedSlot|locked_status|user_preferences|persona` grep across `backend/src/` → empty

**Not yet done**:
- Commit. All 22 file changes (12 modified + 2 deleted + 2 deleted-migrations + new `AGENTS.md` + new `HANDOFF.md`) are staged but not committed.
- Push to remote — branch is `ahead 6, behind 0` after merge.
- End-to-end smoke test against the new Plan/Tour CRUD UI paths.
- DB cleanup migration.

**Also updated**: `HANDOFF.md` (new — single entry point for the next agent), `DEV_PLAN.md` (M4 reclassified from "not started" to "retracted").

---

## 2026-06-04 (later) — M2 phase-2 + M3: chat-with-Butler is live (read + write tools + Apply/Discard UI)

Conversational scheduling refinement is end-to-end functional. After a scheduling run completes, the right-side dock auto-switches to a "Butler" chat panel where the user can ask questions, request changes, and click Apply/Discard on proposed mutations.

**Backend — propose_* tools + apply path**:
- `backend/src/lib/scheduling/proposalsService.ts` (new) — builders for the 4 write tools + `applyProposal()`. `propose_reschedule` does conflict detection: if the new slot doesn't overlap any other confirmed listing → `mode='local'`, single-change. If it overlaps → `mode='full'` with cascade entries (the listings that would have to move). `propose_swap` always emits a clean local 2-change. `propose_drop` always local. `propose_add_constraint` always `mode='full'` (constraints inherently need a re-plan).
- `applyProposal()` mutates `listings` for `mode='local'` proposals (reschedule writes new `suggested_time`, drop sets `status='imported'`). Throws `PROPOSAL_REQUIRES_FULL_REPLAN` for `mode='full'` — the M2 phase-3 work that wires it to a constrained `planSchedule` re-run lives behind this 409.
- `schedulingTools.ts` — the 4 propose tools now delegate to proposalsService instead of returning the placeholder.
- New API: `POST /api/scheduling-proposals/:id/apply` (200 success, 404 not found, 409 already-applied/already-discarded/requires-full-replan).
- Backend tsc clean.

**Frontend — chat panel (M3)**:
- `web/src/api.ts` — types and endpoints for sessions / messages / proposals / apply / discard.
- `web/src/components/SchedulingChat.tsx` (new, ~370 lines) — full chat UI:
  - Message stream auto-scrolls to bottom; user bubbles right-aligned dark, assistant left-aligned bordered, tool messages collapse into small "Butler checked X" pills (we don't dump raw tool JSON at users).
  - Proposal cards rendered inline at the position the tool was called. Color-coded by state: blue (proposed), yellow (full mode / conflict), green (applied), gray (discarded).
  - Apply / Discard buttons fire the corresponding endpoint, optimistic UI flip on click. Apply triggers a parent `onProposalApplied` callback that re-fetches listings so the schedule artifact updates.
  - Optimistic user bubble while waiting for the agent (1–4s LLM round-trip). Roll-back on failure.
  - Empty-state shows two prompt suggestions: "Why isn't Newton Suites scheduled?" / "Move Scotts Square to 11am".
- `App.tsx` integration:
  - New `chatSessionId` state, new `sidePanel` enum value `'chat'`.
  - When a scheduling run completes → auto-call `openSchedulingSession(tourId, runId)` and switch the side panel to `chat`.
  - Toolbar gets a third button alongside Map / Route: "Butler" (lazily opens a session if there isn't one for this tour yet — `getOrOpenSession` is idempotent).
  - `onProposalApplied` re-fetches listings after every successful Apply.
- Frontend tsc clean, vite build green (565KB main bundle, gzip 160KB — same chunk-size warning as before, expected).

**End-to-end flow now works**:
1. User clicks "Start AI scheduling"
2. Progress bar walks through 6 steps (M1)
3. On completion: side panel auto-flips to Butler chat
4. User: "Why isn't X scheduled?" → agent calls get_unscheduled_reason → answers
5. User: "Move Scotts to 11am" → agent calls propose_reschedule → diff card appears in chat
6. User clicks Apply → `listings` mutates → schedule artifact list updates

**Still open** (M2 phase-3 + M4 + M5):
- Real `tryLocalThenFullReplan` for `mode='full'` proposals (currently those Apply with 409).
- Wire scheduling_runs.step_artifacts.travel into get_travel_time (currently Haversine fallback).
- M4: Confirm/Unlock state machine on the schedule + gate route generation on `tours.schedule_locked_at`.
- M5: BUDGET_EXHAUSTED graceful UI surface, copy polish.

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
