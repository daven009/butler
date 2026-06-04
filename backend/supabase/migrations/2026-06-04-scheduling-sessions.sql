-- 2026-06-04 — Phase 2B: conversational scheduling refinement
--
-- Adds three tables that back the post-run "chat with Butler to refine the
-- schedule" UX (PRD §8.6.3):
--
--   scheduling_sessions          one chat session, opened after a run completes
--   scheduling_session_messages  the message stream (user / assistant / tool)
--   schedule_change_proposals    proposed mutations the user can Apply / Discard
--
-- Plus one column on `tours` for the §8.6.5 lock state machine (used in M4
-- but cheap to ship now alongside the rest).
--
-- Idempotent: safe to run multiple times.

-- 1) Sessions ─────────────────────────────────────────────────────────────
create table if not exists public.scheduling_sessions (
  id            uuid primary key default gen_random_uuid(),
  tour_id       uuid not null references public.tours(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  run_id        uuid references public.scheduling_runs(id) on delete set null,
  status        text not null default 'open',          -- open | finalized | archived
  finalized_at  timestamptz,
  -- Track LLM token usage so we can enforce the §8.6.4 per-session budget
  -- (100K input tokens, ~$0.015 cap on gpt-4o-mini). Updated on every
  -- assistant turn.
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  total_turns       int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists scheduling_sessions_tour_idx on public.scheduling_sessions(tour_id);
create index if not exists scheduling_sessions_user_idx on public.scheduling_sessions(user_id);
create index if not exists scheduling_sessions_status_idx on public.scheduling_sessions(status);

-- 2) Messages ─────────────────────────────────────────────────────────────
-- Each row is one element of the OpenAI chat completion message array.
-- Roles:
--   user        — the agent typing
--   assistant   — Butler's natural-language reply
--   tool        — a tool's response (paired with assistant's tool_call entry)
--   system      — only on session bootstrap (PRD §8.6.3 system prompt)
--
-- For an assistant message that triggered a tool call, we serialize the
-- tool_calls array into `tool_calls` and leave content empty; we then expect
-- one or more `role='tool'` rows linked by tool_call_id.
create table if not exists public.scheduling_session_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.scheduling_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('system','user','assistant','tool')),
  content         text,                       -- assistant/user/system natural-language text
  tool_calls      jsonb,                      -- assistant turn that issued tools: [{id,type,function:{name,arguments}}]
  tool_call_id    text,                       -- only for role='tool': matches assistant's tool_calls[i].id
  tool_name       text,                       -- only for role='tool': denormalized for easier query
  tool_result     jsonb,                      -- only for role='tool': structured result that came back
  created_at      timestamptz not null default now()
);

create index if not exists ssm_session_idx on public.scheduling_session_messages(session_id, created_at);

-- 3) Schedule change proposals ────────────────────────────────────────────
-- Every write-tool the agent calls produces a row here. Nothing is applied
-- to listings until the user clicks "Apply" in the UI; that flips
-- applied_at and triggers the actual mutation. "Discard" flips discarded_at
-- without mutating anything. This gives us a free undo log + lets the chat
-- show the diff before commit.
--
-- `changes` shape (one entry per affected listing):
--   [
--     { "listingId": "...", "action": "reschedule", "from": "14:00 – 14:30", "to": "11:00 – 11:30" },
--     { "listingId": "...", "action": "drop",       "from": "16:00 – 16:30", "to": null },
--     { "listingId": "...", "action": "add",        "from": null,             "to": "10:00 – 10:30" }
--   ]
-- `cascade` is the list of changes that the user did NOT explicitly request
-- but that were needed to fit their requested change in (two-stage replan,
-- §8.6.3). UI surfaces these so the user knows what else moved.
create table if not exists public.schedule_change_proposals (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.scheduling_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  message_id      uuid references public.scheduling_session_messages(id) on delete set null,
  /** Why the user wanted this — captured from the assistant's reasoning */
  intent_summary  text,
  /** "local" if a single-listing move sufficed; "full" if planSchedule re-ran. */
  mode            text not null default 'local',
  changes         jsonb not null default '[]'::jsonb,
  cascade         jsonb not null default '[]'::jsonb,
  applied_at      timestamptz,
  discarded_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists scp_session_idx on public.schedule_change_proposals(session_id, created_at);

-- 4) Tour lock state (M4 prep, see §8.6.5) ────────────────────────────────
alter table public.tours
  add column if not exists schedule_locked_at timestamptz;

-- 5) RLS policies ─────────────────────────────────────────────────────────
alter table public.scheduling_sessions          enable row level security;
alter table public.scheduling_session_messages  enable row level security;
alter table public.schedule_change_proposals    enable row level security;

-- Idempotent policy install (matches the pattern used by the original schema.sql)
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'scheduling_sessions','scheduling_session_messages','schedule_change_proposals'
  ]) loop
    execute format('drop policy if exists owner_select on public.%I;', t);
    execute format('drop policy if exists owner_insert on public.%I;', t);
    execute format('drop policy if exists owner_update on public.%I;', t);
    execute format('drop policy if exists owner_delete on public.%I;', t);

    execute format(
      'create policy owner_select on public.%I for select using (user_id = auth.uid());', t
    );
    execute format(
      'create policy owner_insert on public.%I for insert with check (user_id = auth.uid());', t
    );
    execute format(
      'create policy owner_update on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid());', t
    );
    execute format(
      'create policy owner_delete on public.%I for delete using (user_id = auth.uid());', t
    );
  end loop;
end$$;

-- 6) Auto-bump updated_at on scheduling_sessions ──────────────────────────
create or replace function public._bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists scheduling_sessions_updated_at on public.scheduling_sessions;
create trigger scheduling_sessions_updated_at
  before update on public.scheduling_sessions
  for each row execute function public._bump_updated_at();
