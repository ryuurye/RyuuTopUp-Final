-- RyuuTopUp schema. Safe to re-run for this project's tables.
create extension if not exists pgcrypto;

create table if not exists public.rt_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_rt_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rt_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_rt on auth.users;
create trigger on_auth_user_created_rt
after insert on auth.users
for each row execute procedure public.handle_rt_new_user();

-- Backfill profiles for existing Supabase accounts created before this migration.
insert into public.rt_profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name','')
from auth.users
on conflict (id) do update set email = excluded.email;

create table if not exists public.rt_products (
  sku_code text primary key,
  product_name text not null,
  brand_id bigint,
  brand_name text,
  category_name text,
  type_name text,
  provider_price bigint not null check (provider_price >= 0),
  status text not null default 'active' check (status in ('active','out_of_stock','inactive')),
  inquiry_form_key text,
  inquiry_form jsonb not null default '{}'::jsonb,
  server_code text,
  server_name text,
  description text,
  meta jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.rt_products (category_name, brand_name);
create index if not exists products_active_idx on public.rt_products (status) where status = 'active';

create table if not exists public.rt_store_settings (
  id integer primary key default 1 check (id = 1),
  margin_percent numeric(6,2) not null default 10 check (margin_percent >= 0 and margin_percent <= 100),
  updated_at timestamptz not null default now()
);
insert into public.rt_store_settings (id, margin_percent) values (1,10)
on conflict (id) do nothing;

create table if not exists public.rt_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  user_id uuid not null references auth.users(id),
  customer_email text,
  sku_code text not null references public.rt_products(sku_code),
  product_name text not null,
  category_name text,
  target text not null,
  target_zone text,
  additional_data jsonb not null default '{}'::jsonb,
  provider_price bigint not null,
  selling_price bigint not null,
  margin_percent numeric(6,2) not null default 10,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','expired','failed','refund_pending','refunded')),
  fulfillment_status text not null default 'awaiting_payment' check (fulfillment_status in ('awaiting_payment','submitting','processing','success','failed','manual_review')),
  refund_status text not null default 'none' check (refund_status in ('none','requested','submitting','submitted','manual_required','refunded','rejected')),
  midtrans_token text,
  midtrans_redirect_url text,
  midtrans_transaction_id text,
  midtrans_payment_type text,
  midtrans_transaction_status text,
  melo_transaction_id text,
  melo_status text,
  melo_action jsonb not null default '{}'::jsonb,
  serial_number text,
  error_code text,
  error_message text,
  refund_key text,
  refund_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  completed_at timestamptz
);
alter table public.rt_orders add column if not exists melo_action jsonb not null default '{}'::jsonb;
alter table public.rt_orders add column if not exists additional_data jsonb not null default '{}'::jsonb;

create index if not exists orders_user_created_idx on public.rt_orders (user_id, created_at desc);
create index if not exists orders_payment_status_idx on public.rt_orders (payment_status, fulfillment_status);
create index if not exists orders_order_code_idx on public.rt_orders (order_code);
create index if not exists orders_melo_id_idx on public.rt_orders (melo_transaction_id);

