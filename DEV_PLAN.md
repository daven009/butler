# Dev Plan — Live tracker for in-flight work

> Per-task status. When a milestone ships, the canonical record moves to
> `change_log.md` and this file is trimmed back to "what's next".
>
> See `BUTLER.md` for the product spec, `technical_solution.md` for the
> architecture, and `change_log.md` for what shipped when.
>
> **New agent picking up**: read `HANDOFF.md` first — this file assumes
> familiarity with the project state.

---

## Currently in-flight (2026-06-13)

**Merge of remote UI rewrite is done in working tree but NOT committed.**

**2026-06-14 architecture update**: listing-specific Butler sessions and
`listing_scheduling_briefs` are implemented and the migration has been applied.
There is no separate Tour-level scheduling interaction: the first ready brief
creates the initial proposal, and each later brief jointly replans all ready,
unconfirmed listings while preserving confirmed slots.

| Item | Status | Notes |
|---|---|---|
| Adopt remote frontend (`c453c47` + `839a623`) | ✅ done | 13 web/src files + new `i18n.ts` + new `AGENTS.md` |
| Wire backend Plan/Tour CRUD (`PATCH/DELETE plans`, `DELETE tours`) | ✅ done | routes + repo functions |
| Remove M4 lock fields + persona injection from backend | ✅ done | code; DB drift still pending |
| Import → focus listing → real AI chat | ✅ done | import still seeds mock conversation; Butler session opens against imported listing |
| Ready-brief aggregate Tour proposal | ✅ done | every brief submission replans all ready unconfirmed listings; confirmed slots stay fixed |
| Remove Tour-level scheduling entry | ✅ done | no global button/session; scheduling sessions require listingId |
| Backend `tsc --noEmit` clean | ✅ | exit 0 |
| Web production build clean | ✅ | exit 0; existing chunk-size warning only |
| **Commit + push** | ⏳ pending | 22 file changes staged, no commit yet |
| End-to-end smoke test against new CRUD UI | ⏳ pending | login → create plan → edit plan → import → seed → schedule → chat → propose → apply |
| Drop `listings.lock_status/locked_slot/locked_at` + `user_preferences` table from prod | ⏳ pending | needs data audit first |

**Open bug-ish observation from user (2026-06-13 17:23)**:
- After manual DB state update (6 imported / 6 contacting / 4 needs-attention on the western_tour), UI ended up showing everything as "needs-attention". Cause unconfirmed — likely the listing list re-renders against fresh DB read where a scheduling pipeline or seed run flipped statuses back. Needs investigation.
- User feedback: mock conversation generator produces too many "not available" / "no reply" scenarios. The 7-scenario distribution in `conversationsMock.ts:SCENARIOS` should be re-balanced toward more happy path (currently 3 happy / 2 partial / 1 unreachable / 1 rejected — feels heavier on negative paths in practice because `pickScenario(idx)` rotates strictly, so a tour of 16 listings cycles unevenly).

---

## Active milestone — §8.6 Scheduling Run UX & Conversational Refinement

PRD: BUTLER.md §8.6 (locked 2026-06-03)

### M1 — Named-step progress bar + resumable runs ✅ Shipped
Canonical entry in `change_log.md`. Note: after the 2026-06-13 frontend merge, the `SchedulingProgress` component is no longer rendered by the new App.tsx (replaced by inline listing bullets). The backend `step_state` + retry mechanism is still in place and could be re-surfaced if needed.

### M2 phase-1 — Read tools ✅ Shipped
### M2 phase-2 — propose_* write tools + Apply/Discard ✅ Shipped

### M2 phase-3 — Real two-stage replan 🚧 Partial

| Item | Status | Notes |
|---|---|---|
| Ready-listing aggregate `planSchedule` replan | ✅ | all ready unconfirmed listings are optimized together around fixed confirmed slots |
| Apply complete `mode='full'` proposals | ✅ | stale-source validation + best-effort rollback |
| Surface cascade preview before Apply | ✅ | ProposalCard shows listing labels + requested/cascade diff |
| Exact-time reschedule with multiple conflicts | ⏳ | still creates manual-review proposal with unknown destinations; Apply disabled |
| Change tour date through chat | ⏳ | requires recollecting seller availability for the new date |

### M3 — chat-with-Butler frontend ✅ Shipped
After extension import, the AI Assistant workspace opens the tour session beside the selected listing's mock co-agent conversation. The older side-panel chat path remains available for existing scheduling completion flows.

### M4 — Schedule lock state machine 🗑️ Retracted (2026-06-13)

Originally planned as: "Confirm schedule" button + Unlock flow, gate route generation on `tours.schedule_locked_at`, per-listing `lock_status` so re-runs preserve user-pinned slots.

**Why retracted**: the remote UI rewrite removed all lock-related concepts. There's no "Confirm" button, no lock icon, no unlock affordance, and the new product direction emphasizes "AI proposes, user accepts each individual change via chat" rather than a separate confirm-then-lock step. Backend code, DB migrations, and the `user_preferences` persona feature (which was scoped together with M4) were all removed.

If you want lock semantics back later: full implementation lived on branch `backup-before-merge` and is reachable via `git show 6cf80f2`. **Do not** revive without designing the UI affordance first.

### M5 — Polish + edge cases (not started)

- Failure injection
- Concurrent edits (two browser tabs / agent + user racing)
- Token usage hard cap — UX side: surface BUDGET_EXHAUSTED gracefully (backend already emits synthetic message, frontend doesn't yet block input)
- Copy review pass (especially for the new zh strings — `i18n.ts` is currently minimal)

---

## Backlog (post-§8.6)

- §5 increment-search 增值搜房（名校圈、通勤时间、AI 语义筛选）
- §6 buyer no-login share UI
- §11 LLM-based unstructured WhatsApp reply parsing
- §12 undo / rollback model (per-edit history)
- WhatsApp Cloud API integration (replaces mock conversations)
- v1.0.5 extension upload to Chrome Web Store
- DB cleanup migration: drop `listings.lock_status / locked_slot / locked_at` columns + `user_preferences` table (see in-flight section above)
- Rebalance `conversationsMock.ts:SCENARIOS` distribution (see in-flight section above)
