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
-- Trung tâm / CLB: mỗi khách hàng là một trung tâm, dữ liệu tách riêng.
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',     -- trial | team | club | custom
  max_squads int,                          -- null = không giới hạn
  expires_on date,                         -- null = không hết hạn
  created_at timestamptz default now()
);
create table if not exists org_members (
  org_id uuid references orgs on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'coach' check (role in ('owner','coach','viewer')),
  primary key (org_id, user_id)
);
-- Mã tham gia 6 số: HLV mới nhập mã khi đăng ký để vào đúng trung tâm.
create or replace function gen_join_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from orgs where join_code = c);
  end loop;
  return c;
end $$;
alter table orgs add column if not exists join_code text;
update orgs set join_code = gen_join_code() where join_code is null;
alter table orgs alter column join_code set default gen_join_code();
create unique index if not exists orgs_join_code_idx on orgs (join_code);
-- Ghi lại lần nhập mã sai để chặn dò mã.
create table if not exists join_attempts (
  user_id uuid references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on join_attempts (user_id, at);

-- Mỗi tài khoản chỉ thuộc MỘT trung tâm.
drop index if exists org_members_user_idx;
create unique index if not exists org_members_one_org on org_members (user_id);
create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
alter table squads add column if not exists org_id uuid references orgs on delete cascade;
create index if not exists squads_org_idx on squads (org_id);
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
-- Khoanh cầu thủ khi dừng hình: { t, hold, boxes: [{x,y,w,h,label}] } (toạ độ 0..1 theo khung video 16:9).
alter table clips add column if not exists spotlight jsonb;
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

-- Lần đầu có trung tâm: mọi tuyến đội, HLV và admin hiện có thuộc về Junsport.
-- Admin cũ trở thành CHỦ TRUNG TÂM Junsport (không còn xem được trung tâm khác).
do $$
declare j uuid := '6a756e73-706f-7274-0000-000000000001';
begin
  if not exists (select 1 from orgs where id = j) then
    insert into orgs (id, name, plan) values (j, 'Junsport', 'club');
    update squads set org_id = j where org_id is null;
    insert into org_members (org_id, user_id, role)
      select distinct j, user_id, 'coach' from members on conflict do nothing;
    insert into org_members (org_id, user_id, role)
      select j, user_id, 'owner' from app_admins
      on conflict (org_id, user_id) do update set role = 'owner';
    delete from app_admins;
  end if;
end $$;
alter table squads alter column org_id set not null;

-- ---------- Hàm trợ giúp cho RLS ----------
create or replace function is_super() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;
create or replace function org_of_squad(sid uuid) returns uuid
language sql security definer stable set search_path = public as $$
  select org_id from squads where id = sid
$$;
create or replace function is_org_member(oid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or exists (select 1 from org_members where org_id = oid and user_id = auth.uid())
$$;
create or replace function is_org_owner(oid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or exists (select 1 from org_members where org_id = oid and user_id = auth.uid() and role = 'owner')
$$;
-- Gói còn hạn? Hết hạn thì vẫn xem được nhưng không sửa được.
create or replace function org_active(oid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from orgs where id = oid and (expires_on is null or expires_on >= current_date))
$$;
-- Hai người có chung trung tâm không (để xem tên nhau).
create or replace function shares_org(uid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from org_members a join org_members b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and b.user_id = uid)
$$;
-- Xem tuyến: thành viên tuyến, chủ trung tâm của tuyến, hoặc quản trị hệ thống.
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super()
      or exists (select 1 from members where squad_id = sid and user_id = auth.uid())
      or is_org_owner(org_of_squad(sid))
$$;
-- Sửa trong tuyến: HLV/admin tuyến hoặc chủ trung tâm, và gói còn hạn.
create or replace function is_editor(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or (
    (exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role in ('admin','coach'))
       or is_org_owner(org_of_squad(sid)))
    and org_active(org_of_squad(sid)))
$$;
create or replace function is_admin(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role = 'admin')
      or is_org_owner(org_of_squad(sid))
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
alter table orgs         enable row level security;
alter table org_members  enable row level security;
alter table join_attempts enable row level security; -- không có policy: chỉ hàm hệ thống ghi

drop policy if exists profiles_read   on profiles;
drop policy if exists profiles_update on profiles;
-- Chỉ xem được tên của người cùng trung tâm (không lộ người dùng giữa các khách hàng).
create policy profiles_read   on profiles for select to authenticated using (id = auth.uid() or is_super() or shares_org(id));
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

drop policy if exists orgs_read   on orgs;
drop policy if exists orgs_write  on orgs;
create policy orgs_read  on orgs for select to authenticated using (is_org_member(id));
create policy orgs_write on orgs for update to authenticated using (is_super()) with check (is_super());

drop policy if exists org_members_read   on org_members;
drop policy if exists org_members_update on org_members;
drop policy if exists org_members_delete on org_members;
create policy org_members_read   on org_members for select to authenticated using (is_org_member(org_id));
create policy org_members_update on org_members for update to authenticated using (is_org_owner(org_id)) with check (is_org_owner(org_id));
create policy org_members_delete on org_members for delete to authenticated using (is_org_owner(org_id) and user_id <> auth.uid());

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
-- Tạo tuyến đội trong một trung tâm (chủ trung tâm hoặc quản trị). Kiểm tra gói cước.
drop function if exists create_squad(uuid, text);
create or replace function create_squad(p_id uuid, p_name text, p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not is_org_owner(p_org) then raise exception 'Chỉ chủ trung tâm mới tạo được tuyến đội.'; end if;
  if not (org_active(p_org) or is_super()) then raise exception 'Gói của trung tâm đã hết hạn. Liên hệ để gia hạn.'; end if;
  select max_squads into lim from orgs where id = p_org;
  select count(*) into n from squads where org_id = p_org;
  if lim is not null and n >= lim and not is_super() then
    raise exception 'Gói hiện tại cho tối đa % tuyến đội. Liên hệ để nâng gói.', lim;
  end if;
  insert into squads (id, name, org_id) values (p_id, p_name, p_org);
  insert into members (squad_id, user_id, role) values (p_id, auth.uid(), 'admin');
  return p_id;
end $$;

-- Quản trị hệ thống tạo trung tâm mới và chỉ định chủ trung tâm (người đó phải đã đăng ký).
create or replace function create_org(p_name text, p_owner_email text, p_plan text default 'trial',
                                      p_max_squads int default null, p_expires date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare oid uuid; uid uuid;
begin
  if not is_super() then raise exception 'Chỉ quản trị hệ thống mới tạo được trung tâm.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_owner_email));
  if uid is null then raise exception 'Chủ trung tâm chưa có tài khoản. Hãy nhờ họ đăng ký trước.'; end if;
  if exists (select 1 from org_members where user_id = uid) then
    raise exception 'Tài khoản này đã thuộc một trung tâm khác. Hãy dùng tài khoản khác làm chủ trung tâm.';
  end if;
  insert into orgs (name, plan, max_squads, expires_on) values (p_name, p_plan, p_max_squads, p_expires) returning id into oid;
  insert into org_members (org_id, user_id, role) values (oid, uid, 'owner');
  return oid;
end $$;

-- HLV tự vào trung tâm bằng mã 6 số. Trả về: ok | already | bad_code | too_many | auth.
-- Vào trung tâm chỉ thành HLV CHƯA thuộc tuyến nào: chưa xem được dữ liệu cho tới khi được mời vào tuyến.
create or replace function join_org_by_code(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare oid uuid; n int;
begin
  if auth.uid() is null then return 'auth'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then return 'already'; end if;
  select count(*) into n from join_attempts where user_id = auth.uid() and at > now() - interval '1 hour';
  if n >= 10 then return 'too_many'; end if;
  select id into oid from orgs where join_code = trim(p_code);
  if oid is null then
    insert into join_attempts (user_id) values (auth.uid());
    return 'bad_code';
  end if;
  insert into org_members (org_id, user_id, role) values (oid, auth.uid(), 'coach');
  return 'ok';
end $$;

-- Chủ trung tâm đổi mã mới (khi lỡ lộ mã).
create or replace function regen_join_code(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_org_owner(p_org) then raise exception 'Chỉ chủ trung tâm mới đổi được mã.'; end if;
  update orgs set join_code = gen_join_code() where id = p_org returning join_code into c;
  return c;
end $$;

-- Chủ trung tâm thêm người vào trung tâm (owner / coach / viewer).
create or replace function add_org_member(p_org uuid, p_email text, p_role text default 'coach') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_org_owner(p_org) then raise exception 'Chỉ chủ trung tâm mới thêm được thành viên.'; end if;
  if p_role not in ('owner','coach','viewer') then raise exception 'Vai trò không hợp lệ'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Chưa có tài khoản này. Hãy nhờ họ đăng ký trước.'; end if;
  if exists (select 1 from org_members where user_id = uid and org_id <> p_org) then
    raise exception 'Tài khoản này đã thuộc một trung tâm khác. Mỗi HLV chỉ thuộc một trung tâm.';
  end if;
  insert into org_members (org_id, user_id, role) values (p_org, uid, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;
end $$;

-- Admin thêm thành viên theo email (người đó phải đã đăng ký).
create or replace function add_member(p_squad uuid, p_email text, p_role text default 'coach') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (is_admin(p_squad) or is_super()) then raise exception 'Chỉ admin tuyến hoặc chủ trung tâm mới thêm được thành viên.'; end if;
  if p_role not in ('admin','coach','viewer') then raise exception 'role không hợp lệ'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Chưa có tài khoản với email này. Hãy nhờ họ đăng ký trước.'; end if;
  if exists (select 1 from org_members where user_id = uid and org_id <> org_of_squad(p_squad)) then
    raise exception 'Tài khoản này đã thuộc một trung tâm khác. Mỗi HLV chỉ thuộc một trung tâm.';
  end if;
  insert into members (squad_id, user_id, role) values (p_squad, uid, p_role)
    on conflict (squad_id, user_id) do update set role = excluded.role;
  -- Người được mời vào tuyến cũng thành thành viên của trung tâm đó.
  insert into org_members (org_id, user_id, role) values (org_of_squad(p_squad), uid, case when p_role = 'viewer' then 'viewer' else 'coach' end)
    on conflict (org_id, user_id) do nothing;
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
  begin alter publication supabase_realtime add table orgs;         exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table org_members;  exception when duplicate_object then null; end;
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

-- ---------- Thống kê trận đấu (box score kiểu FIBA, cả 2 đội) ----------
alter table games add column if not exists home_name text;
alter table games add column if not exists away_name text;
-- Danh sách cầu thủ CỦA TỪNG TRẬN, mỗi đội một bên (home / away). player_id: nối với cầu thủ của tuyến nếu có.
create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  side text not null check (side in ('home','away')),
  number int not null,
  name text not null,
  player_id uuid references players on delete set null
);
create index if not exists game_players_game_idx on game_players (game_id);
-- Mỗi pha thống kê. video_id / video_t: thời điểm trong video (để bấm vào xem lại); trống khi ghi tại sân.
create table if not exists stat_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  side text not null check (side in ('home','away')),
  game_player_id uuid references game_players on delete cascade,
  type text not null check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS')),
  period int not null default 1,
  video_id uuid references game_videos on delete set null,
  video_t real,
  author uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists stat_events_game_idx on stat_events (game_id);
alter table game_players enable row level security;
alter table stat_events  enable row level security;
drop policy if exists game_players_read  on game_players;
drop policy if exists game_players_write on game_players;
create policy game_players_read  on game_players for select to authenticated using (is_member(squad_of_game(game_id)));
create policy game_players_write on game_players for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));
drop policy if exists stat_events_read  on stat_events;
drop policy if exists stat_events_write on stat_events;
create policy stat_events_read  on stat_events for select to authenticated using (is_member(squad_of_game(game_id)));
create policy stat_events_write on stat_events for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));
do $$ begin
  begin alter publication supabase_realtime add table game_players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table stat_events;  exception when duplicate_object then null; end;
end $$;

-- ---------- Đồng hồ thi đấu, thay người, phút thi đấu ----------
alter table games add column if not exists period_len int not null default 600;      -- giây mỗi hiệp (FIBA 10 phút)
alter table games add column if not exists clock_period int not null default 1;
alter table games add column if not exists clock_remaining real;                        -- giây còn lại khi dừng
alter table games add column if not exists clock_running boolean not null default false;
alter table games add column if not exists clock_started_at timestamptz;               -- lúc bấm chạy
alter table stat_events add column if not exists clock_s real;                          -- giờ trên đồng hồ khi ghi pha
-- Vào sân / ra sân: tính phút thi đấu (MIN) và +/- theo đồng hồ thi đấu.
create table if not exists lineup_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  side text not null check (side in ('home','away')),
  game_player_id uuid not null references game_players on delete cascade,
  kind text not null check (kind in ('in','out')),
  period int not null,
  clock_s real not null,
  author uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists lineup_events_game_idx on lineup_events (game_id);
alter table lineup_events enable row level security;
drop policy if exists lineup_events_read  on lineup_events;
drop policy if exists lineup_events_write on lineup_events;
create policy lineup_events_read  on lineup_events for select to authenticated using (is_member(squad_of_game(game_id)));
create policy lineup_events_write on lineup_events for all to authenticated
  using (is_editor(squad_of_game(game_id))) with check (is_editor(squad_of_game(game_id)));
do $$ begin
  begin alter publication supabase_realtime add table lineup_events; exception when duplicate_object then null; end;
end $$;

-- ---------- Bảng bấm trên điện thoại (quét QR, không cần đăng nhập) ----------
-- Mã QR chứa một token ngẫu nhiên: chỉ cho phép GHI STATS của đúng 1 trận, tự hết hạn, thu hồi được.
alter table stat_events add column if not exists via_remote boolean not null default false;
-- PFS = shooting foul (lỗi khi ném, đối phương được ném phạt). Vẫn tính là 1 PF.
alter table stat_events drop constraint if exists stat_events_type_check;
alter table stat_events add constraint stat_events_type_check check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS'));
create table if not exists remote_tokens (
  token text primary key,
  game_id uuid not null references games on delete cascade,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
create index if not exists remote_tokens_game_idx on remote_tokens (game_id);
alter table remote_tokens enable row level security;
drop policy if exists remote_tokens_read   on remote_tokens;
drop policy if exists remote_tokens_delete on remote_tokens;
create policy remote_tokens_read   on remote_tokens for select to authenticated using (is_member(squad_of_game(game_id)));
create policy remote_tokens_delete on remote_tokens for delete to authenticated using (is_editor(squad_of_game(game_id)));

-- Tạo (hoặc lấy lại) token cho trận. Chỉ người được sửa trận mới tạo được.
create or replace function create_remote_token(p_game uuid, p_hours int default 12) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not is_editor(squad_of_game(p_game)) then raise exception 'Bạn không có quyền ghi stats cho trận này.'; end if;
  select token into t from remote_tokens where game_id = p_game and expires_at > now() + interval '1 hour' order by expires_at desc limit 1;
  if t is not null then return t; end if;
  t := encode(gen_random_bytes(16), 'hex');
  insert into remote_tokens (token, game_id, expires_at) values (t, p_game, now() + make_interval(hours => greatest(1, least(p_hours, 48))));
  return t;
end $$;

-- Trận của token (null nếu sai / hết hạn / gói của trung tâm hết hạn).
create or replace function remote_game_of(p_token text) returns uuid
language sql security definer stable set search_path = public as $$
  select r.game_id from remote_tokens r
  where r.token = p_token and r.expires_at > now() and org_active(org_of_squad(squad_of_game(r.game_id)))
$$;

-- Giây còn lại trên đồng hồ thi đấu lúc này.
create or replace function game_clock_now(g games) returns real
language sql stable as $$
  select greatest(0, coalesce(g.clock_remaining, case when g.clock_period <= 4 then g.period_len else 300 end)
    - case when g.clock_running and g.clock_started_at is not null then extract(epoch from now() - g.clock_started_at) else 0 end)::real
$$;

-- Toàn bộ thông tin cho bảng bấm trên điện thoại.
create or replace function remote_state(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare gid uuid; g games; res jsonb;
begin
  gid := remote_game_of(p_token);
  if gid is null then return jsonb_build_object('error', 'Mã QR không hợp lệ hoặc đã hết hạn.'); end if;
  select * into g from games where id = gid;
  with ev as (select * from stat_events where game_id = gid),
       last_in as (select distinct on (game_player_id) game_player_id, kind from lineup_events where game_id = gid order by game_player_id, created_at desc)
  select jsonb_build_object(
    'game', jsonb_build_object('title', g.title, 'home', coalesce(nullif(g.home_name, ''), (select name from squads where id = g.squad_id)), 'away', coalesce(nullif(g.away_name, ''), 'AWAY'),
      'period', g.clock_period, 'clock', game_clock_now(g), 'running', g.clock_running),
    'score', jsonb_build_object(
      'home', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where side = 'home'),
      'away', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where side = 'away')),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'side', p.side, 'number', p.number, 'name', p.name,
        'on', coalesce((select kind = 'in' from last_in li where li.game_player_id = p.id), false),
        'pts', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where ev.game_player_id = p.id),
        'pf', (select count(*) from ev where ev.game_player_id = p.id and type in ('PF','PFS'))) order by p.side, p.number)
      from game_players p where p.game_id = gid), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('id', e.id, 'type', e.type, 'side', e.side, 'number', p.number, 'name', p.name, 'remote', e.via_remote, 'at', e.created_at) x
        from ev e left join game_players p on p.id = e.game_player_id order by e.created_at desc limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- Ghi một pha từ điện thoại. Hiệp và giờ lấy theo đồng hồ thi đấu của trận.
