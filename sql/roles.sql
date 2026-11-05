-- ---------- 1. Roles: customer, staff, admin ----------
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'staff', 'admin'));

-- Staff or admin
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role in ('staff', 'admin')
  );
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ---------- 2. Staff (and admin) can read bookings, payments, ratings ----------
drop policy if exists "bookings admin select" on public.bookings;
drop policy if exists "bookings staff select" on public.bookings;
create policy "bookings staff select" on public.bookings
  for select to authenticated using (public.is_staff());

drop policy if exists "payments admin select" on public.payments;
drop policy if exists "payments staff select" on public.payments;
create policy "payments staff select" on public.payments
  for select to authenticated using (public.is_staff());

drop policy if exists "ratings admin select" on public.ratings;
drop policy if exists "ratings staff select" on public.ratings;
create policy "ratings staff select" on public.ratings
  for select to authenticated using (public.is_staff());

drop policy if exists "booking_addons read own" on public.booking_addons;
create policy "booking_addons read own" on public.booking_addons
  for select to authenticated using (
    public.is_staff() or exists (
      select 1 from public.bookings b
       where b.id = booking_addons.booking_id and b.user_id = auth.uid())
  );

-- ---------- 3. Staff can accept / finish / cancel bookings and assign cleaners ----------
create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if not public.is_staff() then
    raise exception 'Staff only.';
  end if;
  if p_status not in ('accepted', 'completed', 'cancelled') then
    raise exception 'Invalid status.';
  end if;

  select bk.id, bk.user_id, bk.status into b
    from public.bookings bk where bk.id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;
  if b.status = 'cancelled' then
    raise exception 'A cancelled booking cannot be changed.';
  end if;
  if b.status = 'completed' then
    raise exception 'A completed booking cannot be changed.';
  end if;
  if p_status = 'completed' and b.status <> 'accepted' then
    raise exception 'Accept the booking before marking it done.';
  end if;

  update public.bookings
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = p_booking_id;

  if p_status = 'completed' then
    update public.payments set status = 'paid'
     where booking_id = p_booking_id and status = 'cash_due';
  end if;

  insert into public.notifications (user_id, message)
  values (b.user_id, 'Your booking was marked as ' || p_status || '.');
end; $$;

create or replace function public.admin_assign_cleaner(p_booking_id uuid, p_cleaner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_name text;
begin
  if not public.is_staff() then
    raise exception 'Staff only.';
  end if;

  select bk.id, bk.user_id, bk.status into b
    from public.bookings bk where bk.id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;
  if b.status in ('cancelled', 'completed') then
    raise exception 'This booking can no longer be changed.';
  end if;

  if p_cleaner_id is not null then
    select c.name into v_name from public.cleaners c where c.id = p_cleaner_id and c.active;
    if not found then
      raise exception 'Cleaner not found or not active.';
    end if;
  end if;

  update public.bookings set cleaner_id = p_cleaner_id where id = p_booking_id;

  if p_cleaner_id is not null then
    insert into public.notifications (user_id, message)
    values (b.user_id, 'Cleaner ' || v_name || ' was assigned to your booking.');
  end if;
end; $$;

-- ---------- 4. Admin only: list users and change roles ----------
create or replace function public.admin_list_users()
returns table (
  user_id uuid, email text, full_name text, role text, created_at timestamptz,
  orders bigint, spent numeric, last_order timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;

  return query
  select p.id, p.email, p.full_name, p.role, p.created_at,
         (select count(*) from public.bookings b
           where b.user_id = p.id and b.status <> 'cancelled'),
         coalesce((select sum(pay.amount) from public.payments pay
           where pay.user_id = p.id and pay.status = 'paid'), 0),
         (select max(b.created_at) from public.bookings b where b.user_id = p.id)
    from public.profiles p
   order by p.created_at desc;
end; $$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_role not in ('customer', 'staff', 'admin') then
    raise exception 'Invalid role.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'User not found.';
  end if;

  insert into public.notifications (user_id, message)
  values (p_user_id, 'Your account type was changed to ' || p_role || '.');
end; $$;

revoke all on function public.admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

-- ---------- 5. Speed for customers who order a lot ----------
create index if not exists bookings_user_created_idx on public.bookings (user_id, created_at desc);
create index if not exists bookings_slot_idx on public.bookings (preferred_date, preferred_time);
create index if not exists payments_user_idx on public.payments (user_id);
create index if not exists ratings_user_idx on public.ratings (user_id);

notify pgrst, 'reload schema';
