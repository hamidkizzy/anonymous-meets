-- ============================================================
-- CLEAN SLATE — retiring the old class/admin-approval system
-- ============================================================
drop policy if exists "Look up class" on classes;
drop table if exists messages cascade;
drop table if exists identities cascade;
drop table if exists members cascade;
drop table if exists admins cascade;
drop table if exists classes cascade;
drop function if exists is_admin();
drop function if exists is_approved_member(uuid);

-- ============================================================
-- NEW SCHEMA
-- ============================================================

-- Groups: created on demand, open to anyone with the link
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- Chat threads: one per (creator, guest) pair, created lazily
-- the first time a guest opens the creator's personal chat link
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (creator_id, guest_id),
  check (creator_id <> guest_id)
);

create table group_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) <= 500),
  created_at timestamptz not null default now()
);
alter table group_messages replica identity full;

create table chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) <= 500),
  created_at timestamptz not null default now()
);
alter table chat_messages replica identity full;

alter table groups enable row level security;
alter table chat_threads enable row level security;
alter table group_messages enable row level security;
alter table chat_messages enable row level security;

-- ============================================================
-- RLS policies — no admin, no approval, just "are you a
-- participant and has this not expired yet"
-- ============================================================

create policy "Anyone can create a group" on groups
  for insert to authenticated with check (creator_id = auth.uid());

create policy "Anyone can look up a non-expired group" on groups
  for select to authenticated using (expires_at > now());

create policy "Guest can start a thread with a creator" on chat_threads
  for insert to authenticated with check (guest_id = auth.uid());

create policy "Participants can view their thread" on chat_threads
  for select to authenticated
  using (expires_at > now() and (creator_id = auth.uid() or guest_id = auth.uid()));

create policy "Participants can send group messages" on group_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (select 1 from groups g where g.id = group_id and g.expires_at > now())
  );

create policy "Participants can read group messages" on group_messages
  for select to authenticated using (
    exists (select 1 from groups g where g.id = group_id and g.expires_at > now())
  );

create policy "Sender can delete own group message" on group_messages
  for delete to authenticated using (sender_id = auth.uid());

create policy "Participants can send chat messages" on chat_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from chat_threads t
      where t.id = thread_id and t.expires_at > now()
        and (t.creator_id = auth.uid() or t.guest_id = auth.uid())
    )
  );

create policy "Participants can read chat messages" on chat_messages
  for select to authenticated using (
    exists (
      select 1 from chat_threads t
      where t.id = thread_id and t.expires_at > now()
        and (t.creator_id = auth.uid() or t.guest_id = auth.uid())
    )
  );

create policy "Sender can delete own chat message" on chat_messages
  for delete to authenticated using (sender_id = auth.uid());

-- explicit grants (needed since tables are created via raw SQL,
-- see documentation section on this)
grant select, insert, delete on public.groups to authenticated;
grant select, insert, delete on public.chat_threads to authenticated;
grant select, insert, delete on public.group_messages to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;

-- ============================================================
-- Real deletion — actually wipes expired rows to save space,
-- not just hides them. Runs every 15 minutes.
-- ============================================================
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'expire-ephemeral-content',
  '*/15 * * * *',
  $$
    delete from groups where expires_at < now();
    delete from chat_threads where expires_at < now();
  $$
);

-- ============================================================
-- Realtime (bonus live-push, polling remains the primary
-- delivery mechanism per prior testing)
-- ============================================================
alter publication supabase_realtime add table group_messages;
alter publication supabase_realtime add table chat_messages;
