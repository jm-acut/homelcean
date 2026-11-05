-- =====================================================================
-- HomeClean: admin dashboard, add-ons, promo codes, no double booking,
-- reschedule, cleaners, receipts, average ratings.
-- Run the whole script once in Supabase -> SQL Editor.
-- =====================================================================

-- ---------- 0. Admin helper ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 1. New booking status: completed ----------
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending', 'accepted', 'completed', 'cancelled'));

-- ---------- 2. Cleaners (staff) ----------
create table if not exists public.cleaners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cleaners enable row level security;

drop policy if exists "cleaners read" on public.cleaners;
create policy "cleaners read" on public.cleaners
  for select to authenticated using (true);
drop policy if exists "cleaners admin insert" on public.cleaners;
create policy "cleaners admin insert" on public.cleaners
  for insert to authenticated with check (public.is_admin());
drop policy if exists "cleaners admin update" on public.cleaners;
create policy "cleaners admin update" on public.cleaners
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.cleaners to authenticated;

insert into public.cleaners (name)
select v from (values ('Maria Santos'), ('Juan Dela Cruz'), ('Ana Reyes')) as t(v)
where not exists (select 1 from public.cleaners);

-- ---------- 3. New booking columns ----------
alter table public.bookings add column if not exists cleaner_id uuid references public.cleaners(id) on delete set null;
alter table public.bookings add column if not exists service_price numeric(10,2);
alter table public.bookings add column if not exists addons_total numeric(10,2) not null default 0;
alter table public.bookings add column if not exists discount numeric(10,2) not null default 0;
alter table public.bookings add column if not exists promo_code text;
alter table public.bookings add column if not exists total numeric(10,2);
alter table public.bookings add column if not exists cancelled_at timestamptz;

-- Old bookings: fill in the price columns
update public.bookings b set
  service_price = coalesce(b.service_price,
    (select s.price from public.services s where s.id = b.service_id)),
  total = coalesce(b.total,
    (select p.amount from public.payments p where p.booking_id = b.id),
    (select s.price from public.services s where s.id = b.service_id))
where b.total is null or b.service_price is null;

-- ---------- 4. Add-ons ----------
create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true
);
alter table public.addons enable row level security;

drop policy if exists "addons read active" on public.addons;
create policy "addons read active" on public.addons
  for select to anon, authenticated using (active or public.is_admin());
drop policy if exists "addons admin write" on public.addons;
create policy "addons admin write" on public.addons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.addons to anon, authenticated;
grant insert, update, delete on public.addons to authenticated;

insert into public.addons (name, price)
select v.name, v.price from (values
  ('Inside the oven', 300),
  ('Window cleaning', 400),
  ('Refrigerator cleaning', 250),
  ('Laundry and ironing', 350)
) as v(name, price)
where not exists (select 1 from public.addons);

create table if not exists public.booking_addons (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  addon_id uuid references public.addons(id) on delete set null,
  name text not null,
  price numeric(10,2) not null
);
alter table public.booking_addons enable row level security;

drop policy if exists "booking_addons read own" on public.booking_addons;
create policy "booking_addons read own" on public.booking_addons
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b
       where b.id = booking_addons.booking_id and b.user_id = auth.uid())
  );
grant select on public.booking_addons to authenticated;

-- ---------- 5. Promo codes ----------
create table if not exists public.promo_codes (
  code text primary key check (code = upper(code)),
  percent_off int check (percent_off between 1 and 100),
  amount_off numeric(10,2) check (amount_off > 0),
  active boolean not null default true,
  expires_on date,
  max_uses int,
  used_count int not null default 0,
  check (percent_off is not null or amount_off is not null)
);
alter table public.promo_codes enable row level security;

drop policy if exists "promo admin only" on public.promo_codes;
create policy "promo admin only" on public.promo_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.promo_codes to authenticated;

insert into public.promo_codes (code, percent_off, amount_off) values
  ('WELCOME10', 10, null),
  ('CLEAN50', null, 50)