create table if not exists public.rt_payment_events (
  event_key text primary key,
  order_code text not null,
  event_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rt_melo_events (
  event_key text primary key,
  order_code text,
  event_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rt_refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.rt_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','submitted','refunded','manual_required')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refund_requests_user_idx on public.rt_refund_requests (user_id, created_at desc);
create index if not exists refund_requests_status_idx on public.rt_refund_requests (status, created_at desc);

create table if not exists public.rt_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  event_name text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS: public catalogue readable; customer rows are owner-only; all writes go through Worker.
alter table public.rt_profiles enable row level security;
alter table public.rt_products enable row level security;
alter table public.rt_store_settings enable row level security;
alter table public.rt_orders enable row level security;
alter table public.rt_payment_events enable row level security;
alter table public.rt_melo_events enable row level security;
alter table public.rt_refund_requests enable row level security;
alter table public.rt_audit_logs enable row level security;

-- Remove inherited broad access before adding narrowly scoped grants.
revoke all on public.rt_profiles, public.rt_products, public.rt_store_settings, public.rt_orders,
  public.rt_payment_events, public.rt_melo_events, public.rt_refund_requests, public.rt_audit_logs
from anon, authenticated;

grant select on public.rt_products to anon, authenticated;
grant select on public.rt_profiles, public.rt_orders, public.rt_refund_requests to authenticated;

-- Profiles: read own profile only. No client can change its role.
drop policy if exists "rt_profile_read_self" on public.rt_profiles;
create policy "rt_profile_read_self" on public.rt_profiles
for select to authenticated using ((select auth.uid()) = id);

-- Catalogue is intentionally public, but read-only.
drop policy if exists "rt_products_read_active" on public.rt_products;
create policy "rt_products_read_active" on public.rt_products
for select to anon, authenticated using (status = 'active');

-- Orders: customers can only read their own orders. Worker/service role owns all writes.
drop policy if exists "rt_orders_read_own" on public.rt_orders;
create policy "rt_orders_read_own" on public.rt_orders
for select to authenticated using ((select auth.uid()) = user_id);

-- Refund requests: customers may read their own requests. Creation and updates go through Worker.
drop policy if exists "rt_refund_read_own" on public.rt_refund_requests;
create policy "rt_refund_read_own" on public.rt_refund_requests
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "rt_refund_insert_own" on public.rt_refund_requests;

-- No policies/grants for store_settings, events, or audit_logs to public client roles.
grant all on public.rt_profiles, public.rt_products, public.rt_store_settings, public.rt_orders,
  public.rt_payment_events, public.rt_melo_events, public.rt_refund_requests, public.rt_audit_logs
to service_role;

-- Atomic single-claim for provider fulfillment after verified payment.
create or replace function public.claim_order_for_melo(p_order_id uuid)
returns setof public.rt_orders
language sql
security definer
set search_path = public
as $$
  update public.rt_orders
  set fulfillment_status = 'submitting', updated_at = now()
  where id = p_order_id
    and payment_status = 'paid'
    and fulfillment_status = 'awaiting_payment'
    and melo_transaction_id is null
  returning *;
$$;
revoke all on function public.claim_order_for_melo(uuid) from public, anon, authenticated;
grant execute on function public.claim_order_for_melo(uuid) to service_role;

-- Store the newest provider customer-action (for example, Melo 2FA) without touching order/payment status.
create or replace function public.update_melo_action(p_order_id uuid, p_action jsonb)
returns setof public.rt_orders
language sql
security definer
set search_path = public
as $$
  update public.rt_orders
  set melo_action = p_action, updated_at = now()
  where id = p_order_id
    and (
      coalesce((melo_action->>'version')::integer, 0) < coalesce((p_action->>'version')::integer, 0)
      or (
        coalesce((melo_action->>'version')::integer, 0) = coalesce((p_action->>'version')::integer, 0)
        and melo_action->>'state' = 'required'
        and p_action->>'state' = 'submitted'
      )
    )
  returning *;
$$;
revoke all on function public.update_melo_action(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_melo_action(uuid, jsonb) to service_role;

-- Updated-at triggers.
create or replace function public.rt_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists rt_profiles_updated_at on public.rt_profiles;
create trigger rt_profiles_updated_at before update on public.rt_profiles for each row execute procedure public.rt_set_updated_at();
drop trigger if exists rt_products_updated_at on public.rt_products;
create trigger rt_products_updated_at before update on public.rt_products for each row execute procedure public.rt_set_updated_at();
drop trigger if exists rt_orders_updated_at on public.rt_orders;
create trigger rt_orders_updated_at before update on public.rt_orders for each row execute procedure public.rt_set_updated_at();
drop trigger if exists rt_refunds_updated_at on public.rt_refund_requests;
create trigger rt_refunds_updated_at before update on public.rt_refund_requests for each row execute procedure public.rt_set_updated_at();

-- Note: promote the first admin manually using the SQL in docs/DEPLOYMENT_ID.md.
