-- User-scoped Butler preferences (PRD §8.6 — voice & rules customization).
--
-- One row per user, holds free-form persona text injected into the
-- scheduling-chat agent's system prompt. The default "butler" voice
-- lives in code; this table only stores user overrides.

create table if not exists public.user_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  butler_persona   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

-- Each user can read/write only their own row.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'owner_select'
  ) then
    create policy owner_select on public.user_preferences
      for select using (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'owner_insert'
  ) then
    create policy owner_insert on public.user_preferences
      for insert with check (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_preferences'
       and policyname = 'owner_update'
  ) then
    create policy owner_update on public.user_preferences
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- updated_at trigger
create or replace function public.touch_user_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_preferences_touch_updated_at on public.user_preferences;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_user_preferences_updated_at();
