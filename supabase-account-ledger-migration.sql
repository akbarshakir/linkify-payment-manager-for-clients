-- Linkify Payment Manager: Overall Client / Vendor Account Balances
-- Run this once in Supabase SQL Editor before deploying the updated frontend.

create table if not exists public.party_account_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  currency text not null check (currency in ('USD', 'PKR')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_account_targets_user_party_currency_key
    unique (user_id, party_id, currency)
);

create index if not exists party_account_targets_user_id_idx
  on public.party_account_targets(user_id);

create index if not exists party_account_targets_party_id_idx
  on public.party_account_targets(party_id);

alter table public.party_account_targets enable row level security;

drop policy if exists "Users can manage their own party account targets"
  on public.party_account_targets;

create policy "Users can manage their own party account targets"
  on public.party_account_targets
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.party_account_targets
  to authenticated;
