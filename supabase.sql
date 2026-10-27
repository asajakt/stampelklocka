-- Kör detta i Supabase: SQL Editor -> New query -> klistra in -> Run.

create table if not exists public.stamps (
  sync_key   text        not null,
  id         text        not null,
  ts         timestamptz not null,
  type       text        not null check (type in ('in', 'out')),
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  primary key (sync_key, id)
);

-- RLS utan policyer = ingen direkt åtkomst till tabellen. All åtkomst går via funktionerna nedan.
alter table public.stamps enable row level security;

create or replace function public.stamps_pull(p_key text)
returns setof public.stamps
language sql security definer set search_path = public
as $$
  select * from public.stamps where sync_key = p_key and length(p_key) >= 20;
$$;

create or replace function public.stamps_push(p_key text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if length(p_key) < 20 then
    raise exception 'Synknyckeln är för kort';
  end if;
  insert into public.stamps (sync_key, id, ts, type, deleted, updated_at)
  select p_key, r.id, r.ts, r.type, coalesce(r.deleted, false), r.updated_at
  from jsonb_to_recordset(p_rows) as r(id text, ts timestamptz, type text, deleted boolean, updated_at timestamptz)
  on conflict (sync_key, id) do update
    set ts = excluded.ts, type = excluded.type, deleted = excluded.deleted, updated_at = excluded.updated_at
    where public.stamps.updated_at < excluded.updated_at;
end;
$$;

revoke all on function public.stamps_pull(text) from public;
revoke all on function public.stamps_push(text, jsonb) from public;
grant execute on function public.stamps_pull(text) to anon;
grant execute on function public.stamps_push(text, jsonb) to anon;
