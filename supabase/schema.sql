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
  type text not null check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS','PFT','PFU','PFD','TMO')),
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
alter table stat_events add constraint stat_events_type_check check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS','PFT','PFU','PFD','TMO'));
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

-- ================= Bảng tỉ số livestream (tách riêng khỏi mổ băng và Live Stats) =================
-- Một bảng tỉ số = tên đội, tên giải, tỉ số, hiệp, đồng hồ. Không liên quan tới trận hay stats.
-- Điện thoại điều khiển bằng control_token; OBS chỉ đọc bằng view_token (không ghi được gì).
create or replace function is_org_editor(oid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or (
    exists (select 1 from org_members where org_id = oid and user_id = auth.uid() and role in ('owner','coach'))
    and org_active(oid))
$$;

create table if not exists scoreboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  name text not null default 'Bảng tỉ số',
  league text not null default '',
  home_name text not null default 'HOME',
  away_name text not null default 'AWAY',
  home_score int not null default 0,
  away_score int not null default 0,
  period int not null default 1,
  period_len int not null default 600,
  clock_remaining real not null default 600,
  clock_running boolean not null default false,
  clock_started_at timestamptz,
  control_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  view_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  author uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists scoreboards_org_idx on scoreboards (org_id);
alter table scoreboards enable row level security;
drop policy if exists scoreboards_read   on scoreboards;
drop policy if exists scoreboards_insert on scoreboards;
drop policy if exists scoreboards_update on scoreboards;
drop policy if exists scoreboards_delete on scoreboards;
create policy scoreboards_read   on scoreboards for select to authenticated using (is_org_editor(org_id));
create policy scoreboards_insert on scoreboards for insert to authenticated with check (is_org_editor(org_id));
create policy scoreboards_update on scoreboards for update to authenticated using (is_org_editor(org_id)) with check (is_org_editor(org_id));
create policy scoreboards_delete on scoreboards for delete to authenticated using (is_org_editor(org_id));

-- Giây còn lại trên đồng hồ lúc này.
create or replace function sb_clock_now(s scoreboards) returns real
language sql stable as $$
  select greatest(0, s.clock_remaining
    - case when s.clock_running and s.clock_started_at is not null then extract(epoch from now() - s.clock_started_at) else 0 end)::real
$$;

-- Trạng thái bảng (đọc bằng control_token hoặc view_token). Không cần đăng nhập.
create or replace function sb_state(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare s scoreboards; c real;
begin
  select * into s from scoreboards where (control_token = p_token or view_token = p_token) and org_active(org_id);
  if s.id is null then return jsonb_build_object('error', 'Mã không hợp lệ hoặc gói của trung tâm đã hết hạn.'); end if;
  c := sb_clock_now(s);
  return jsonb_build_object('name', s.name, 'league', s.league, 'home', s.home_name, 'away', s.away_name,
    'score', jsonb_build_object('home', s.home_score, 'away', s.away_score),
    'period', s.period, 'periodLen', s.period_len, 'clock', c, 'running', s.clock_running and c > 0,
    'canControl', s.control_token = p_token);
end $$;

-- Điều khiển bảng bằng control_token: score (side + arg = +/- điểm) | start | stop | set_clock (arg = giây)
-- | period (arg = số hiệp, đồng hồ về đầu hiệp) | reset. Trả về 'ok' hoặc lý do lỗi.
create or replace function sb_act(p_token text, p_action text, p_arg int default null, p_side text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s scoreboards; c real; v int;
begin
  select * into s from scoreboards where control_token = p_token and org_active(org_id) for update;
  if s.id is null then return 'Mã điều khiển không hợp lệ hoặc gói của trung tâm đã hết hạn.'; end if;
  c := sb_clock_now(s);
  if p_action = 'score' then
    if p_side = 'home' then update scoreboards set home_score = greatest(0, least(999, home_score + coalesce(p_arg, 0))) where id = s.id;
    elsif p_side = 'away' then update scoreboards set away_score = greatest(0, least(999, away_score + coalesce(p_arg, 0))) where id = s.id;
    else return 'Sai đội.'; end if;
  elsif p_action = 'start' then
    if c <= 0 then return 'Hết giờ hiệp này.'; end if;
    update scoreboards set clock_running = true, clock_remaining = c, clock_started_at = now() where id = s.id;
  elsif p_action = 'stop' then
    update scoreboards set clock_running = false, clock_remaining = c, clock_started_at = null where id = s.id;
  elsif p_action = 'set_clock' then
    update scoreboards set clock_remaining = greatest(0, least(coalesce(p_arg, 0), 5999)),
      clock_started_at = case when clock_running then now() else null end where id = s.id;
  elsif p_action = 'period' then
    v := greatest(1, least(coalesce(p_arg, 1), 12));
    update scoreboards set period = v, clock_running = false, clock_started_at = null,
      clock_remaining = case when v <= 4 then period_len else least(period_len, 300) end where id = s.id;
  elsif p_action = 'reset' then
    update scoreboards set home_score = 0, away_score = 0, period = 1, clock_running = false, clock_started_at = null, clock_remaining = period_len where id = s.id;
  else return 'Lệnh không hợp lệ.'; end if;
  return 'ok';
end $$;

grant execute on function sb_state(text), sb_act(text, text, int, text) to anon, authenticated;

-- Logo đội (ảnh nhỏ lưu dạng data URL, app tự thu nhỏ trước khi lưu) và màu áo.
alter table scoreboards add column if not exists home_color text not null default '#bedf00';
alter table scoreboards add column if not exists away_color text not null default '#9aa0ff';
alter table scoreboards add column if not exists home_logo text;
alter table scoreboards add column if not exists away_logo text;
alter table scoreboards drop constraint if exists scoreboards_style_check;
alter table scoreboards add constraint scoreboards_style_check check (
  home_color ~ '^#[0-9a-fA-F]{6}$' and away_color ~ '^#[0-9a-fA-F]{6}$'
  and coalesce(length(home_logo), 0) < 200000 and coalesce(length(away_logo), 0) < 200000);

create or replace function sb_state(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare s scoreboards; c real;
begin
  select * into s from scoreboards where (control_token = p_token or view_token = p_token) and org_active(org_id);
  if s.id is null then return jsonb_build_object('error', 'Mã không hợp lệ hoặc gói của trung tâm đã hết hạn.'); end if;
  c := sb_clock_now(s);
  return jsonb_build_object('name', s.name, 'league', s.league, 'home', s.home_name, 'away', s.away_name,
    'score', jsonb_build_object('home', s.home_score, 'away', s.away_score),
    'period', s.period, 'periodLen', s.period_len, 'clock', c, 'running', s.clock_running and c > 0,
    'homeColor', s.home_color, 'awayColor', s.away_color,
    'homeLogoV', coalesce(md5(s.home_logo), ''), 'awayLogoV', coalesce(md5(s.away_logo), ''),
    'canControl', s.control_token = p_token);
end $$;

-- Logo 2 đội (nặng hơn nên tách riêng: app chỉ tải khi logo đổi).
create or replace function sb_logos(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare s scoreboards;
begin
  select * into s from scoreboards where (control_token = p_token or view_token = p_token) and org_active(org_id);
  if s.id is null then return jsonb_build_object('home', null, 'away', null); end if;
  return jsonb_build_object('home', s.home_logo, 'away', s.away_logo);
end $$;
grant execute on function sb_state(text), sb_logos(text) to anon, authenticated;

-- Live Stats mở rộng: cờ "trong sơn" / "fast break" cho cú ném, timeout của đội (TMO, không gắn cầu thủ).
-- Pha không gắn cầu thủ (game_player_id null) = pha của TEAM: team rebound, team turnover, timeout.
alter table stat_events add column if not exists paint boolean not null default false;
alter table stat_events add column if not exists fast_break boolean not null default false;
alter table stat_events drop constraint if exists stat_events_type_check;
alter table stat_events add constraint stat_events_type_check check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS','PFT','PFU','PFD','TMO'));

-- ===== Live Stats mở rộng 2: loại lỗi (T/U/D), người bị phạm lỗi, kiến tạo gắn với cú ghi điểm, vị trí ném =====
-- PFT = lỗi kỹ thuật (gắn cầu thủ; không gắn cầu thủ = lỗi kỹ thuật HLV/ghế), PFU = lỗi phản tinh thần thể thao, PFD = lỗi truất quyền.
alter table stat_events add column if not exists drawn_by uuid references game_players on delete set null; -- người bị phạm lỗi
alter table stat_events add column if not exists linked_id uuid;                                         -- AST → cú ghi điểm được kiến tạo
alter table stat_events add column if not exists shot_x real;                                            -- vị trí ném trên nửa sân (0..1)
alter table stat_events add column if not exists shot_y real;
alter table stat_events drop constraint if exists stat_events_type_check;
alter table stat_events add constraint stat_events_type_check check (type in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS','PFT','PFU','PFD','TMO'));

-- Bảng bấm điện thoại: thêm lỗi đồng đội (Q4 + hiệp phụ cộng dồn) và timeout đã dùng / được phép.
create or replace function remote_state(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare gid uuid; g games; res jsonb; cp int;
begin
  gid := remote_game_of(p_token);
  if gid is null then return jsonb_build_object('error', 'Mã QR không hợp lệ hoặc đã hết hạn.'); end if;
  select * into g from games where id = gid;
  cp := coalesce(g.clock_period, 1);
  with ev as (select * from stat_events where game_id = gid),
       last_in as (select distinct on (game_player_id) game_player_id, kind from lineup_events where game_id = gid order by game_player_id, created_at desc),
       tf as (select side, count(*) n from ev where game_player_id is not null and type in ('PF','PFS','PFT','PFU','PFD')
              and (case when cp >= 4 then period >= 4 else period = cp end) group by side),
       tmo as (select side, count(*) n from ev where type = 'TMO'
              and (case when cp <= 2 then period <= 2 when cp <= 4 then period between 3 and 4 else period = cp end) group by side)
  select jsonb_build_object(
    'game', jsonb_build_object('title', g.title, 'home', coalesce(nullif(g.home_name, ''), (select name from squads where id = g.squad_id)), 'away', coalesce(nullif(g.away_name, ''), 'AWAY'),
      'period', g.clock_period, 'clock', game_clock_now(g), 'running', g.clock_running),
    'score', jsonb_build_object(
      'home', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where side = 'home'),
      'away', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where side = 'away')),
    'fouls', jsonb_build_object('home', coalesce((select n from tf where side = 'home'), 0), 'away', coalesce((select n from tf where side = 'away'), 0)),
    'timeouts', jsonb_build_object('home', coalesce((select n from tmo where side = 'home'), 0), 'away', coalesce((select n from tmo where side = 'away'), 0),
      'max', case when cp <= 2 then 2 when cp <= 4 then 3 else 1 end),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'side', p.side, 'number', p.number, 'name', p.name,
        'on', coalesce((select kind = 'in' from last_in li where li.game_player_id = p.id), false),
        'pts', (select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end), 0) from ev where ev.game_player_id = p.id),
        'pf', (select count(*) from ev where ev.game_player_id = p.id and type in ('PF','PFS','PFT','PFU','PFD'))) order by p.side, p.number)
      from game_players p where p.game_id = gid), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('id', e.id, 'type', e.type, 'side', e.side, 'number', p.number, 'name', p.name, 'remote', e.via_remote, 'at', e.created_at,
          'paint', e.paint, 'fb', e.fast_break) x
        from ev e left join game_players p on p.id = e.game_player_id order by e.created_at desc limit 8) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- Ghi pha từ điện thoại (bản mở rộng): p_player null = pha của TEAM (OREB, DREB, TOV) hoặc timeout (TMO, tự dừng đồng hồ).
