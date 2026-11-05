-- Saved details and choose-your-cleaner. Run once in Supabase SQL Editor (role: postgres).

-- 1. Saved details on the profile
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists latitude double precision;
alter table public.profiles add column if not exists longitude double precision;
alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles add constraint profiles_phone_check
  check (phone is null or phone ~ '^09[0-9]{9}$');
grant update (full_name, phone, address, latitude, longitude) on public.profiles to authenticated;

-- New accounts keep the details typed at sign-up (the role is always customer)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, phone, address, latitude, longitude, role)
  values (
    new.id, new.email,
    nullif(trim(coalesce(m ->> 'full_name', '')), ''),
    case when m ->> 'phone' ~ '^09[0-9]{9}$' then m ->> 'phone' end,
    nullif(trim(coalesce(m ->> 'address', '')), ''),
    case when m ->> 'latitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then (m ->> 'latitude')::double precision end,
    case when m ->> 'longitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then (m ->> 'longitude')::double precision end,
    'customer')
  on conflict (id) do nothing;
  return new;
end; $$;

-- 2. Cleaner cards and availability
create or replace function public.list_cleaners()
returns table (cleaner_id uuid, name text, avg_rating numeric, jobs bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name,
    (select round(avg(r.rating)::numeric, 1) from public.ratings r
       join public.bookings b on b.id = r.booking_id where b.cleaner_id = c.id),
    (select count(*) from public.bookings b where b.cleaner_id = c.id and b.status = 'completed')
  from public.cleaners c where c.active order by c.name;
$$;
revoke all on function public.list_cleaners() from public, anon;
grant execute on function public.list_cleaners() to authenticated;

create or replace function public.busy_cleaners(p_date text, p_time text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct b.cleaner_id), '{}')
    from public.bookings b
   where b.preferred_date = p_date::date and b.preferred_time = p_time::time
     and b.status in ('pending', 'accepted', 'completed') and b.cleaner_id is not null;
$$;
revoke all on function public.busy_cleaners(text, text) from public, anon;
grant execute on function public.busy_cleaners(text, text) to authenticated;

-- A time is taken when every cleaner is busy (or the chosen cleaner is busy)
drop function if exists public.taken_slots(text, uuid);
create or replace function public.taken_slots(p_date text, p_exclude uuid default null, p_cleaner uuid default null)
returns text[] language sql stable security definer set search_path = public as $$
  with n as (select greatest(count(*), 1) as c from public.cleaners where active),
  s as (
    select b.preferred_time as t, count(*) as total,
           count(*) filter (where p_cleaner is not null and b.cleaner_id = p_cleaner) as mine
      from public.bookings b
     where b.preferred_date = p_date::date
       and b.status in ('pending', 'accepted', 'completed')
       and (p_exclude is null or b.id <> p_exclude)
     group by b.preferred_time)
  select coalesce(array_agg(to_char(s.t, 'HH24:MI')), '{}')
    from s, n where s.total >= n.c or s.mine > 0;
$$;
revoke all on function public.taken_slots(text, uuid, uuid) from public, anon;
grant execute on function public.taken_slots(text, uuid, uuid) to authenticated;

-- 3. Booking with a chosen cleaner (or "any available")
drop function if exists public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision, uuid[], text);
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
  p_promo text,
  p_cleaner_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cleaner uuid;
  v_active int;
  v_busy int;
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

  -- Choose a cleaner: lock this date + time, then check who is free
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date || ' ' || p_time));
  select count(*) into v_active from public.cleaners where active;
  select count(*) into v_busy from public.bookings b
   where b.preferred_date = p_date::date and b.preferred_time = p_time::time
     and b.status in ('pending', 'accepted', 'completed');
  if v_busy >= greatest(v_active, 1) then
    raise exception 'That time is fully booked. Please choose another time.';
  end if;

  if p_cleaner_id is not null then
    perform 1 from public.cleaners c where c.id = p_cleaner_id and c.active;
    if not found then
      raise exception 'That cleaner is not available.';
    end if;
    if exists (select 1 from public.bookings b
                where b.cleaner_id = p_cleaner_id
                  and b.preferred_date = p_date::date and b.preferred_time = p_time::time
                  and b.status in ('pending', 'accepted', 'completed')) then
      raise exception 'That cleaner is already booked at that time. Choose another cleaner or time.';
    end if;
    v_cleaner := p_cleaner_id;
  else
    select c.id into v_cleaner from public.cleaners c
     where c.active and not exists (
       select 1 from public.bookings b
        where b.cleaner_id = c.id
          and b.preferred_date = p_date::date and b.preferred_time = p_time::time
          and b.status in ('pending', 'accepted', 'completed'))
     order by c.name limit 1;
  end if;

  insert into public.bookings
    (user_id, service_id, customer_name, phone, address,
     preferred_date, preferred_time, notes, status, latitude, longitude,
     service_price, addons_total, discount, promo_code, total, cleaner_id)
  values
    (auth.uid(), p_service_id, trim(p_customer_name), p_phone, trim(p_address),
     p_date::date, p_time::time, nullif(trim(coalesce(p_notes, '')), ''), 'pending',
     p_lat, p_lng, v_price, v_addons, v_discount, v_code, v_total, v_cleaner)
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

revoke all on function public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision, uuid[], text, uuid) from public, anon;
grant execute on function public.create_booking_with_payment(uuid, text, text, text, text, text, text, text, text, double precision, double precision, uuid[], text, uuid) to authenticated;


-- 4. Reschedule that respects the cleaner
create or replace function public.reschedule_booking(p_booking_id uuid, p_date text, p_time text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;

  select bk.id, bk.status, bk.cleaner_id into b
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
                and x.status in ('pending', 'accepted', 'completed')
                and (b.cleaner_id is null or x.cleaner_id = b.cleaner_id)) then
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


notify pgrst, 'reload schema';
