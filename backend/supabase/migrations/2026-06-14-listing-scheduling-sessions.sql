-- Listing-scoped Butler sessions and structured scheduling briefs.
-- This migration is intentionally not executed by the application.

alter table public.scheduling_sessions
  add column if not exists listing_id uuid references public.listings(id) on delete cascade;

create index if not exists scheduling_sessions_listing_idx
  on public.scheduling_sessions(listing_id);

create unique index if not exists scheduling_sessions_open_listing_unique
  on public.scheduling_sessions(tour_id, listing_id, user_id)
  where status = 'open' and listing_id is not null;

create unique index if not exists scheduling_sessions_open_tour_unique
  on public.scheduling_sessions(tour_id, user_id)
  where status = 'open' and listing_id is null;

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

alter table public.listing_scheduling_briefs enable row level security;

drop policy if exists owner_select on public.listing_scheduling_briefs;
drop policy if exists owner_insert on public.listing_scheduling_briefs;
drop policy if exists owner_update on public.listing_scheduling_briefs;
drop policy if exists owner_delete on public.listing_scheduling_briefs;

create policy owner_select on public.listing_scheduling_briefs
  for select using (user_id = auth.uid());
create policy owner_insert on public.listing_scheduling_briefs
  for insert with check (user_id = auth.uid());
create policy owner_update on public.listing_scheduling_briefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_delete on public.listing_scheduling_briefs
  for delete using (user_id = auth.uid());

drop trigger if exists listing_scheduling_briefs_updated_at
  on public.listing_scheduling_briefs;
create trigger listing_scheduling_briefs_updated_at
  before update on public.listing_scheduling_briefs
  for each row execute function public._bump_updated_at();
