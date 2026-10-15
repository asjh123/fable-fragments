-- PostgREST角色还需要表级权限；RLS继续决定具体可见/可写行。
grant select on table public.content_packs to anon, authenticated, service_role;
grant insert on table public.content_packs to service_role;

grant select, insert on table public.learning_events to authenticated, service_role;

revoke update, delete on table public.content_packs from anon, authenticated;
revoke insert, update, delete on table public.content_packs from anon, authenticated;
revoke all on table public.learning_events from anon;
revoke update, delete on table public.learning_events from authenticated;
