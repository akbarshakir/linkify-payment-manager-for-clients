-- Linkify Payment Manager: Client Published Links
-- Run once in Supabase SQL Editor. This does not modify vendor, invoice or payment records.

create table if not exists public.client_published_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_party_id uuid not null references public.parties(id) on delete cascade,
  published_url text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'PKR')),
  publication_date date not null default current_date,
  payment_status text not null default 'unpaid' check (payment_status in ('paid', 'unpaid')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_published_links_user_client_date_idx
  on public.client_published_links(user_id, client_party_id, publication_date desc);

create index if not exists client_published_links_user_status_idx
  on public.client_published_links(user_id, payment_status);

alter table public.client_published_links enable row level security;

drop policy if exists "Users can manage their own client published links"
  on public.client_published_links;

create policy "Users can manage their own client published links"
  on public.client_published_links
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.client_published_links
  to authenticated;