create or replace function remote_add_event(p_token text, p_player uuid, p_type text, p_side text default null,
                                            p_paint boolean default false, p_fb boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games; ps text; c real;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  if p_player is not null then
    select side into ps from game_players where id = p_player and game_id = gid;
    if ps is null then return 'Cầu thủ không thuộc trận này.'; end if;
    if p_type not in ('2PM','2PX','3PM','3PX','FTM','FTX','OREB','DREB','AST','STL','BLK','TOV','PF','PFS','PFT','PFU','PFD') then return 'Loại pha không hợp lệ.'; end if;
  else
    ps := p_side;
    if ps not in ('home','away') then return 'Thiếu đội.'; end if;
    if p_type not in ('OREB','DREB','TOV','TMO') then return 'TEAM chỉ ghi được OREB, DREB, TOV, timeout.'; end if;
  end if;
  select * into g from games where id = gid for update;
  c := game_clock_now(g);
  if p_type = 'TMO' and g.clock_running then
    update games set clock_running = false, clock_remaining = c, clock_started_at = null where id = gid;
  end if;
  insert into stat_events (game_id, side, game_player_id, type, period, clock_s, via_remote, author, paint, fast_break)
    values (gid, ps, p_player, p_type, g.clock_period, c, true, null,
            coalesce(p_paint, false) and p_type in ('2PM','2PX'), coalesce(p_fb, false) and p_type in ('2PM','2PX','3PM','3PX'));
  return 'ok';
end $$;
grant execute on function remote_state(text), remote_add_event(text, uuid, text, text, boolean, boolean) to anon, authenticated;

-- ===== TO: tự mất bóng / bị steal =====
-- tov_kind: 'self' = tự mất bóng, 'stolen' = bị cướp bóng (linked_id trỏ tới pha STL của đối thủ nếu biết ai cướp). Trống = chưa rõ (app tự ghép với STL gần đó).
alter table stat_events add column if not exists tov_kind text;
alter table stat_events drop constraint if exists stat_events_tov_kind_check;
alter table stat_events add constraint stat_events_tov_kind_check check (tov_kind in ('self', 'stolen'));

-- ===== Bản lưu của trận (khôi phục khi bị bấm nhầm / xoá nhầm) =====
-- Một bản lưu = toàn bộ cầu thủ, pha thống kê và thay người của trận tại một thời điểm. Tự lưu trước khi có thay đổi,
-- cách nhau tối thiểu 5 phút (giữ 60 bản tự động gần nhất), hoặc lưu tay bất kỳ lúc nào.
create table if not exists game_snapshots (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  kind text not null default 'auto' check (kind in ('auto', 'manual', 'restore')),
  label text not null default '',
  summary jsonb not null default '{}',
  data jsonb not null,
  author uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists game_snapshots_game_idx on game_snapshots (game_id, created_at desc);
alter table game_snapshots enable row level security;
drop policy if exists game_snapshots_read on game_snapshots;
create policy game_snapshots_read on game_snapshots for select to authenticated using (is_member(squad_of_game(game_id)));

create or replace function game_snapshot_create(p_game uuid, p_kind text, p_label text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; np int; ns int; nl int; sh int; sa int;
begin
  if not exists (select 1 from games where id = p_game) then return null; end if;
  select count(*) into np from game_players where game_id = p_game;
  select count(*) into ns from stat_events where game_id = p_game;
  select count(*) into nl from lineup_events where game_id = p_game;
  if p_kind = 'auto' and np + ns + nl = 0 then return null; end if;
  select coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end) filter (where side = 'home'), 0),
         coalesce(sum(case type when '2PM' then 2 when '3PM' then 3 when 'FTM' then 1 else 0 end) filter (where side = 'away'), 0)
    into sh, sa from stat_events where game_id = p_game;
  insert into game_snapshots (game_id, kind, label, summary, data)
  values (p_game, p_kind, coalesce(p_label, ''),
    jsonb_build_object('home', sh, 'away', sa, 'players', np, 'stats', ns, 'lineups', nl),
    jsonb_build_object(
      'game', (select to_jsonb(g) from games g where g.id = p_game),
      'players', coalesce((select jsonb_agg(to_jsonb(x)) from game_players x where x.game_id = p_game), '[]'::jsonb),
      'stats', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from stat_events x where x.game_id = p_game), '[]'::jsonb),
      'lineups', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from lineup_events x where x.game_id = p_game), '[]'::jsonb)))
  returning id into sid;
  delete from game_snapshots where game_id = p_game and kind = 'auto'
    and id not in (select id from game_snapshots where game_id = p_game and kind = 'auto' order by created_at desc limit 60);
  return sid;