on conflict (code) do nothing;

create or replace function public.check_promo(p_code text, p_subtotal numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pc record;
  v_discount numeric;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;

  select * into pc from public.promo_codes where code = upper(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'That promo code is not valid.';
  end if;
  if not pc.active then
    raise exception 'That promo code is not valid.';
  end if;
  if pc.expires_on is not null and pc.expires_on < (now() at time zone 'Asia/Manila')::date then
    raise exception 'That promo code has expired.';
  end if;
  if pc.max_uses is not null and pc.used_count >= pc.max_uses then
    raise exception 'That promo code has reached its limit.';
  end if;

  if pc.percent_off is not null then
    v_discount := round(p_subtotal * pc.percent_off / 100.0, 2);
  else
    v_discount := pc.amount_off;
  end if;
  v_discount := least(v_discount, p_subtotal);

  return jsonb_build_object('code', pc.code, 'discount', v_discount);
end; $$;

revoke all on function public.check_promo(text, numeric) from public, anon;
grant execute on function public.check_promo(text, numeric) to authenticated;

-- ---------- 6. Time slots already taken (no double booking) ----------
create or replace function public.taken_slots(p_date text, p_exclude uuid default null)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(to_char(b.preferred_time, 'HH24:MI')), '{}')
    from public.bookings b
   where b.preferred_date = p_date::date
     and b.status in ('pending', 'accepted', 'completed')
     and (p_exclude is null or b.id <> p_exclude);
$$;
revoke all on function public.taken_slots(text, uuid) from public, anon;
grant execute on function public.taken_slots(text, uuid) to authenticated;

-- ---------- 7. Create a booking (service + add-ons + promo + payment) ----------
drop function if exists public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision);
drop function if exists public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text);

