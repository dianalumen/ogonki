-- Lets a member set their own display_name. members had no UPDATE policy,
-- so v2 could not save "Ola" instead of the e-mail address.

create policy members_update_self on public.members for update
  using (is_member() and email = lower(auth.jwt() ->> 'email'))
  with check (email = lower(auth.jwt() ->> 'email'));
