-- Ogonki v2, "expand" step: additions only. The v1 app must keep working unchanged
-- after this migration, since phones may run the old cached app.js for a while.
--
-- Contract for the transition period (v2 must honour it while v1 is still in use):
--   * v2 keeps filling treatments.dose (text) and treatments.days. A "forever"
--     treatment stores days = 365; "every N days" and "N doses" store the number of
--     days from the first to the last dose.
--   * doses.status: 'ok' = given, 'bad' = partial / problem (v1 shows it as
--     "Problem"), 'skipped' = skipped (new; v1 shows it as not given).
--   * treatments.times = '{}' for the 'anytime' and 'every' schedules.
-- Dropping dose/days and tightening constraints is a separate "contract" migration.
--
-- Note: the Polish codes added here (form, unit, split_what) are switched to English
-- by 20261103000200_english_values.sql. This file is kept as it was applied.

-- ---------- members: display name ("Ola" instead of the e-mail) ----------
alter table public.members
  add column display_name text check (char_length(display_name) between 1 and 30);

-- ---------- weights: who weighed ----------
alter table public.weights
  add column weighed_by text default lower(auth.jwt() ->> 'email');

-- ---------- treatments: numeric dose, schedule, duration, portions ----------
alter table public.treatments
  add column form        text not null default 'doustnie' check (form in ('doustnie', 'zastrzyk', 'inne')),
  add column dose_min    numeric(8, 3) check (dose_min > 0),
  add column dose_max    numeric(8, 3),
  add column unit        text check (unit in ('ml', 'kropli', 'tabl.', 'miarka', 'j.')),
  add column sched       text not null default 'times' check (sched in ('times', 'anytime', 'every')),
  add column every_n     smallint check (every_n between 2 and 90),
  add column every_time  time,
  add column late_min    smallint not null default 30 check (late_min between 0 and 240),
  add column end_type    text not null default 'days' check (end_type in ('days', 'doses', 'forever')),
  add column end_n       integer check (end_n between 1 and 365),
  add column note        text not null default '' check (char_length(note) <= 500),
  add column split_what  text check (split_what in ('tabletka', 'kapsułka', 'saszetka', 'fiolka')),
  add column split_parts smallint check (split_parts between 2 and 50),
  add column split_warn  smallint not null default 2 check (split_warn between 0 and 10),
  add column split_left  smallint check (split_left >= 0);

-- Dose history: which dose applied from which date (a dose change does not rewrite the past).
create table public.dose_changes (
  id           uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.treatments(id) on delete cascade,
  from_date    date not null,
  dose_min     numeric(8, 3) not null check (dose_min > 0),
  dose_max     numeric(8, 3) check (dose_max > dose_min),
  unit         text not null check (unit in ('ml', 'kropli', 'tabl.', 'miarka', 'j.')),
  created_by   text default lower(auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now(),
  unique (treatment_id, from_date)
);

-- ---------- doses: skipped, amount given for a range, portion used ----------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.doses'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.doses drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.doses
  add constraint doses_status_check check (status in ('ok', 'bad', 'skipped')),
  add column amount  numeric(8, 3) check (amount > 0),
  add column portion boolean not null default false;

-- Moves a single dose ("today only"). A permanent change is an update of treatments.times.
create table public.dose_shifts (
  treatment_id uuid not null references public.treatments(id) on delete cascade,
  date         date not null,
  slot         smallint not null check (slot between 0 and 3),
  time         time not null,
  primary key (treatment_id, date, slot)
);

-- ---------- cage ----------
create table public.cage_tasks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  min_days   smallint not null check (min_days between 1 and 90),
  max_days   smallint not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  check (max_days >= min_days and max_days <= 90)
);

create table public.cage_done (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.cage_tasks(id) on delete cascade,
  date       date not null default current_date,
  done_by    text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index cage_done_task_date on public.cage_done (task_id, date desc);

insert into public.cage_tasks (name, min_days, max_days)
select v.name, v.min_days, v.max_days
from (values ('Sprzątanie częściowe i woda', 2, 3), ('Pełne sprzątanie klatki', 28, 31)) as v(name, min_days, max_days)
where not exists (select 1 from public.cage_tasks);

-- ---------- backfill existing treatments ----------
update public.treatments set end_n = days where end_n is null;

-- Parse the dose text only where it is unambiguous:
-- "0,15 ml", "0.1", "0,10–0,15 ml", "1 miarka", "2 krople". Everything else keeps
-- only the text (dose_min = null), to be fixed by hand in v2.
with parsed as (
  select id, regexp_match(
    lower(btrim(dose)),
    '^(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(ml|krop\S*|tabl\S*|miar\S*|j\.?)?$'
  ) as m
  from public.treatments
), vals as (
  select id,
    replace(m[1], ',', '.')::numeric as lo,
    replace(m[2], ',', '.')::numeric as hi,
    case
      when m[3] is null then null
      when m[3] = 'ml' then 'ml'
      when m[3] like 'krop%' then 'kropli'
      when m[3] like 'tabl%' then 'tabl.'
      when m[3] like 'miar%' then 'miarka'
      else 'j.'
    end as unit
  from parsed where m is not null
)
update public.treatments t
set dose_min = v.lo, dose_max = v.hi, unit = v.unit
from vals v
where v.id = t.id and v.lo > 0 and v.lo < 100000 and (v.hi is null or (v.hi > v.lo and v.hi < 100000));

insert into public.dose_changes (treatment_id, from_date, dose_min, dose_max, unit, created_by)
select id, start_date, dose_min, dose_max, unit, null
from public.treatments
where dose_min is not null and unit is not null
on conflict (treatment_id, from_date) do nothing;

-- v1 does not know end_n when it adds a treatment, so fill it from days.
create or replace function public.treatments_fill_end_n() returns trigger
language plpgsql as $$
begin
  if new.end_n is null and new.end_type <> 'forever' then new.end_n := new.days; end if;
  return new;
end $$;

create trigger treatments_fill_end_n before insert or update on public.treatments
  for each row execute function public.treatments_fill_end_n();

alter table public.treatments
  add constraint treatments_dose_range check (dose_max is null or (dose_min is not null and dose_max > dose_min)),
  add constraint treatments_every      check (sched <> 'every' or every_n is not null),
  add constraint treatments_end        check (end_type = 'forever' or end_n is not null),
  add constraint treatments_split      check (
    (split_what is null) = (split_parts is null)
    and (split_left is null or (split_parts is not null and split_left <= split_parts))
  );

-- ---------- access and realtime for the new tables ----------
alter table public.dose_changes enable row level security;
alter table public.dose_shifts  enable row level security;
alter table public.cage_tasks   enable row level security;
alter table public.cage_done    enable row level security;

create policy members_all on public.dose_changes for all using (is_member()) with check (is_member());
create policy members_all on public.dose_shifts  for all using (is_member()) with check (is_member());
create policy members_all on public.cage_tasks   for all using (is_member()) with check (is_member());
create policy members_all on public.cage_done    for all using (is_member()) with check (is_member());

alter publication supabase_realtime add table
  public.dose_changes, public.dose_shifts, public.cage_tasks, public.cage_done;
