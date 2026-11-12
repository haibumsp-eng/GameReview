-- GameReview schema. Chạy toàn bộ file này trong Supabase → SQL Editor → Run.
-- Có thể chạy lại nhiều lần (idempotent).

create extension if not exists pgcrypto;

-- ---------- Bảng ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default ''
);
-- Quản trị toàn hệ thống: xem được mọi tuyến đội / trận đấu. Thêm bằng supabase/make-admin.sql.
create table if not exists app_admins (
  user_id uuid primary key references auth.users on delete cascade
);
create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
create table if not exists members (
  squad_id uuid references squads on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'coach' check (role in ('admin','coach','viewer')),
  primary key (squad_id, user_id)
);
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads on delete cascade,
  number int not null,
  name text not null
);
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads on delete cascade,
  title text not null,
  played_on date,
  youtube_id text not null
);
-- Mỗi trận có nhiều video (Hiệp 1..4, OT...), mỗi video là một link YouTube.
create table if not exists game_videos (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  label text not null default 'Hiệp 1',
  youtube_id text not null,
  position int not null default 1
);
create index if not exists game_videos_game_idx on game_videos (game_id);
alter table games alter column youtube_id drop not null;
create table if not exists clips (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  start_s real not null,
  end_s real not null,
  side text not null check (side in ('ATK','DEF')),
  team_wide boolean not null default false,
  play_type text not null default '',
  note text not null default '',
  author uuid default auth.uid() references auth.users on delete set null
);
alter table clips add column if not exists video_id uuid references game_videos on delete cascade;
create table if not exists clip_players (
  clip_id uuid references clips on delete cascade,
  player_id uuid references players on delete cascade,
  primary key (clip_id, player_id)
);
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references clips on delete cascade,
  author uuid default auth.uid() references auth.users on delete set null,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists clips_game_idx on clips (game_id);
create index if not exists comments_clip_idx on comments (clip_id);
create index if not exists players_squad_idx on players (squad_id);
create index if not exists games_squad_idx on games (squad_id);

-- Chuyển dữ liệu cũ (trận chỉ có 1 link) sang bảng game_videos.
insert into game_videos (game_id, label, youtube_id, position)
  select g.id, 'Video 1', g.youtube_id, 1 from games g
  where g.youtube_id is not null and not exists (select 1 from game_videos v where v.game_id = g.id);
update clips c set video_id = (select v.id from game_videos v where v.game_id = c.game_id order by v.position limit 1)
  where c.video_id is null;
create index if not exists clips_video_idx on clips (video_id);

-- ---------- Hàm trợ giúp cho RLS ----------
create or replace function is_super() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or exists (select 1 from members where squad_id = sid and user_id = auth.uid())
$$;
create or replace function is_editor(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role in ('admin','coach'))
$$;
create or replace function is_admin(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role = 'admin')
$$;
create or replace function squad_of_game(gid uuid) returns uuid
language sql security definer stable set search_path = public as $$
  select squad_id from games where id = gid
$$;
create or replace function squad_of_clip(cid uuid) returns uuid
language sql security definer stable set search_path = public as $$
  select g.squad_id from clips c join games g on g.id = c.game_id where c.id = cid
$$;

-- ---------- RLS ----------
alter table profiles     enable row level security;
alter table squads       enable row level security;
alter table members      enable row level security;
alter table players      enable row level security;
alter table games        enable row level security;
alter table clips        enable row level security;
alter table clip_players enable row level security;
alter table comments     enable row level security;
alter table app_admins   enable row level security;
alter table game_videos  enable row level security;

drop policy if exists profiles_read   on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_read   on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated using (id = auth.uid());

drop policy if exists squads_read   on squads;
drop policy if exists squads_update on squads;
drop policy if exists squads_delete on squads;
create policy squads_read   on squads for select to authenticated using (is_member(id));
create policy squads_update on squads for update to authenticated using (is_admin(id));
create policy squads_delete on squads for delete to authenticated using (is_admin(id));

drop policy if exists members_read   on members;
drop policy if exists members_update on members;
drop policy if exists members_delete on members;
create policy members_read   on members for select to authenticated using (is_member(squad_id));
create policy members_update on members for update to authenticated using (is_admin(squad_id));
create policy members_delete on members for delete to authenticated using (is_admin(squad_id) or user_id = auth.uid());

drop policy if exists players_read  on players;
drop policy if exists players_write on players;
create policy players_read  on players for select to authenticated using (is_member(squad_id));
create policy players_write on players for all to authenticated using (is_editor(squad_id)) with check (is_editor(squad_id));

