-- Tables required by the Overseer module and Calendar Day Review feature.
-- Run this once in the Supabase SQL editor (project: wlrdwrlxkjgubdmntfxl).

create table if not exists day_reviews (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  raw_text text,
  event_outcomes jsonb default '[]'::jsonb,
  overall_adherence_score integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text
);

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  streak integer default 0,
  completed_today boolean default false,
  created_at timestamptz default now()
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  content text,
  created_at timestamptz default now()
);

create table if not exists overseer_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  role text,
  content text,
  model_used text,
  created_at timestamptz default now()
);

alter table day_reviews enable row level security;
alter table settings enable row level security;
alter table habits enable row level security;
alter table journal_entries enable row level security;
alter table overseer_messages enable row level security;

create policy "allow all day_reviews" on day_reviews for all using (true) with check (true);
create policy "allow all settings" on settings for all using (true) with check (true);
create policy "allow all habits" on habits for all using (true) with check (true);
create policy "allow all journal_entries" on journal_entries for all using (true) with check (true);
create policy "allow all overseer_messages" on overseer_messages for all using (true) with check (true);
