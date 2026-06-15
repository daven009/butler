-- ============================================================================
-- Butler — Supabase schema (initial)
-- ============================================================================
-- Run this once in the Supabase SQL Editor (Project → SQL → New query).
-- Idempotent: safe to re-run during development.
--
-- Layout:
--   1. Tables (with user_id FK and timestamps)
--   2. Indexes
--   3. Triggers (updated_at auto-bump)
--   4. Row Level Security policies
--   5. Public data (pg_listings_archive — cross-user cache)
-- ============================================================================

-- 1) ─── Tables ──────────────────────────────────────────────────────────────

create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  client_name     text not null,
  client_whatsapp text,
  brief           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.tours (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.plans(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  target_date  text not null,    -- "Today" / "Fri" / ISO — kept free-form for now
  time_window  text not null,
  command      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.listings (
  id                uuid primary key default gen_random_uuid(),
  tour_id           uuid not null references public.tours(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  pg_listing_id     text,                    -- e.g. "60244724" — null for non-PG sources
  title             text not null,
  address           text not null default '',
  area              text not null default '',
  condo             text not null default '',
  price             text not null default '',
  beds              int  not null default 0,
  baths             int  not null default 0,
  sqft              int  not null default 0,
  psf               text not null default '',
  image_url         text not null default '',
  status            text not null default 'imported',
  status_label      text not null default 'Imported',
  suggested_time    text,
  unit_no           text not null default '',
  co_agent_name     text not null default '',
  co_agent_phone    text not null default '',
  co_agent_agency   text not null default '',
  google_maps_url   text not null default '',
  property_guru_url text not null default '',
  summary           text not null default '',
  attention_reason  text,
  availability      jsonb not null default '[]'::jsonb,    -- SellerTimeWindow[]
  lat               double precision,
  lng               double precision,
  agent_reachable   boolean,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Same PG listing should not be imported into the same tour twice.
  -- (Allows the same PG listing to live in different tours legitimately.)
  unique (tour_id, pg_listing_id)
);

create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  tour_id      uuid not null references public.tours(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- listing_id is the BUSINESS key. For buyer threads we use the sentinel
  -- '__buyer__' (kept as text so we don't have to invent a synthetic listing
  -- row, and to mirror the existing JSON shape).
  listing_key  text not null,
  sender       text not null,           -- ai | agent | co-agent | system
  sender_name  text not null,
  body         text not null,
  ts_label     text not null,           -- display only, e.g. "10:15"
  created_at   timestamptz not null default now()
);

create table if not exists public.routes (
  id         uuid primary key default gen_random_uuid(),
  tour_id    uuid not null references public.tours(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  date       text not null,
  stops      jsonb not null default '[]'::jsonb,    -- RouteStop[]
  created_at timestamptz not null default now()
);

create table if not exists public.scheduling_runs (
  id              uuid primary key default gen_random_uuid(),
  tour_id         uuid not null references public.tours(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'running',     -- running | completed | failed
  progress        int  not null default 0,
  scheduled_count int  not null default 0,
  attention_count int  not null default 0,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  -- Phase 1 (2026-06-03): per-step state for the named-step progress UX.
  -- See migrations/2026-06-03-scheduling-steps.sql for details.
  current_step    text,
  step_state      jsonb not null default '{}'::jsonb,
  step_log        jsonb not null default '[]'::jsonb,
  step_artifacts  jsonb not null default '{}'::jsonb
);

create table if not exists public.attention_items (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  listing_id  uuid references public.listings(id) on delete cascade,
  reason      text not null,
  resolved    boolean not null default false,
  resolution  text,
  created_at  timestamptz not null default now()
);

-- ─── Phase 2B: conversational scheduling refinement ──────────────────────
-- See migrations/2026-06-04-scheduling-sessions.sql for the full migration.

create table if not exists public.scheduling_sessions (
  id            uuid primary key default gen_random_uuid(),
  tour_id       uuid not null references public.tours(id) on delete cascade,
  listing_id    uuid references public.listings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  run_id        uuid references public.scheduling_runs(id) on delete set null,
  status        text not null default 'open',
  finalized_at  timestamptz,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  total_turns       int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.listing_scheduling_briefs (
  id           uuid primary key default gen_random_uuid(),
  tour_id      uuid not null references public.tours(id) on delete cascade,
  listing_id   uuid not null references public.listings(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null references public.scheduling_sessions(id) on delete cascade,
  status       text not null default 'clarifying'
               check (status in ('clarifying', 'ready')),
  priority     text not null default 'normal'
               check (priority in ('low', 'normal', 'high')),
  constraints  jsonb not null default '[]'::jsonb,
  flexibility  jsonb not null default '{}'::jsonb,
  summary      text,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tour_id, listing_id, user_id)
);

create index if not exists scheduling_sessions_listing_idx
  on public.scheduling_sessions(listing_id);
create unique index if not exists scheduling_sessions_open_listing_unique
  on public.scheduling_sessions(tour_id, listing_id, user_id)
  where status = 'open' and listing_id is not null;
create unique index if not exists scheduling_sessions_open_tour_unique
  on public.scheduling_sessions(tour_id, user_id)
  where status = 'open' and listing_id is null;

create or replace function public._bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists scheduling_sessions_updated_at
  on public.scheduling_sessions;
create trigger scheduling_sessions_updated_at
  before update on public.scheduling_sessions
  for each row execute function public._bump_updated_at();

drop trigger if exists listing_scheduling_briefs_updated_at
  on public.listing_scheduling_briefs;
create trigger listing_scheduling_briefs_updated_at
  before update on public.listing_scheduling_briefs
  for each row execute function public._bump_updated_at();

create table if not exists public.scheduling_session_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.scheduling_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('system','user','assistant','tool')),
  content         text,
  tool_calls      jsonb,
  tool_call_id    text,
  tool_name       text,
  tool_result     jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.schedule_change_proposals (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.scheduling_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  message_id      uuid references public.scheduling_session_messages(id) on delete set null,
  intent_summary  text,
  mode            text not null default 'local',
  changes         jsonb not null default '[]'::jsonb,
  cascade         jsonb not null default '[]'::jsonb,
  applied_at      timestamptz,
  discarded_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- Lock state for the schedule (M4, §8.6.5).
alter table public.tours
  add column if not exists schedule_locked_at timestamptz;

-- Public share-link table. The TOKEN itself is the secret. Anyone with the
-- token can read the route. We allow lookup-by-token via a SECURITY DEFINER
-- function (defined further below) so RLS is not in the way.
create table if not exists public.share_tokens (
  token       text primary key,
  route_id    uuid not null references public.routes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days')
);

-- Cross-user PG archive — global cache of raw PG payloads. This is NOT user
-- data, just a technical cache for the LLM extractor / hydrator.
create table if not exists public.pg_listings_archive (
  pg_listing_id text primary key,
  url           text,
  raw_data      jsonb not null,           -- last fully-parsed snapshot
  versions      jsonb not null default '[]'::jsonb,  -- short history of changes
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2) ─── Indexes ─────────────────────────────────────────────────────────────

create index if not exists plans_user_id_idx           on public.plans(user_id);
create index if not exists tours_plan_id_idx           on public.tours(plan_id);
create index if not exists tours_user_id_idx           on public.tours(user_id);
create index if not exists listings_tour_id_idx        on public.listings(tour_id);
create index if not exists listings_user_id_idx        on public.listings(user_id);
create index if not exists conversations_tour_id_idx   on public.conversations(tour_id);
create index if not exists conversations_listing_idx   on public.conversations(tour_id, listing_key);
create index if not exists routes_tour_id_idx          on public.routes(tour_id);
create index if not exists scheduling_runs_tour_idx    on public.scheduling_runs(tour_id);
create index if not exists attention_items_tour_idx    on public.attention_items(tour_id);
create index if not exists share_tokens_route_idx      on public.share_tokens(route_id);

-- 3) ─── Triggers (auto-bump updated_at) ─────────────────────────────────────

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in select unnest(array['plans','tours','listings','pg_listings_archive']) loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; '
      'create trigger set_updated_at before update on public.%I '
      'for each row execute function public.tg_set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- 4) ─── Row Level Security ──────────────────────────────────────────────────
-- Strict per-user isolation. The service_role key bypasses these (used by the
-- backend for admin-y operations like the migration script and the global
-- pg_listings_archive cache). Anything the frontend / extension touches goes
-- through the user's JWT and is filtered by these policies.

alter table public.plans            enable row level security;
alter table public.tours            enable row level security;
alter table public.listings         enable row level security;
alter table public.conversations    enable row level security;
alter table public.routes           enable row level security;
alter table public.scheduling_runs  enable row level security;
alter table public.attention_items  enable row level security;
alter table public.share_tokens     enable row level security;
alter table public.scheduling_sessions enable row level security;
alter table public.scheduling_session_messages enable row level security;
alter table public.schedule_change_proposals enable row level security;
alter table public.listing_scheduling_briefs enable row level security;

-- Helper: drop+recreate the standard "user owns row" policy on a table.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'plans','tours','listings','conversations','routes',
    'scheduling_runs','attention_items','share_tokens',
    'scheduling_sessions','scheduling_session_messages',
    'schedule_change_proposals','listing_scheduling_briefs'
  ]) loop
    execute format('drop policy if exists owner_select on public.%I;', t);
    execute format('drop policy if exists owner_insert on public.%I;', t);
    execute format('drop policy if exists owner_update on public.%I;', t);
    execute format('drop policy if exists owner_delete on public.%I;', t);

    execute format(
      'create policy owner_select on public.%I for select using (auth.uid() = user_id);', t);
    execute format(
      'create policy owner_insert on public.%I for insert with check (auth.uid() = user_id);', t);
    execute format(
      'create policy owner_update on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
    execute format(
      'create policy owner_delete on public.%I for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- pg_listings_archive: NOT enabling RLS — backend-only via service_role.
-- (We don't expose this table to the frontend at all.)
-- Defensive: revoke direct access for anon / authenticated. service_role
-- bypasses these grants automatically.
revoke all on public.pg_listings_archive from anon, authenticated;

-- 5) ─── Public share endpoint ───────────────────────────────────────────────
-- Customers who hold a share token can fetch the route's client-safe view
-- without an account. Implemented as a SECURITY DEFINER RPC so RLS doesn't
-- get in the way.

create or replace function public.get_route_by_share_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route   public.routes%rowtype;
  v_token   public.share_tokens%rowtype;
begin
  select * into v_token from public.share_tokens
   where token = p_token and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  select * into v_route from public.routes where id = v_token.route_id;
  if not found then return null; end if;

  -- Strip co_agent / unit / notes from each stop (privacy for client view).
  -- Frontend sees jsonb; the backend RPC caller can shape it further.
  return jsonb_build_object(
    'shareToken', v_token.token,
    'title',      v_route.title,
    'date',       v_route.date,
    'stops',      coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id',             s->>'id',
        'time',           s->>'time',
        'title',          s->>'title',
        'address',        s->>'address',
        'area',           s->>'area',
        'condo',          s->>'condo',
        'googleMapsUrl',  s->>'googleMapsUrl'
      )) from jsonb_array_elements(v_route.stops) as s),
      '[]'::jsonb
    ),
    'privacyNotice',
      'This customer view hides co-agent names, phone numbers, unit numbers, WhatsApp conversations, negotiation details and internal notes.'
  );
end $$;

grant execute on function public.get_route_by_share_token(text) to anon, authenticated;

-- ============================================================================
-- Done.
-- After running this, verify with:
--   select tablename, rowsecurity from pg_tables where schemaname='public';
--   -- everything except pg_listings_archive should show rowsecurity = true
-- ============================================================================
