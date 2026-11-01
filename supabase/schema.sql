-- Schema cho bản nhiều HLV / nhiều tuyến đội (Supabase / Postgres).
-- Chưa được app dùng: app hiện chạy chế độ demo bằng localStorage (src/store.ts).

create table squads   (id uuid primary key default gen_random_uuid(), name text not null);
create table members  (squad_id uuid references squads on delete cascade,
                       user_id uuid references auth.users on delete cascade,
                       role text not null default 'coach' check (role in ('admin','coach','viewer')),
                       primary key (squad_id, user_id));
create table players  (id uuid primary key default gen_random_uuid(),
                       squad_id uuid not null references squads on delete cascade,
                       number int not null, name text not null);
create table games    (id uuid primary key default gen_random_uuid(),
                       squad_id uuid not null references squads on delete cascade,
                       title text not null, played_on date, youtube_id text not null);
create table clips    (id uuid primary key default gen_random_uuid(),
                       game_id uuid not null references games on delete cascade,
                       start_s real not null, end_s real not null,
                       side text not null check (side in ('ATK','DEF')),
                       team_wide boolean not null default false,
                       play_type text, note text,
                       author uuid references auth.users);
create table clip_players (clip_id uuid references clips on delete cascade,
                           player_id uuid references players on delete cascade,
                           primary key (clip_id, player_id));
create table comments (id uuid primary key default gen_random_uuid(),
                       clip_id uuid not null references clips on delete cascade,
                       author uuid references auth.users, body text not null,
                       created_at timestamptz default now());

create index on clips (game_id, side);
create index on clip_players (player_id);
-- TODO: bật RLS: chỉ thành viên của squad (bảng members) mới đọc/ghi được.