end $$;
revoke execute on function game_snapshot_create(uuid, text, text) from public, anon, authenticated;

-- Tự lưu trước khi có thay đổi nếu bản lưu gần nhất đã quá 5 phút.
create or replace function game_snapshot_auto() returns trigger
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  gid := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  if not exists (select 1 from game_snapshots where game_id = gid and created_at > now() - interval '5 minutes') then
    perform game_snapshot_create(gid, 'auto', 'Tự động');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function game_snapshot_auto() from public, anon, authenticated;
drop trigger if exists stat_events_snap on stat_events;
drop trigger if exists lineup_events_snap on lineup_events;
drop trigger if exists game_players_snap on game_players;
create trigger stat_events_snap before insert or update or delete on stat_events for each row execute function game_snapshot_auto();
create trigger lineup_events_snap before insert or update or delete on lineup_events for each row execute function game_snapshot_auto();
create trigger game_players_snap before insert or update or delete on game_players for each row execute function game_snapshot_auto();

-- Lưu tay một bản.
create or replace function game_snapshot_save(p_game uuid, p_label text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_editor(squad_of_game(p_game)) then return 'Bạn không có quyền lưu bản cho trận này.'; end if;
  perform game_snapshot_create(p_game, 'manual', nullif(trim(p_label), ''));
  return 'ok';
end $$;

-- Khôi phục trận về một bản lưu. Trạng thái hiện tại được lưu lại thành một bản "Trước khi khôi phục" nên có thể hoàn lại.
create or replace function game_snapshot_restore(p_snapshot uuid) returns text
language plpgsql security definer set search_path = public as $$
declare s game_snapshots;
begin
  select * into s from game_snapshots where id = p_snapshot;
  if s.id is null then return 'Không tìm thấy bản lưu này.'; end if;
  if not is_editor(squad_of_game(s.game_id)) then return 'Bạn không có quyền khôi phục trận này.'; end if;
  perform game_snapshot_create(s.game_id, 'restore', 'Trước khi khôi phục');
  delete from stat_events where game_id = s.game_id;
  delete from lineup_events where game_id = s.game_id;
  delete from game_players where game_id = s.game_id;
  insert into game_players
    select * from jsonb_populate_recordset(null::game_players, coalesce((
      select jsonb_agg(case when exists (select 1 from players p where p.id = nullif(e->>'player_id', '')::uuid) then e else e - 'player_id' end)
      from jsonb_array_elements(s.data->'players') e), '[]'::jsonb));
  insert into stat_events
    select * from jsonb_populate_recordset(null::stat_events, coalesce((
      select jsonb_agg((case when exists (select 1 from game_videos v where v.id = nullif(e->>'video_id', '')::uuid) then e else e - 'video_id' end) - 'author')
      from jsonb_array_elements(s.data->'stats') e), '[]'::jsonb));
  insert into lineup_events
    select * from jsonb_populate_recordset(null::lineup_events, coalesce((
      select jsonb_agg(e - 'author') from jsonb_array_elements(s.data->'lineups') e), '[]'::jsonb));
  update games set home_name = s.data->'game'->>'home_name', away_name = s.data->'game'->>'away_name',
    period_len = coalesce((s.data->'game'->>'period_len')::int, period_len) where id = s.game_id;
  return 'ok';
end $$;
grant execute on function game_snapshot_save(uuid, text), game_snapshot_restore(uuid) to authenticated;

-- ===== Giải JET (riêng Junsport, bật bằng orgs.jet_enabled trong "Quản lý trung tâm") =====
-- Mỗi đội giải JET là một "tuyến" (squads) có league = PRO.JET | JET | JR.JET | WJET. Cầu thủ nằm trong bảng players như mọi tuyến.
-- Nhân sự của trung tâm (chủ trung tâm, HLV) xem và sửa được MỌI đội JET của trung tâm đó, để người bấm stats chọn đội nào cũng có sẵn danh sách.
alter table orgs add column if not exists jet_enabled boolean not null default false;
alter table squads add column if not exists league text;
alter table squads add column if not exists season text not null default '';
alter table squads add column if not exists coach text not null default '';
alter table squads drop constraint if exists squads_league_check;
alter table squads add constraint squads_league_check check (league is null or league in ('PRO.JET', 'JET', 'JR.JET', 'WJET'));

create or replace function is_jet_squad(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from squads s join orgs o on o.id = s.org_id where s.id = sid and s.league is not null and o.jet_enabled)
$$;
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super()
      or exists (select 1 from members where squad_id = sid and user_id = auth.uid())
      or is_org_owner(org_of_squad(sid))
      or (is_jet_squad(sid) and is_org_member(org_of_squad(sid)))
$$;
create or replace function is_editor(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or (
    (exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role in ('admin','coach'))
       or is_org_owner(org_of_squad(sid))
       or (is_jet_squad(sid) and exists (select 1 from org_members where org_id = org_of_squad(sid) and user_id = auth.uid() and role in ('owner', 'coach'))))
    and org_active(org_of_squad(sid)))
$$;

-- Tạo đội JET (nếu đã có đội cùng giải, mùa, tên thì trả về đội đó).
create or replace function jet_team_create(p_org uuid, p_league text, p_season text, p_name text, p_coach text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not exists (select 1 from orgs where id = p_org and jet_enabled) then raise exception 'Trung tâm này chưa bật Giải JET.'; end if;
  if not (is_super() or exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role in ('owner', 'coach'))) then
    raise exception 'Chỉ chủ trung tâm hoặc HLV mới tạo được đội JET.';
  end if;
  if not (org_active(p_org) or is_super()) then raise exception 'Gói của trung tâm đã hết hạn. Liên hệ để gia hạn.'; end if;
  if p_league not in ('PRO.JET', 'JET', 'JR.JET', 'WJET') then raise exception 'Mã giải không hợp lệ.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên đội.'; end if;
  select id into sid from squads where org_id = p_org and league = p_league and season = coalesce(p_season, '') and lower(name) = lower(trim(p_name));
  if sid is not null then return sid; end if;
  insert into squads (name, org_id, league, season, coach) values (trim(p_name), p_org, p_league, coalesce(p_season, ''), coalesce(trim(p_coach), '')) returning id into sid;
  insert into members (squad_id, user_id, role) values (sid, auth.uid(), 'admin') on conflict do nothing;
  return sid;
end $$;

create or replace function jet_team_update(p_squad uuid, p_name text, p_coach text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_jet_squad(p_squad) and is_editor(p_squad)) then raise exception 'Bạn không có quyền sửa đội này.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên đội.'; end if;
  update squads set name = trim(p_name), coach = coalesce(trim(p_coach), '') where id = p_squad;
end $$;

-- Xoá đội JET: chỉ khi đội chưa có trận nào (tránh mất thống kê).
create or replace function jet_team_delete(p_squad uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_jet_squad(p_squad) and is_editor(p_squad)) then raise exception 'Bạn không có quyền xoá đội này.'; end if;
  if exists (select 1 from games where squad_id = p_squad) then raise exception 'Đội này đã có trận đấu nên không xoá được.'; end if;
  delete from squads where id = p_squad;
end $$;
grant execute on function jet_team_create(uuid, text, text, text, text), jet_team_update(uuid, text, text), jet_team_delete(uuid) to authenticated;
revoke execute on function jet_team_create(uuid, text, text, text, text), jet_team_update(uuid, text, text), jet_team_delete(uuid) from anon;

-- Đội JET: số áo không có mặc định (mỗi trận một số), và trận JET nhớ đội khách để nạp danh sách.
alter table players alter column number drop not null;
-- Đội JET đã nhập trước đó có số áo tạm: bỏ đi (số áo nay nhập theo từng trận).
update players set number = null where squad_id in (select id from squads where league is not null);
alter table games add column if not exists away_squad_id uuid references squads on delete set null;

-- Giải JET chỉ dành cho Junsport: tự bật cho trung tâm có tên Junsport.
update orgs set jet_enabled = true where name ilike '%junsport%' and not jet_enabled;

-- ================= Vai trò Giải JET: Trọng tài JET (jet_ref) và HLV JET (jet_coach) =================
-- Trọng tài JET: mọi quyền trong Giải JET (đội, trận, stats, biên bản), không thấy tuyến thường.
-- HLV JET: chỉ vào được đội JET được giao (bảng members), không thấy đội khác.
-- Vai trò 'coach' / 'viewer' thường không còn vào được Giải JET.
-- Gỡ mọi ràng buộc kiểm tra vai trò cũ (dù tên là gì) rồi đặt lại với danh sách vai trò mới.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.org_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table org_members drop constraint %I', c.conname);
  end loop;
end $$;
alter table org_members add constraint org_members_role_check check (role in ('owner','coach','viewer','jet_ref','jet_coach'));

create or replace function jet_manager(oid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or exists (select 1 from org_members where org_id = oid and user_id = auth.uid() and role in ('owner', 'jet_ref'))
$$;
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super()
      or exists (select 1 from members where squad_id = sid and user_id = auth.uid())
      or is_org_owner(org_of_squad(sid))
      or (is_jet_squad(sid) and exists (select 1 from org_members where org_id = org_of_squad(sid) and user_id = auth.uid() and role = 'jet_ref'))
$$;
create or replace function is_editor(sid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select is_super() or (
    (exists (select 1 from members where squad_id = sid and user_id = auth.uid() and role in ('admin','coach'))
       or is_org_owner(org_of_squad(sid))
       or (is_jet_squad(sid) and exists (select 1 from org_members where org_id = org_of_squad(sid) and user_id = auth.uid() and role = 'jet_ref')))
    and org_active(org_of_squad(sid)))
$$;

create or replace function add_org_member(p_org uuid, p_email text, p_role text default 'coach') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_org_owner(p_org) then raise exception 'Chỉ chủ trung tâm mới thêm được thành viên.'; end if;
  if p_role not in ('owner','coach','viewer','jet_ref','jet_coach') then raise exception 'Vai trò không hợp lệ'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Chưa có tài khoản này. Hãy nhờ họ đăng ký trước.'; end if;
  if exists (select 1 from org_members where user_id = uid and org_id <> p_org) then
    raise exception 'Tài khoản này đã thuộc một trung tâm khác. Mỗi HLV chỉ thuộc một trung tâm.';
  end if;
  insert into org_members (org_id, user_id, role) values (p_org, uid, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;
end $$;

create or replace function jet_team_create(p_org uuid, p_league text, p_season text, p_name text, p_coach text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not exists (select 1 from orgs where id = p_org and jet_enabled) then raise exception 'Trung tâm này chưa bật Giải JET.'; end if;
  if not jet_manager(p_org) then raise exception 'Chỉ chủ trung tâm hoặc Trọng tài JET mới tạo được đội JET.'; end if;
  if not (org_active(p_org) or is_super()) then raise exception 'Gói của trung tâm đã hết hạn. Liên hệ để gia hạn.'; end if;
  if p_league not in ('PRO.JET', 'JET', 'JR.JET', 'WJET') then raise exception 'Mã giải không hợp lệ.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên đội.'; end if;
  select id into sid from squads where org_id = p_org and league = p_league and season = coalesce(p_season, '') and lower(name) = lower(trim(p_name));
  if sid is not null then return sid; end if;
  insert into squads (name, org_id, league, season, coach) values (trim(p_name), p_org, p_league, coalesce(p_season, ''), coalesce(trim(p_coach), '')) returning id into sid;
  insert into members (squad_id, user_id, role) values (sid, auth.uid(), 'admin') on conflict do nothing;
  return sid;
end $$;
create or replace function jet_team_update(p_squad uuid, p_name text, p_coach text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_jet_squad(p_squad) and jet_manager(org_of_squad(p_squad)) and org_active(org_of_squad(p_squad))) then raise exception 'Bạn không có quyền sửa đội này.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nhập tên đội.'; end if;
  update squads set name = trim(p_name), coach = coalesce(trim(p_coach), '') where id = p_squad;
end $$;
create or replace function jet_team_delete(p_squad uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_jet_squad(p_squad) and jet_manager(org_of_squad(p_squad)) and org_active(org_of_squad(p_squad))) then raise exception 'Bạn không có quyền xoá đội này.'; end if;
  if exists (select 1 from games where squad_id = p_squad) then raise exception 'Đội này đã có trận đấu nên không xoá được.'; end if;
  delete from squads where id = p_squad;
end $$;

-- Giao / gỡ HLV JET (tài khoản có vai trò jet_coach) cho một đội: HLV chỉ thấy đội được giao.
create or replace function jet_team_assign(p_squad uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_jet_squad(p_squad) and jet_manager(org_of_squad(p_squad)) and org_active(org_of_squad(p_squad))) then raise exception 'Bạn không có quyền giao HLV cho đội này.'; end if;
  if not exists (select 1 from org_members where org_id = org_of_squad(p_squad) and user_id = p_user and role = 'jet_coach') then
    raise exception 'Tài khoản này không phải HLV JET của trung tâm.';
  end if;
  if p_on then
    insert into members (squad_id, user_id, role) values (p_squad, p_user, 'coach') on conflict (squad_id, user_id) do update set role = 'coach';
  else
    delete from members where squad_id = p_squad and user_id = p_user;
  end if;
end $$;
grant execute on function jet_team_create(uuid, text, text, text, text), jet_team_update(uuid, text, text), jet_team_delete(uuid), jet_team_assign(uuid, uuid, boolean) to authenticated;
revoke execute on function jet_team_create(uuid, text, text, text, text), jet_team_update(uuid, text, text), jet_team_delete(uuid), jet_team_assign(uuid, uuid, boolean) from anon;

-- Tuyến cũ có chữ JET trong tên (vd "Pro.Jet") thuộc Giải JET: gán giải để Trọng tài / HLV JET thấy các trận đã bấm stats.
update squads s set league = case
    when s.name ~* 'pro\.?\s?-?jet' then 'PRO.JET'
    when s.name ~* 'jr\.?\s?-?jet' then 'JR.JET'
    when s.name ~* 'w\.?\s?-?jet' then 'WJET'
    else 'JET' end
  where s.league is null and s.name ~* 'jet'
    and exists (select 1 from orgs o where o.id = s.org_id and o.jet_enabled);

-- Tuyến cũ có chữ JET (không phải đội giải) bị ẩn khỏi danh sách đội. Mặc định mọi đội đều hiện.
alter table squads add column if not exists jet_legacy boolean not null default false;
update squads set jet_legacy = true
  where league is not null and name ~* 'jet' and season = '' and coach = '' and not jet_legacy;

-- Biên bản điện tử: pha do bàn thư ký ghi, chờ người bấm stats bổ sung.
alter table stat_events add column if not exists pending boolean not null default false;

-- Hàng đợi ném phạt lưu theo trận: lỗi chưa ném phạt (ft_open) và số quả phải ném (ft_count). Các quả phạt đã ném nối với lỗi qua linked_id.
alter table stat_events add column if not exists ft_open boolean not null default false;
alter table stat_events add column if not exists ft_count int;

-- ================= Điện thoại máy quay: đồng hồ, thay người, +điểm, mốc bắt đầu trận =================
-- Dùng chung mã QR (remote_tokens) với bảng bấm stats nhưng chỉ làm được 4 việc này. Link riêng: #cam=<token>.
-- start_marked_at: giờ thật lúc máy quay bấm "Đánh dấu bắt đầu trận" (khi đồng hồ đang chạy); start_mark_clock: giây còn lại lúc đó.
alter table games add column if not exists start_marked_at timestamptz;
alter table games add column if not exists start_mark_clock real;

create or replace function cam_state(p_token text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare gid uuid; g games;
begin
  gid := remote_game_of(p_token);
  if gid is null then return jsonb_build_object('error', 'Mã QR không hợp lệ hoặc đã hết hạn.'); end if;
  select * into g from games where id = gid;
  return remote_state(p_token) || jsonb_build_object('period_len', g.period_len,
    'mark', jsonb_build_object('at', g.start_marked_at, 'clock', g.start_mark_clock));
end $$;

-- Đồng hồ: start | stop | adjust (p_secs, có thể âm) | next | prev (đổi hiệp, đồng hồ về đầu hiệp và dừng).
-- p_lag_ms: độ trễ mạng ước tính từ lúc bấm tới lúc máy chủ nhận (điện thoại tự đo); bù vào start / stop để giờ khớp lúc bấm thật.
drop function if exists cam_clock(text, text, int);
create or replace function cam_clock(p_token text, p_action text, p_secs int default 0, p_lag_ms int default 0) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games; c real; np int; plen real; lag real;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select * into g from games where id = gid for update;
  c := game_clock_now(g);
  plen := case when coalesce(g.clock_period, 1) <= 4 then g.period_len else 300 end;
  lag := greatest(0, least(coalesce(p_lag_ms, 0), 1500)) / 1000.0;
  if p_action = 'start' then
    if c <= 0 then return 'Hết giờ hiệp này.'; end if;
    update games set clock_running = true, clock_remaining = c, clock_started_at = now() - make_interval(secs => lag) where id = gid;
  elsif p_action = 'stop' then
    update games set clock_running = false, clock_remaining = least(plen, c + case when g.clock_running then lag else 0 end), clock_started_at = null where id = gid;
  elsif p_action = 'adjust' then
    update games set clock_remaining = least(plen, greatest(0, c + coalesce(p_secs, 0))),
                     clock_started_at = case when g.clock_running then now() else null end where id = gid;
  elsif p_action in ('next', 'prev') then
    np := greatest(1, coalesce(g.clock_period, 1) + case when p_action = 'next' then 1 else -1 end);
    update games set clock_period = np, clock_running = false, clock_started_at = null,
                     clock_remaining = case when np <= 4 then g.period_len else 300 end where id = gid;
  else
    return 'Thao tác không hợp lệ.';
  end if;
  return 'ok';
end $$;

-- Thay người: p_out ra sân, p_in vào sân (cùng đội). Chỉ có p_in = vào sân khi chưa đủ 5 người; chỉ có p_out = ra sân.
create or replace function cam_sub(p_token text, p_out uuid, p_in uuid) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games; c real; so text; si text; on_n int; is_on boolean;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  if p_out is null and p_in is null then return 'Chọn người ra hoặc người vào.'; end if;
  select * into g from games where id = gid for update;
  c := game_clock_now(g);
  if p_out is not null then
    select side into so from game_players where id = p_out and game_id = gid;
    if so is null then return 'Cầu thủ không thuộc trận này.'; end if;
    select coalesce((select kind = 'in' from lineup_events where game_player_id = p_out order by created_at desc limit 1), false) into is_on;
    if not is_on then return 'Người này đang không ở trên sân.'; end if;
  end if;
  if p_in is not null then
    select side into si from game_players where id = p_in and game_id = gid;
    if si is null then return 'Cầu thủ không thuộc trận này.'; end if;
    select coalesce((select kind = 'in' from lineup_events where game_player_id = p_in order by created_at desc limit 1), false) into is_on;
    if is_on then return 'Người này đang ở trên sân rồi.'; end if;
    if p_out is not null and so <> si then return 'Hai người phải cùng một đội.'; end if;
    if p_out is null then
      select count(*) into on_n from game_players gp where gp.game_id = gid and gp.side = si
        and coalesce((select kind = 'in' from lineup_events l where l.game_player_id = gp.id order by created_at desc limit 1), false);
      if on_n >= 5 then return 'Đã đủ 5 người trên sân: chọn người ra sân trước.'; end if;
    end if;
  end if;
  if p_out is not null then
    insert into lineup_events (game_id, side, game_player_id, kind, period, clock_s, author) values (gid, so, p_out, 'out', coalesce(g.clock_period, 1), c, null);
  end if;
  if p_in is not null then
    insert into lineup_events (game_id, side, game_player_id, kind, period, clock_s, author) values (gid, si, p_in, 'in', coalesce(g.clock_period, 1), c, null);
  end if;
  return 'ok';
end $$;

-- +điểm: p_pts = 1 (ném phạt), 2 hoặc 3. Pha 2 / 3 điểm chờ người bấm stats bổ sung vị trí và kiến tạo (pending).
create or replace function cam_score(p_token text, p_player uuid, p_pts int) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games; ps text; t text;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select side into ps from game_players where id = p_player and game_id = gid;
  if ps is null then return 'Cầu thủ không thuộc trận này.'; end if;
  t := case p_pts when 1 then 'FTM' when 2 then '2PM' when 3 then '3PM' else null end;
  if t is null then return 'Chỉ +1, +2 hoặc +3.'; end if;
  select * into g from games where id = gid for update;
  insert into stat_events (game_id, side, game_player_id, type, period, clock_s, via_remote, author, pending)
    values (gid, ps, p_player, t, coalesce(g.clock_period, 1), game_clock_now(g), true, null, p_pts in (2, 3));
  return 'ok';
end $$;

-- Đánh dấu bắt đầu trận (chỉ khi đồng hồ đang chạy) hoặc xoá dấu (p_on = false).
create or replace function cam_mark_start(p_token text, p_on boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; g games;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select * into g from games where id = gid for update;
  if not coalesce(p_on, true) then
    update games set start_marked_at = null, start_mark_clock = null where id = gid;
    return 'ok';
  end if;
  if not g.clock_running then return 'Hãy chạy đồng hồ rồi mới đánh dấu bắt đầu trận.'; end if;
  update games set start_marked_at = now(), start_mark_clock = game_clock_now(g) where id = gid;
  return 'ok';
end $$;

-- Hoàn tác thao tác gần nhất của máy quay (một pha +điểm, hoặc một lần thay người), trong 10 phút.
create or replace function cam_undo(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare gid uuid; se stat_events; le timestamptz;
begin
  gid := remote_game_of(p_token);
  if gid is null then return 'Mã QR không hợp lệ hoặc đã hết hạn.'; end if;
  select * into se from stat_events where game_id = gid and via_remote and type in ('FTM','2PM','3PM') and created_at > now() - interval '10 minutes' order by created_at desc limit 1;
  select max(created_at) into le from lineup_events where game_id = gid and author is null and created_at > now() - interval '10 minutes';
  if se.id is null and le is null then return 'Không có thao tác nào để hoàn tác.'; end if;
  if le is not null and (se.id is null or le > se.created_at) then
    delete from lineup_events where game_id = gid and author is null and created_at = le;
  else
    delete from stat_events where id = se.id;
  end if;
  return 'ok';
end $$;

grant execute on function cam_state(text), cam_clock(text, text, int, int), cam_sub(text, uuid, uuid), cam_score(text, uuid, int), cam_mark_start(text, boolean), cam_undo(text) to anon, authenticated;

notify pgrst, 'reload schema';
