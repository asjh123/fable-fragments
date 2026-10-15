-- 第一阶段：公开内容与个人学习事件分表。
-- 在目标 Supabase 项目的 SQL Editor 或 CLI 中执行前，请先确认项目。

create table if not exists public.content_packs (
  content_id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'published', 'retired')),
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (content_id, version)
);

alter table public.content_packs enable row level security;

drop policy if exists "published content is readable" on public.content_packs;
create policy "published content is readable"
  on public.content_packs for select
  to anon, authenticated
  using (status = 'published');

create table if not exists public.learning_events (
  event_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 200),
  event_type text not null check (event_type in (
    'FRAGMENT_COMPLETED', 'QUIZ_ANSWERED', 'CONCEPT_VIEWED',
    'NOTE_SAVED', 'STORY_STARTED', 'STORY_COMPLETED'
  )),
  content_id text not null,
  content_version integer not null check (content_version > 0),
  fragment_id text,
  occurred_at timestamptz not null,
  study_date date not null,
  timezone text not null check (timezone = 'Asia/Shanghai'),
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1 check (schema_version = 1),
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists learning_events_user_created_idx
  on public.learning_events (user_id, created_at, event_id);
create index if not exists learning_events_user_study_date_idx
  on public.learning_events (user_id, study_date);
create index if not exists learning_events_content_idx
  on public.learning_events (user_id, content_id, content_version);

alter table public.learning_events enable row level security;

drop policy if exists "users read own events" on public.learning_events;
create policy "users read own events"
  on public.learning_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own events" on public.learning_events;
create policy "users insert own events"
  on public.learning_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 第一阶段使用只追加事件：客户端不能修改或删除云端事件。
-- service_role 仅用于受信任的管理环境，绝不能放进浏览器。

