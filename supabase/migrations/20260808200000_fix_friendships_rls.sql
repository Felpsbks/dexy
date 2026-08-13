-- SECURITY FIX: the original friendship policies let a user forge a mutual
-- "accepted" friendship with anyone, with no consent from the other party:
--   1. INSERT never restricted `status`, so a user could insert a row as
--      themselves with status = 'accepted' directly.
--   2. UPDATE had no WITH CHECK, so a user could retarget the identity of a
--      row they were party to (change user_id/friend_id to an unrelated
--      victim) while setting status = 'accepted' in the same statement.
-- This mattered a lot more once get_or_create_dm() and dm_calls started
-- trusting an 'accepted' friendships row as their sole consent gate.

-- Lock the (user_id, friend_id) identity of a row for its lifetime; only the
-- status may change after creation.
create function public.prevent_friendship_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id <> old.user_id or new.friend_id <> old.friend_id then
    raise exception 'friendships.user_id and friendships.friend_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger friendships_prevent_identity_change
  before update on public.friendships
  for each row execute procedure public.prevent_friendship_identity_change();

drop policy "users can send friend requests" on public.friendships;

create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

drop policy "participants can update friendship status" on public.friendships;

create policy "participants can update friendship status"
  on public.friendships for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id)
  with check (
    (auth.uid() = user_id or auth.uid() = friend_id)
    and (status <> 'accepted' or auth.uid() = friend_id)
  );
