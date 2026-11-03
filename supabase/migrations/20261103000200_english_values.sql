-- Switch enum-like values in the schema to English. UI text stays Polish;
-- only stored codes change.
--
--   treatments.form       doustnie/zastrzyk/inne          -> oral/injection/other
--   treatments.unit,
--   dose_changes.unit     ml/kropli/tabl./miarka/j.        -> ml/drops/tablet/scoop/unit
--   treatments.split_what tabletka/kapsułka/saszetka/fiolka -> tablet/capsule/sachet/vial
--   entries.kind          objawy/wizyta/notatka/system     -> symptoms/visit/note/system
--
-- v1 still inserts Polish entries.kind values, so a trigger translates them on
-- the way in. Drop entries_kind_from_v1 in the contract migration, once v1 is gone.
-- doses.status ('ok', 'bad', 'skipped') is already English and is read by v1, so it stays.

-- Drops every CHECK constraint on a table whose definition mentions the given text.
create or replace function pg_temp.drop_checks(tbl regclass, needle text) returns void
language plpgsql as $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = tbl and contype = 'c' and pg_get_constraintdef(oid) like '%' || needle || '%'
  loop
    execute format('alter table %s drop constraint %I', tbl, c.conname);
  end loop;
end $$;

-- ---------- treatments.form ----------
select pg_temp.drop_checks('public.treatments', 'doustnie');
update public.treatments set form = case form when 'zastrzyk' then 'injection' when 'inne' then 'other' else 'oral' end;
alter table public.treatments
  alter column form set default 'oral',
  add constraint treatments_form_check check (form in ('oral', 'injection', 'other'));

-- ---------- units ----------
select pg_temp.drop_checks('public.treatments', 'kropli');
select pg_temp.drop_checks('public.dose_changes', 'kropli');
update public.treatments
  set unit = case unit when 'kropli' then 'drops' when 'tabl.' then 'tablet' when 'miarka' then 'scoop' when 'j.' then 'unit' else unit end
  where unit is not null;
update public.dose_changes
  set unit = case unit when 'kropli' then 'drops' when 'tabl.' then 'tablet' when 'miarka' then 'scoop' when 'j.' then 'unit' else unit end;
alter table public.treatments
  add constraint treatments_unit_check check (unit in ('ml', 'drops', 'tablet', 'scoop', 'unit'));
alter table public.dose_changes
  add constraint dose_changes_unit_check check (unit in ('ml', 'drops', 'tablet', 'scoop', 'unit'));

-- ---------- treatments.split_what ----------
select pg_temp.drop_checks('public.treatments', 'tabletka');
update public.treatments
  set split_what = case split_what when 'tabletka' then 'tablet' when 'kapsułka' then 'capsule' when 'saszetka' then 'sachet' when 'fiolka' then 'vial' else split_what end
  where split_what is not null;
alter table public.treatments
  add constraint treatments_split_what_check check (split_what in ('tablet', 'capsule', 'sachet', 'vial'));

-- ---------- entries.kind ----------
select pg_temp.drop_checks('public.entries', 'objawy');

create or replace function public.entries_kind_from_v1() returns trigger
language plpgsql as $$
begin
  new.kind := case new.kind when 'objawy' then 'symptoms' when 'wizyta' then 'visit' when 'notatka' then 'note' else new.kind end;
  return new;
end $$;

create trigger entries_kind_from_v1 before insert or update of kind on public.entries
  for each row execute function public.entries_kind_from_v1();

update public.entries set kind = kind where kind in ('objawy', 'wizyta', 'notatka');

alter table public.entries
  add constraint entries_kind_check check (kind in ('symptoms', 'visit', 'note', 'system'));
