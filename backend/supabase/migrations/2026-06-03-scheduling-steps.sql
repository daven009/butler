-- 2026-06-03 — Phase 1: scheduling-run UX with named steps
--
-- Adds per-step state tracking so the frontend can show a real progress bar
-- with named, natural-language steps (instead of the old 0→100 jump), and
-- so failed runs can be retried from the failed step (resumable scheduling).
--
-- Idempotent: safe to run multiple times.

-- 1) New columns on scheduling_runs
alter table public.scheduling_runs
  add column if not exists current_step    text,
  add column if not exists step_state      jsonb not null default '{}'::jsonb,
  add column if not exists step_log        jsonb not null default '[]'::jsonb,
  add column if not exists step_artifacts  jsonb not null default '{}'::jsonb;

-- step_state shape (set by backend, read by frontend):
--   {
--     "gather":   "done"     | "running" | "pending" | "failed",
--     "geocode":  "done"     | ...,
--     "cluster":  ...,
--     "travel":   ...,
--     "optimize": ...,
--     "persist":  ...
--   }
--
-- step_log shape (append-only diagnostic log; not surfaced to UI):
--   [{ "ts": "2026-06-03T...", "step": "geocode", "level": "info"|"warn"|"error", "msg": "..." }, ...]
--
-- step_artifacts shape (intermediate scheduler outputs, used for resume on
-- retry; never sent to the frontend):
--   {
--     "gather":   { "reachable": [...], "buyerSlots": [...], "useOneMap": true },
--     "geocode":  { "geoListings": [...] },
--     "cluster":  { "geoListings": [...] },   -- post-cluster
--     "travel":   { "travelMatrix": {...} },
--     "optimize": { "schedule": [...], "unschedulable": [...] }
--   }

-- 2) Helpful index for picking up "what to retry?"
create index if not exists scheduling_runs_status_idx on public.scheduling_runs(status);
