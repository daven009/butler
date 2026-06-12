-- M4 (PRD §8.6): Lock listings whose slot was set by user via chat-with-Butler
-- so subsequent "Re-run AI scheduling" preserves the user's manual decisions.
--
-- A listing is "locked" the moment a propose_* proposal that touches it is
-- Applied. Re-running the scheduler reads `lock_status`; locked listings
-- skip the bidding loop and are inserted into the schedule at their pinned
-- `locked_slot` first, then the remaining listings fight over what's left.
--
-- Statuses (text, not enum so we can extend without migration):
--   null / 'unlocked'   — default; scheduler is free to move it
--   'user_locked'       — pinned via chat apply
--
-- locked_slot stores "HH:MM – HH:MM" (en-dash), exactly the same shape as
-- listings.suggested_time. We keep it in a dedicated column instead of
-- reusing suggested_time so unlocking is cheap (drop the lock columns,
-- suggested_time stays intact and the next re-run rebuilds everything).

alter table public.listings
  add column if not exists lock_status text,
  add column if not exists locked_slot text,
  add column if not exists locked_at   timestamptz;

create index if not exists listings_lock_status_idx
  on public.listings(tour_id, lock_status)
  where lock_status is not null;
