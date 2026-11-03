-- Ogonki: database schema as of 2026-11-03 (v1).
--
-- Reconstructed from a query over information_schema / pg_constraint / pg_policies,
-- not from pg_dump. This migration is ALREADY in the production database: do not run
-- it there, mark it as applied (`supabase migration repair --status applied 20261103000000`).
--
-- Not covered by that query, so reconstructed from the v1 code:
--   * the body of is_member(),
--   * the element type of treatments.times (v1 writes and shows 'HH:MM', so text[]),
--   * RLS being enabled and the tables in the supabase_realtime publication.
-- Replace this file with a full pg_dump once one is available.

create table public.members (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email'));
$$;

create table public.rats (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  born       date,
  look       text not null default '',
  coat       text not null default '#E9D2A8',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.weights (
  id     uuid primary key default gen_random_uuid(),
  rat_id uuid not null references public.rats(id) on delete cascade,
  date   date not null,
  time   time,
  grams  integer not null check (grams between 10 and 2000)
);

create table public.entries (
  id         uuid primary key default gen_random_uuid(),
  rat_id     uuid not null references public.rats(id) on delete cascade,
  date       date not null default current_date,
  kind       text not null check (kind in ('objawy', 'wizyta', 'notatka', 'system')),
  text       text not null check (char_length(text) between 1 and 2000),
  created_by text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table public.treatments (
  id           uuid primary key default gen_random_uuid(),
  rat_id       uuid not null references public.rats(id) on delete cascade,
  med          text not null check (char_length(med) between 1 and 80),
  dose         text not null check (char_length(dose) between 1 and 80),
  times        text[] not null check (array_length(times, 1) >= 1 and array_length(times, 1) <= 4),
  start_date   date not null,
  days         integer not null check (days between 1 and 365),
  remind_weigh boolean not null default false,
  ended_at     date,
  created_at   timestamptz not null default now()
);

create table public.doses (
  id           uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.treatments(id) on delete cascade,
  date         date not null,
  slot         smallint not null check (slot between 0 and 3),
  status       text not null check (status in ('ok', 'bad')),
  note         text not null default '',
  given_at     timestamptz not null default now(),
  given_by     text default lower(auth.jwt() ->> 'email'),
  unique (treatment_id, date, slot)
);

create table public.visits (
  id     uuid primary key default gen_random_uuid(),
  rat_id uuid not null references public.rats(id) on delete cascade,
  date   date not null,
  time   time,
  text   text not null default 'Wizyta'
);

alter table public.members    enable row level security;
alter table public.rats       enable row level security;
alter table public.weights    enable row level security;
alter table public.entries    enable row level security;
alter table public.treatments enable row level security;
alter table public.doses      enable row level security;
alter table public.visits     enable row level security;

create policy members_add    on public.members for insert with check (is_member());
create policy members_read   on public.members for select using (is_member());
create policy members_remove on public.members for delete using (is_member() and email <> lower(auth.jwt() ->> 'email'));

create policy members_all on public.rats       for all using (is_member()) with check (is_member());
create policy members_all on public.weights    for all using (is_member()) with check (is_member());
create policy members_all on public.entries    for all using (is_member()) with check (is_member());
create policy members_all on public.treatments for all using (is_member()) with check (is_member());
create policy members_all on public.doses      for all using (is_member()) with check (is_member());
create policy members_all on public.visits     for all using (is_member()) with check (is_member());

alter publication supabase_realtime add table
  public.members, public.rats, public.weights, public.entries, public.treatments, public.doses, public.visits;