drop policy if exists games_read  on games;
drop policy if exists games_write on games;
create policy games_read  on games for select to authenticated using (is_member(squad_id));
create policy games_write on games for all to authenticated using (is_editor(squad_id)) with check (is_editor(squad_id));

drop policy if exists app_admins_self on app_admins;
create policy app_admins_self on app_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists game_videos_read  on game_videos;
drop policy if exists game_videos_write on game_videos;
create policy game_videos_read  on game_videos for select to authenticated using (is_member(squad_of_game(game_id)));
create policy game_videos_write on game_videos for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));

drop policy if exists clips_read  on clips;
drop policy if exists clips_write on clips;
create policy clips_read  on clips for select to authenticated using (is_member(squad_of_game(game_id)));
create policy clips_write on clips for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));

drop policy if exists clip_players_read  on clip_players;
drop policy if exists clip_players_write on clip_players;
create policy clip_players_read  on clip_players for select to authenticated using (is_member(squad_of_clip(clip_id)));
create policy clip_players_write on clip_players for all to authenticated
  using (is_editor(squad_of_clip(clip_id))) with check (is_editor(squad_of_clip(clip_id)));

drop policy if exists comments_read   on comments;
drop policy if exists comments_insert on comments;
drop policy if exists comments_delete on comments;
create policy comments_read   on comments for select to authenticated using (is_member(squad_of_clip(clip_id)));
create policy comments_insert on comments for insert to authenticated
  with check (is_member(squad_of_clip(clip_id)) and author = auth.uid());
create policy comments_delete on comments for delete to authenticated using (author = auth.uid());

-- ---------- RPC ----------
-- Tạo tuyến đội và tự thêm người tạo làm admin.
create or replace function create_squad(p_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into squads (id, name) values (p_id, p_name);
  insert into members (squad_id, user_id, role) values (p_id, auth.uid(), 'admin');
  return p_id;
end $$;

-- Admin thêm thành viên theo email (người đó phải đã đăng ký).
create or replace function add_member(p_squad uuid, p_email text, p_role text default 'coach') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (is_admin(p_squad) or is_super()) then raise exception 'chỉ admin mới thêm được thành viên'; end if;
  if p_role not in ('admin','coach','viewer') then raise exception 'role không hợp lệ'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Chưa có tài khoản với email này. Hãy nhờ họ đăng ký trước.'; end if;
  insert into members (squad_id, user_id, role) values (p_squad, uid, p_role)
    on conflict (squad_id, user_id) do update set role = excluded.role;
end $$;

-- Tự tạo profile khi có người đăng ký.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
-- Bù profile cho tài khoản đã tồn tại trước khi chạy file này.
insert into profiles (id, name)
  select id, coalesce(nullif(raw_user_meta_data->>'name',''), split_part(email,'@',1)) from auth.users
  on conflict (id) do nothing;

-- ---------- Realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table clips;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table clip_players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table comments;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table games;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table players;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table game_videos;  exception when duplicate_object then null; end;
end $$;

-- ---------- Playlist đã lưu (bộ lọc có tên) ----------
create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  name text not null,
  side text check (side in ('ATK','DEF')),
  play_type text not null default '',
  player_ids uuid[] not null default '{}',
  author uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists playlists_game_idx on playlists (game_id);
alter table playlists enable row level security;
drop policy if exists playlists_read  on playlists;
drop policy if exists playlists_write on playlists;
create policy playlists_read  on playlists for select to authenticated using (is_member(squad_of_game(game_id)));
create policy playlists_write on playlists for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));
do $$ begin
  begin alter publication supabase_realtime add table playlists; exception when duplicate_object then null; end;
end $$;

-- ---------- Tổng quan trận đấu (cho màn hình chọn trận / tìm kiếm) ----------
-- security invoker: RLS vẫn áp dụng, coach chỉ thấy trận của tuyến mình, quản trị thấy tất cả.
create or replace function game_overview()
returns table (game_id uuid, squad_id uuid, squad_name text, title text, played_on date, videos int, clips int)
language sql stable security invoker set search_path = public as $$
  select g.id, g.squad_id, s.name, g.title, g.played_on,
         (select count(*)::int from game_videos v where v.game_id = g.id),
         (select count(*)::int from clips c where c.game_id = g.id)
  from games g join squads s on s.id = g.squad_id
  order by g.played_on desc nulls last, g.title
$$;
