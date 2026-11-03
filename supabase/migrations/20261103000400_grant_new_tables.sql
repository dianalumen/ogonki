-- The tables added in v2_expand were not granted to the API role, so signed-in
-- users got "permission denied for table cage_done". RLS (members only) still applies.

grant select, insert, update, delete
  on public.dose_changes, public.dose_shifts, public.cage_tasks, public.cage_done
  to authenticated;