create or replace function public.create_booking_with_payment(
  p_service_id uuid,
  p_customer_name text,
  p_phone text,
  p_address text,
  p_date text,
  p_time text,
  p_notes text,
  p_method text,
  p_gcash text,
  p_lat double precision,
  p_lng double precision,
  p_addon_ids uuid[],
  p_promo text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_capacity constant int := 1;        -- bookings allowed per date + time slot
  v_price numeric;
  v_addons numeric := 0;
  v_addon_count int := 0;
  v_subtotal numeric;
  v_discount numeric := 0;
  v_code text := null;
  v_promo jsonb;
  v_total numeric;
  v_booking_id uuid;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  if p_method not in ('gcash', 'cash') then
    raise exception 'Choose a payment method.';
  end if;
  if p_method = 'gcash' and coalesce(p_gcash, '') !~ '^09[0-9]{9}$' then
    raise exception 'Enter a valid GCash number like 09171234567.';
  end if;
  if p_phone !~ '^09[0-9]{9}$' then
    raise exception 'Enter a valid Philippine mobile number.';
  end if;
  if coalesce(trim(p_customer_name), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'Please complete all required fields.';
  end if;
  if p_date::date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'Choose today or a future date.';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Please choose your cleaning location on the map.';
  end if;

  -- Service price
  select coalesce(s.price, 0) into v_price
    from public.services s
   where s.id = p_service_id and s.active = true;
  if not found then
    raise exception 'Service not found.';
  end if;

  -- Add-ons
  select coalesce(sum(a.price), 0), count(*) into v_addons, v_addon_count
    from public.addons a
   where a.id = any(coalesce(p_addon_ids, '{}'::uuid[])) and a.active;
  if v_addon_count <> coalesce(array_length(p_addon_ids, 1), 0) then
    raise exception 'One of the add-ons is not available.';
  end if;

  v_subtotal := v_price + v_addons;

  -- Promo code
  if coalesce(trim(p_promo), '') <> '' then
    v_promo := public.check_promo(p_promo, v_subtotal);
    v_discount := (v_promo ->> 'discount')::numeric;
    v_code := v_promo ->> 'code';
  end if;
  v_total := greatest(v_subtotal - v_discount, 0);

  -- No double booking: lock this date + time, then check it is free
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date || ' ' || p_time));
  if (select count(*) from public.bookings b
       where b.preferred_date = p_date::date
         and b.preferred_time = p_time::time
         and b.status in ('pending', 'accepted', 'completed')) >= v_capacity then
    raise exception 'That time slot is already booked. Please choose another time.';
  end if;

  insert into public.bookings
    (user_id, service_id, customer_name, phone, address,
     preferred_date, preferred_time, notes, status, latitude, longitude,
     service_price, addons_total, discount, promo_code, total)
  values
    (auth.uid(), p_service_id, trim(p_customer_name), p_phone, trim(p_address),
     p_date::date, p_time::time, nullif(trim(coalesce(p_notes, '')), ''), 'pending',
     p_lat, p_lng, v_price, v_addons, v_discount, v_code, v_total)
  returning id into v_booking_id;

  insert into public.booking_addons (booking_id, addon_id, name, price)
  select v_booking_id, a.id, a.name, a.price
    from public.addons a
   where a.id = any(coalesce(p_addon_ids, '{}'::uuid[])) and a.active;

  if v_code is not null then
    update public.promo_codes set used_count = used_count + 1 where code = v_code;
  end if;

  v_ref := case when p_method = 'gcash' then 'GC-' else 'CS-' end
           || to_char(now() at time zone 'Asia/Manila', 'YYMMDD')
           || '-' || upper(substr(md5(random()::text), 1, 6));

  insert into public.payments
    (booking_id, user_id, method, gcash_number, amount, reference_no, status)
  values
    (v_booking_id, auth.uid(), p_method,
     case when p_method = 'gcash' then p_gcash else null end,
     v_total, v_ref,
     case when p_method = 'gcash' then 'paid' else 'cash_due' end);

  insert into public.notifications (user_id, message)
  values (auth.uid(),
    case when p_method = 'gcash'
      then 'GCash payment of PHP ' || to_char(v_total, 'FM999,999,990.00') ||
           ' sent from ' || p_gcash || '. Ref: ' || v_ref
      else 'Booking saved. Please pay PHP ' || to_char(v_total, 'FM999,999,990.00') ||
           ' in cash on the service day. Ref: ' || v_ref
    end);

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'reference_no', v_ref,
    'amount', v_total,
    'discount', v_discount,
    'gcash_number', p_gcash,
    'method', p_method
  );
end; $$;

revoke all on function public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision, uuid[], text) from public, anon;
grant execute on function public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision, uuid[], text) to authenticated;

