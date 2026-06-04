# Dev Plan — Live tracker for in-flight work

> Per-task status. When a milestone ships, the canonical record moves to
> `change_log.md` and this file is trimmed back to "what's next".
>
> See `BUTLER.md` for the product spec, `technical_solution.md` for the
> architecture, and `change_log.md` for what shipped when.

---

## Active milestone — §8.6 Scheduling Run UX & Conversational Refinement

PRD: BUTLER.md §8.6 (locked 2026-06-03)

### M1 — Phase 1: Named-step progress bar + resumable runs ✅ Code complete

| Item | Status | Notes |
|---|---|---|
| DB migration `2026-06-03-scheduling-steps.sql` | ✅ written | adds `current_step`, `step_state`, `step_log`, `step_artifacts` to `scheduling_runs` |
| **DB migration applied to prod** | ⏳ **pending — user must run in Supabase Dashboard** | see "Next steps" below |
| `backend/src/lib/scheduling/schedulerSteps.ts` (framework) | ✅ | STEP_DEFS, blankStepState, progressFromState, mark* helpers |
| `runScheduler` refactor → 6 named step bodies | ✅ | gather / geocode / cluster / travel / optimize / persist |
| `retrySchedulingRun(runId)` | ✅ | preserves step_state + step_artifacts so completed steps don't re-run |
| `POST /api/scheduling-runs/:runId/retry` | ✅ | 404 for missing, 409 for non-failed |
| `GET /api/scheduling-steps` | ✅ | static catalogue used by frontend progress UI labels |
| `web/src/components/SchedulingProgress.tsx` | ✅ | collapsed bar + expandable step list, retry button on failed |
| `App.tsx` integration | ✅ | poll → schedulingRun state → progress component, retry handler wired |
| Backend tsc clean | ✅ | `npx tsc --noEmit` exits 0 |
| Frontend tsc + vite build clean | ✅ | `npx tsc --noEmit` and `npm run build` both green |
| Deploy to prod | ⏳ pending | runs after migration applies cleanly |

**Phase 1 next steps for user**:

1. **Apply migration on Supabase**:
   - Open Supabase Dashboard → your project → SQL Editor → New query
   - Paste contents of `backend/supabase/migrations/2026-06-03-scheduling-steps.sql`
   - Click Run. It's idempotent — re-running is a no-op.
2. **Deploy** (or let me do it): `bash deploy/deploy-source-build.sh`
3. **Sanity check**: open https://app.hey-alfred.vip, run scheduling on a tour, watch the progress bar walk through the 6 steps.

### M2 — Phase 2B backend skeleton 🟡 In progress (read-tool layer shipped)

| Item | Status | Notes |
|---|---|---|
| DB migration `2026-06-04-scheduling-sessions.sql` (sessions / messages / proposals / tours.schedule_locked_at + RLS) | ✅ written | **Pending: user must apply in Supabase Dashboard** |
| `openaiClient.ts` — gpt-4o-mini wrapper + budget caps | ✅ | reads `OPENAI_API_KEY` env, throws fast if missing |
| `schedulingToolDefs.ts` — 8-tool registry + `buildSystemPrompt` | ✅ | Schemas locked; mid-scope per PRD |
| `schedulingSessionsRepository.ts` — sessions / messages / proposals CRUD | ✅ | RLS-aware via supabaseForUser |
| `schedulingTools.ts` — read tools (`get_schedule`, `get_listing_detail`, `get_unscheduled_reason`, `get_travel_time`) | ✅ | All 4 read tools live |
| `schedulingTools.ts` — propose_* tools (reschedule/swap/drop/add_constraint) | 🟡 placeholder | Returns `PROPOSE_TOOLS_NOT_YET_IMPLEMENTED`; agent prompt told to describe-only. Two-stage replan algorithm coming in M2 phase-2 |
| `schedulingAgent.ts` — runAgentTurn loop with tool-round cap, budget guard | ✅ | OpenAI tool_call narrowing handled |
| API: `POST /tours/:tourId/scheduling-sessions` | ✅ | get-or-open semantics |
| API: `GET /scheduling-sessions/:id/messages` | ✅ | full history |
| API: `POST /scheduling-sessions/:id/messages` | ✅ | runs one full agent turn synchronously, returns assistant + history |
| API: `GET /scheduling-sessions/:id/proposals` | ✅ | |
| API: `POST /scheduling-proposals/:id/discard` | ✅ | |
| API: `POST /scheduling-proposals/:id/apply` | ⏳ pending | gated on real propose_* impls |
| Backend `tsc --noEmit` | ✅ exit 0 | |
| Two-stage replan algorithm (`tryLocalThenFullReplan`) | ⏳ next | M2 phase-2 |

**M2 phase-2 next steps**:
1. Implement real `propose_reschedule` / `propose_swap` / `propose_drop` / `propose_add_constraint` (creates real `schedule_change_proposals` rows with `mode='local'|'full'` + cascade detection).
2. Implement `apply` endpoint + service (mutates `listings` based on proposal, marks `applied_at`).
3. Wire scheduling_runs.step_artifacts.travel into get_travel_time so estimates are real OneMap times not Haversine fallback.

### M3 — Phase 2B frontend chat UI (not started)

- `SchedulingChatView` with two-pane layout
- `ToolCallCard` with Apply/Discard
- `ScheduleArtifactPane`

### M4 — Schedule state machine (not started)

- `tours.schedule_locked_at` column
- "Confirm schedule" button + Unlock flow
- Gate route generation + share on locked state

### M5 — Polish + edge cases (not started)

- Failure injection
- Concurrent edits
- Token usage hard cap
- Copy review pass

---

## Backlog (post-§8.6)

- §5 increment-search 增值搜房（名校圈、通勤时间、AI 语义筛选）
- §6 buyer no-login share UI
- §11 LLM-based unstructured WhatsApp reply parsing
- §12 undo / rollback model (per-edit history)
- WhatsApp Cloud API integration (replaces mock conversations)
- v1.0.5 extension upload to Web Store