create or replace function remote_add_stat(p_token text, p_player uuid, p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games; ps text;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select side into ps from game_players where id = p_player and game_id = gid;
  if ps is null then return 'Cầu thủ không thuộc trận này.'; end if;
  if p_type not in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS') then return 'Loại pha không hợp lệ.'; end if;
  select * into g from games where id = gid;
  insert into stat_events (game_id, side, game_player_id, type, period, clock_s, via_remote, author)
    values (gid, ps, p_player, p_type, g.clock_period, game_clock_now(g), true, null);
  return 'ok';
end $$;

-- Hoàn tác pha gần nhất do điện thoại ghi (trong 10 phút).
create or replace function remote_undo(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; eid uuid;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select id into eid from stat_events where game_id = gid and via_remote and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
  if eid is null then return 'Không có pha nào để hoàn tác.'; end if;
  delete from stat_events where id = eid;
  return 'ok';
end $$;

grant execute on function remote_state(text), remote_add_stat(text, uuid, text), remote_undo(text) to anon, authenticated;
grant execute on function create_remote_token(uuid, int) to authenticated;
revoke execute on function create_remote_token(uuid, int) from anon;

-- ---------- Tổng quan trận đấu (cho màn hình chọn trận / tìm kiếm) ----------
-- security invoker: RLS vẫn áp dụng, coach chỉ thấy trận của tuyến mình, quản trị thấy tất cả.
drop function if exists game_overview();
create or replace function game_overview()
returns table (game_id uuid, squad_id uuid, squad_name text, org_id uuid, org_name text, title text, played_on date, videos int, clips int)
language sql stable security invoker set search_path = public as $$
  select g.id, g.squad_id, s.name, s.org_id, o.name, g.title, g.played_on,
         (select count(*)::int from game_videos v where v.game_id = g.id),
         (select count(*)::int from clips c where c.game_id = g.id)
  from games g join squads s on s.id = g.squad_id left join orgs o on o.id = s.org_id
  order by g.played_on desc nulls last, g.title
$$;

-- Báo Supabase nạp lại danh sách bảng ngay (tránh lỗi "schema cache").
notify pgrst, 'reload schema';