-- ---------- 8. Reschedule ----------
create or replace function public.reschedule_booking(p_booking_id uuid, p_date text, p_time text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;

  select bk.id, bk.status into b
    from public.bookings bk
   where bk.id = p_booking_id and bk.user_id = auth.uid();
  if not found then
    raise exception 'Booking not found.';
  end if;
  if b.status not in ('pending', 'accepted') then
    raise exception 'Only pending or accepted bookings can be rescheduled.';
  end if;
  if p_date::date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'Choose today or a future date.';
  end if;

  perform pg_advisory_xact_lock(hashtext('slot:' || p_date || ' ' || p_time));
  if exists (select 1 from public.bookings x
              where x.id <> p_booking_id
                and x.preferred_date = p_date::date
                and x.preferred_time = p_time::time
                and x.status in ('pending', 'accepted', 'completed')) then
    raise exception 'That time slot is already booked. Please choose another time.';
  end if;

  update public.bookings
     set preferred_date = p_date::date, preferred_time = p_time::time
   where id = p_booking_id;

  insert into public.notifications (user_id, message)
  values (auth.uid(), 'Your booking was rescheduled to ' || p_date || ' at ' || p_time || '.');

  return jsonb_build_object('date', p_date, 'time', p_time);
end; $$;

revoke all on function public.reschedule_booking(uuid, text, text) from public, anon;
grant execute on function public.reschedule_booking(uuid, text, text) to authenticated;

-- ---------- 9. Cancel (5-minute window) ----------
drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(p_booking_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where id = p_booking_id
     and user_id = auth.uid()
     and status = 'pending'
     and created_at > now() - interval '5 minutes';
  get diagnostics n = row_count;
  return n > 0;
end; $$;

revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- Cancelling refunds GCash and cancels cash payments
create or replace function public.refund_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.payments set status = 'refunded'
     where booking_id = new.id and status = 'paid';
    if found then
      insert into public.notifications (user_id, message)
      values (new.user_id, 'Booking cancelled. Your GCash payment was refunded (demo).');
    end if;
    update public.payments set status = 'cancelled'
     where booking_id = new.id and status = 'cash_due';
  end if;
  return new;
end; $$;

drop trigger if exists bookings_refund on public.bookings;
create trigger bookings_refund after update on public.bookings
  for each row execute function public.refund_on_cancel();

-- ---------- 10. Rating (accepted or completed bookings) ----------
create or replace function public.rate_booking(p_booking_id uuid, p_rating int, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose 1 to 5 stars.';
  end if;

  select bk.id, bk.status, bk.service_id into b
    from public.bookings bk
   where bk.id = p_booking_id and bk.user_id = auth.uid();
  if not found then
    raise exception 'Booking not found.';
  end if;
  if b.status not in ('accepted', 'completed') then
    raise exception 'You can rate only an accepted or completed booking.';
  end if;
  if exists (select 1 from public.ratings r where r.booking_id = p_booking_id) then
    raise exception 'You already rated this booking.';
  end if;

  insert into public.ratings (booking_id, user_id, service_id, rating, comment)
  values (p_booking_id, auth.uid(), b.service_id, p_rating,
          nullif(left(trim(coalesce(p_comment, '')), 500), ''));

  insert into public.notifications (user_id, message)
  values (auth.uid(), 'Thank you for rating your cleaning ' || p_rating || ' out of 5 stars.');

  return jsonb_build_object('rating', p_rating);
end; $$;

-- ---------- 11. Average rating per service (public) ----------
create or replace function public.service_rating_summary()
returns table (svc_id uuid, avg_rating numeric, review_count bigint)
language sql stable security definer set search_path = public as $$
  select r.service_id, round(avg(r.rating)::numeric, 1), count(*)
    from public.ratings r
   where r.service_id is not null
   group by r.service_id;
$$;
revoke all on function public.service_rating_summary() from public;
grant execute on function public.service_rating_summary() to anon, authenticated;

-- ---------- 12. Admin actions ----------
create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
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

  -- Cash is collected when the job is done
  if p_status = 'completed' then
    update public.payments set status = 'paid'
     where booking_id = p_booking_id and status = 'cash_due';
  end if;

  insert into public.notifications (user_id, message)
  values (b.user_id, 'Your booking was marked as ' || p_status || '.');
end; $$;

revoke all on function public.admin_set_booking_status(uuid, text) from public, anon;
grant execute on function public.admin_set_booking_status(uuid, text) to authenticated;

create or replace function public.admin_assign_cleaner(p_booking_id uuid, p_cleaner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
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

revoke all on function public.admin_assign_cleaner(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_cleaner(uuid, uuid) to authenticated;

-- ---------- 13. Admin can read everything needed for the dashboard ----------
drop policy if exists "bookings admin select" on public.bookings;
create policy "bookings admin select" on public.bookings
  for select to authenticated using (public.is_admin());

drop policy if exists "payments admin select" on public.payments;
create policy "payments admin select" on public.payments
  for select to authenticated using (public.is_admin());

drop policy if exists "ratings admin select" on public.ratings;
create policy "ratings admin select" on public.ratings
  for select to authenticated using (public.is_admin());

-- ---------- 14. Lock down direct writes: all changes go through the functions above ----------
revoke insert, update, delete on public.bookings from authenticated;

-- ---------- 15. Refresh Supabase's function list ----------
notify pgrst, 'reload schema';
