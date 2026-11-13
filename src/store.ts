import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Clip, Comment, Game, GamePlayer, GameVideo, LineupEvent, Org, OrgMember, Player, Playlist, Side, SpotBox, Squad, StatEvent, TeamSide } from './types'
import { toLoginEmail, uid } from './util'

/* ---------- Dữ liệu (Supabase) ---------- */
interface DataState {
  ready: boolean
  session: Session | null
  squads: Squad[]
  players: Player[]
  games: Game[]
  videos: GameVideo[]
  isSuper: boolean // quản trị hệ thống: xem được mọi trung tâm
  orgs: Org[]
  orgMembers: OrgMember[]
  baseLoaded: boolean
  clips: Clip[] // chỉ của trận đang mở
  comments: Comment[] // chỉ của trận đang mở
  playlists: Playlist[] // chỉ của trận đang mở
  gamePlayers: GamePlayer[] // cầu thủ 2 đội của trận đang mở
  stats: StatEvent[] // các pha thống kê của trận đang mở
  lineups: LineupEvent[] // vào / ra sân của trận đang mở
  profiles: Record<string, string>
  error: string
  init: () => void
  signIn: (login: string, password: string) => Promise<string | null>
  signUp: (login: string, password: string, name: string, joinCode?: string) => Promise<string | null>
  joinOrg: (code: string) => Promise<string | null>
  regenCode: (orgId: string) => Promise<string | null>
  signOut: () => Promise<void>
  loadBase: () => Promise<void>
  loadGame: (gameId: string | null) => Promise<void>
  addSquad: (name: string, orgId: string) => string
  createOrg: (name: string, ownerLogin: string, plan: string, maxSquads: number | null, expiresOn: string | null) => Promise<string | null>
  updateOrg: (id: string, patch: Partial<Org>) => Promise<string | null>
  addOrgMember: (orgId: string, login: string, role: string) => Promise<string | null>
  setOrgRole: (orgId: string, userId: string, role: string) => void
  removeOrgMember: (orgId: string, userId: string) => void
  addMember: (squadId: string, email: string, role: string) => Promise<string | null>
  addPlayer: (squadId: string, number: number, name: string) => void
  addPlayers: (squadId: string, list: { number: number; name: string }[]) => void
  removePlayer: (id: string) => void
  addGame: (g: Omit<Game, 'id'>, videos: { label: string; youtubeId: string }[]) => { gameId: string; videoId: string }
  removeGame: (id: string) => void
  addVideo: (gameId: string, label: string, youtubeId: string) => string
  removeVideo: (id: string) => void
  renameVideo: (id: string, label: string) => void
  addClip: (gameId: string, videoId: string, start: number, end: number, side: Side) => string
  updateClip: (id: string, patch: Partial<Clip>) => void
  removeClip: (id: string) => void
  addComment: (clipId: string, text: string) => void
  addPlaylist: (gameId: string, name: string, f: Filter) => string
  removePlaylist: (id: string) => void
  setTeamNames: (gameId: string, home: string, away: string) => void
  addGamePlayers: (gameId: string, side: TeamSide, list: { number: number; name: string; playerId?: string | null }[]) => void
  removeGamePlayer: (id: string) => void
  updateGamePlayer: (id: string, patch: { number?: number; name?: string }) => void
  addStat: (e: Omit<StatEvent, 'id' | 'createdAt'>) => string
  removeStat: (id: string) => void
  setStatVideo: (id: string, videoId: string, videoT: number) => void
  setClock: (gameId: string, patch: Partial<Pick<Game, 'periodLen' | 'clockPeriod' | 'clockRemaining' | 'clockRunning' | 'clockStartedAt'>>) => void
  addLineup: (e: Omit<LineupEvent, 'id' | 'createdAt'>) => void
  removeLineup: (id: string) => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pending = new Map<string, Partial<Clip>>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let reloadTimer: ReturnType<typeof setTimeout> | undefined
let autoJoinTried = false

export const useData = create<DataState>((set, get) => {
  const fail = (e: { message: string } | null) => {
    if (e) {
      console.error(e)
      set({ error: /row-level security/i.test(e.message)
        ? 'Tài khoản này chỉ được XEM ở tuyến đội này, không được sửa. Nhờ admin tuyến mời bạn với vai trò coach.'
        : e.message })
    }
    return !!e
  }
  const reloadSoon = () => {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      if (pending.size) return reloadSoon() // đang gõ dở: chờ ghi xong
      get().loadBase()
      get().loadGame(useUi.getState().gameId)
    }, 300)
  }

  const flushClip = async (id: string) => {
    const patch = pending.get(id)
    pending.delete(id); timers.delete(id)
    if (!patch) return
    const row: Record<string, unknown> = {}
    if (patch.start !== undefined) row.start_s = patch.start
    if (patch.end !== undefined) row.end_s = patch.end
    if (patch.side !== undefined) row.side = patch.side
    if (patch.teamWide !== undefined) row.team_wide = patch.teamWide
    if (patch.playType !== undefined) row.play_type = patch.playType
    if (patch.note !== undefined) row.note = patch.note
    if (patch.spotlight !== undefined) row.spotlight = patch.spotlight
    if (Object.keys(row).length && fail((await supabase.from('clips').update(row).eq('id', id)).error)) return
    if (patch.playerIds) {
      if (fail((await supabase.from('clip_players').delete().eq('clip_id', id)).error)) return
      if (patch.playerIds.length)
        fail((await supabase.from('clip_players').insert(patch.playerIds.map((player_id) => ({ clip_id: id, player_id })))).error)
    }
  }

  return {
    ready: false,
    session: null,
    squads: [], players: [], games: [], videos: [], isSuper: false, orgs: [], orgMembers: [], baseLoaded: false, clips: [], comments: [], playlists: [], gamePlayers: [], stats: [], lineups: [],
    profiles: {},
    error: '',

    init: () => {
      supabase.auth.getSession().then(({ data }) => {
        set({ session: data.session, ready: true })
        if (data.session) get().loadBase()
      })
      supabase.auth.onAuthStateChange((_e, session) => {
        set({ session })
        if (session) get().loadBase()
        else set({ squads: [], players: [], games: [], videos: [], isSuper: false, orgs: [], orgMembers: [], baseLoaded: false, clips: [], comments: [], playlists: [] })
      })
      supabase
        .channel('gamereview')
        .on('postgres_changes', { event: '*', schema: 'public' }, reloadSoon)
        .subscribe()
    },

    signIn: async (login, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(login), password })
      return error?.message ?? null
    },
    signUp: async (login, password, name, joinCode) => {
      const code = joinCode?.trim() || undefined
      const { data, error } = await supabase.auth.signUp({
        email: toLoginEmail(login), password,
        // Lưu mã vào hồ sơ để tự vào trung tâm khi đăng nhập lần đầu (kể cả khi cần xác nhận email).
        options: { data: { name: name || login.split('@')[0], ...(code ? { join_code: code } : {}) } },
      })
      if (error) return error.message
      if (!data.session) return 'Đã gửi email xác nhận. Hãy bấm link trong email rồi đăng nhập.'
      if (code) {
        autoJoinTried = true // tránh tự vào lần nữa khi tải dữ liệu
        const err = await get().joinOrg(code)
        if (err) return `Đã tạo tài khoản, nhưng chưa vào được trung tâm: ${err}`
      }
      return null
    },
    joinOrg: async (code) => {
      const { data, error } = await supabase.rpc('join_org_by_code', { p_code: code.trim() })
      if (error) return error.message
      const msg: Record<string, string | null> = {
        ok: null,
        already: 'Tài khoản này đã thuộc một trung tâm.',
        bad_code: 'Mã trung tâm không đúng. Hãy hỏi lại chủ trung tâm.',
        too_many: 'Nhập sai quá nhiều lần. Hãy thử lại sau 1 giờ.',
        auth: 'Bạn cần đăng nhập trước.',
      }
      const res = msg[data as string] ?? 'Không vào được trung tâm.'
      if (!res) await get().loadBase()
      return res
    },
    regenCode: async (orgId) => {
      const { error } = await supabase.rpc('regen_join_code', { p_org: orgId })
      if (!error) await get().loadBase()
      return error?.message ?? null
    },
    signOut: async () => { await supabase.auth.signOut() },

    loadBase: async () => {
      const uidNow = get().session?.user.id
      const [sq, pl, ga, pr, gv, ad, og, om] = await Promise.all([
        supabase.from('squads').select('*').order('created_at'),
        supabase.from('players').select('*'),
        supabase.from('games').select('*').order('played_on', { ascending: false }),
        supabase.from('profiles').select('*'),
        supabase.from('game_videos').select('*').order('position'),
        uidNow ? supabase.from('app_admins').select('user_id').eq('user_id', uidNow) : Promise.resolve({ data: [], error: null }),
        supabase.from('orgs').select('*').order('name'),
        supabase.from('org_members').select('*'),
      ])
      if ([sq, pl, ga, pr, gv, ad, og, om].some((r) => fail(r.error))) return
      set({
        squads: (sq.data ?? []).map((r: any) => ({ id: r.id, name: r.name, orgId: r.org_id })),
        orgs: (og.data ?? []).map((r: any) => ({ id: r.id, name: r.name, plan: r.plan, maxSquads: r.max_squads, expiresOn: r.expires_on, joinCode: r.join_code ?? '' })),
        orgMembers: (om.data ?? []).map((r: any) => ({ orgId: r.org_id, userId: r.user_id, role: r.role })),
        baseLoaded: true,
        players: (pl.data ?? []).map((r: any) => ({ id: r.id, squadId: r.squad_id, number: r.number, name: r.name })),
        games: (ga.data ?? []).map((r: any) => ({ id: r.id, squadId: r.squad_id, title: r.title, date: r.played_on ?? '', homeName: r.home_name ?? '', awayName: r.away_name ?? '',
          periodLen: r.period_len ?? 600, clockPeriod: r.clock_period ?? 1, clockRemaining: r.clock_remaining ?? null,
          clockRunning: !!r.clock_running, clockStartedAt: r.clock_started_at ? new Date(r.clock_started_at).getTime() : null })),
        videos: (gv.data ?? []).map((r: any) => ({ id: r.id, gameId: r.game_id, label: r.label, youtubeId: r.youtube_id, position: r.position })),
        isSuper: (ad.data ?? []).length > 0,
        profiles: Object.fromEntries((pr.data ?? []).map((r: any) => [r.id, r.name])),
      })
      const st = get(), me = st.session?.user
      const pendingCode = me?.user_metadata?.join_code as string | undefined
      if (me && pendingCode && !st.isSuper && !st.orgMembers.some((m) => m.userId === me.id) && !autoJoinTried) {
        autoJoinTried = true
        const err = await get().joinOrg(pendingCode)
        if (err && !err.startsWith('Tài khoản này đã thuộc')) set({ error: err })
      }
    },

    loadGame: async (gameId) => {
      if (!gameId) return set({ clips: [], comments: [], playlists: [], gamePlayers: [], stats: [], lineups: [] })
      const { data: cl, error } = await supabase
        .from('clips').select('*, clip_players(player_id)').eq('game_id', gameId).limit(5000)
      if (fail(error)) return
      const clipIds = (cl ?? []).map((c: any) => c.id)
      const { data: cm, error: e2 } = clipIds.length
        ? await supabase.from('comments').select('*').in('clip_id', clipIds).order('created_at')
        : { data: [], error: null }
      if (fail(e2)) return
      // Giữ lại thay đổi cục bộ chưa ghi xong.
      const clips: Clip[] = (cl ?? []).map((r: any) => ({
        id: r.id, gameId: r.game_id, videoId: r.video_id ?? '', start: r.start_s, end: r.end_s, side: r.side,
        teamWide: r.team_wide, playerIds: r.clip_players.map((x: any) => x.player_id),
        playType: r.play_type ?? '', note: r.note ?? '', author: r.author ?? '', spotlight: r.spotlight ?? null,
        ...pending.get(r.id),
      }))
      const [plr, gpr, ser, ler] = await Promise.all([
        supabase.from('playlists').select('*').eq('game_id', gameId).order('created_at'),
        supabase.from('game_players').select('*').eq('game_id', gameId),
        supabase.from('stat_events').select('*').eq('game_id', gameId).order('created_at').limit(10000),
        supabase.from('lineup_events').select('*').eq('game_id', gameId).order('created_at').limit(5000),
      ])
      if (fail(plr.error) || fail(gpr.error) || fail(ser.error) || fail(ler.error)) return
      const pl = plr.data
      set({
        gamePlayers: (gpr.data ?? []).map((r: any) => ({ id: r.id, gameId: r.game_id, side: r.side, number: r.number, name: r.name, playerId: r.player_id ?? null })),
        stats: (ser.data ?? []).map((r: any) => ({
          id: r.id, gameId: r.game_id, side: r.side, gamePlayerId: r.game_player_id ?? null, type: r.type, period: r.period,
          videoId: r.video_id ?? null, videoT: r.video_t ?? null, clockS: r.clock_s ?? null, viaRemote: !!r.via_remote, createdAt: new Date(r.created_at).getTime(),
        })),
        lineups: (ler.data ?? []).map((r: any) => ({
          id: r.id, gameId: r.game_id, side: r.side, gamePlayerId: r.game_player_id, kind: r.kind, period: r.period, clockS: r.clock_s,
          createdAt: new Date(r.created_at).getTime(),
        })),
        playlists: (pl ?? []).map((r: any) => ({
          id: r.id, gameId: r.game_id, name: r.name, side: r.side,
          playType: r.play_type ?? '', playerIds: r.player_ids ?? [],
        })),
        clips,
        comments: (cm ?? []).map((r: any) => ({ id: r.id, clipId: r.clip_id, author: r.author ?? '', text: r.body, createdAt: new Date(r.created_at).getTime() })),
      })
    },

    addSquad: (name, orgId) => {
      const id = uid()
      set((s) => ({ squads: [...s.squads, { id, name, orgId }] }))
      supabase.rpc('create_squad', { p_id: id, p_name: name, p_org: orgId }).then(({ error }) => { if (fail(error)) get().loadBase() })
      return id
    },
    createOrg: async (name, ownerLogin, plan, maxSquads, expiresOn) => {
      const { error } = await supabase.rpc('create_org', { p_name: name, p_owner_email: toLoginEmail(ownerLogin), p_plan: plan, p_max_squads: maxSquads, p_expires: expiresOn })
      if (!error) get().loadBase()
      return error?.message ?? null
    },
    updateOrg: async (id, p) => {
      const row: Record<string, unknown> = {}
      if (p.name !== undefined) row.name = p.name
      if (p.plan !== undefined) row.plan = p.plan
      if (p.maxSquads !== undefined) row.max_squads = p.maxSquads
      if (p.expiresOn !== undefined) row.expires_on = p.expiresOn
      const { error } = await supabase.from('orgs').update(row).eq('id', id)
      if (!error) get().loadBase()
      return error?.message ?? null
    },
    addOrgMember: async (orgId, login, role) => {
      const { error } = await supabase.rpc('add_org_member', { p_org: orgId, p_email: toLoginEmail(login), p_role: role })
      if (!error) get().loadBase()
      return error?.message ?? null
    },
    setOrgRole: (orgId, userId, role) => {
      set((s) => ({ orgMembers: s.orgMembers.map((m) => (m.orgId === orgId && m.userId === userId ? { ...m, role: role as OrgMember['role'] } : m)) }))
      supabase.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId).then(({ error }) => { if (fail(error)) get().loadBase() })
    },
    removeOrgMember: (orgId, userId) => {
      set((s) => ({ orgMembers: s.orgMembers.filter((m) => !(m.orgId === orgId && m.userId === userId)) }))
      supabase.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId).then(({ error }) => { if (fail(error)) get().loadBase() })
    },
    addMember: async (squadId, email, role) => {
      const { error } = await supabase.rpc('add_member', { p_squad: squadId, p_email: email, p_role: role })
      return error?.message ?? null
    },
    addPlayer: (squadId, number, name) => {
      const id = uid()
      set((s) => ({ players: [...s.players, { id, squadId, number, name }] }))
      supabase.from('players').insert({ id, squad_id: squadId, number, name }).then(({ error }) => { if (fail(error)) get().loadBase() })
    },
    addPlayers: (squadId, list) => {
      const rows = list.map((p) => ({ id: uid(), squadId, number: p.number, name: p.name }))
      set((s) => ({ players: [...s.players, ...rows] }))
      supabase.from('players').insert(rows.map((r) => ({ id: r.id, squad_id: squadId, number: r.number, name: r.name })))
        .then(({ error }) => { if (fail(error)) get().loadBase() })
    },
    removePlayer: (id) => {
      set((s) => ({
        players: s.players.filter((p) => p.id !== id),
        clips: s.clips.map((c) => ({ ...c, playerIds: c.playerIds.filter((x) => x !== id) })),
      }))
      supabase.from('players').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addGame: (g, vids) => {
      const id = uid()
      const rows: GameVideo[] = vids.map((v, i) => ({ id: uid(), gameId: id, label: v.label, youtubeId: v.youtubeId, position: i + 1 }))
      set((s) => ({ games: [...s.games, { ...g, id }], videos: [...s.videos, ...rows] }))
      supabase.from('games').insert({ id, squad_id: g.squadId, title: g.title, played_on: g.date || null })
        .then(async ({ error }) => {
          if (fail(error)) return get().loadBase()
          const r2 = await supabase.from('game_videos').insert(rows.map((v) => ({ id: v.id, game_id: id, label: v.label, youtube_id: v.youtubeId, position: v.position })))
          if (fail(r2.error)) get().loadBase()
        })
      return { gameId: id, videoId: rows[0]?.id ?? '' }
    },
    addVideo: (gameId, label, youtubeId) => {
      const id = uid()
      const position = Math.max(0, ...get().videos.filter((v) => v.gameId === gameId).map((v) => v.position)) + 1
      set((s) => ({ videos: [...s.videos, { id, gameId, label, youtubeId, position }] }))
      supabase.from('game_videos').insert({ id, game_id: gameId, label, youtube_id: youtubeId, position })
        .then(({ error }) => { if (fail(error)) get().loadBase() })
      return id
    },
    removeVideo: (id) => {
      set((s) => ({ videos: s.videos.filter((v) => v.id !== id), clips: s.clips.filter((c) => c.videoId !== id) }))
      supabase.from('game_videos').delete().eq('id', id).then(({ error }) => fail(error))
    },
    renameVideo: (id, label) => {
      set((s) => ({ videos: s.videos.map((v) => (v.id === id ? { ...v, label } : v)) }))
      supabase.from('game_videos').update({ label }).eq('id', id).then(({ error }) => fail(error))
    },
    removeGame: (id) => {
      set((s) => ({ games: s.games.filter((g) => g.id !== id), videos: s.videos.filter((v) => v.gameId !== id), clips: s.clips.filter((c) => c.gameId !== id) }))
      supabase.from('games').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addClip: (gameId, videoId, start, end, side) => {
      const id = uid()
      const clip: Clip = {
        id, gameId, videoId, side,
        start: Math.max(0, start), end: Math.max(start + 1, end),
        teamWide: false, playerIds: [], playType: '', note: '',
        author: get().session?.user.id ?? '',
      }
      set((s) => ({ clips: [...s.clips, clip] }))
      supabase.from('clips').insert({
        id, game_id: gameId, video_id: videoId, side, start_s: clip.start, end_s: clip.end,
      }).then(({ error }) => { if (fail(error)) get().loadGame(gameId) })
      return id
    },
    updateClip: (id, patch) => {
      set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      pending.set(id, { ...pending.get(id), ...patch })
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => flushClip(id), 400))
    },
    removeClip: (id) => {
      pending.delete(id); clearTimeout(timers.get(id)); timers.delete(id)
      set((s) => ({ clips: s.clips.filter((c) => c.id !== id), comments: s.comments.filter((c) => c.clipId !== id) }))
      supabase.from('clips').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addPlaylist: (gameId, name, f) => {
      const id = uid()
      const row: Playlist = { id, gameId, name, side: f.side, playType: f.playType, playerIds: f.playerIds }
      set((s) => ({ playlists: [...s.playlists, row] }))
      supabase.from('playlists').insert({
        id, game_id: gameId, name, side: f.side, play_type: f.playType, player_ids: f.playerIds,
      }).then(({ error }) => { if (fail(error)) get().loadGame(gameId) })
      return id
    },
    setTeamNames: (gameId, home, away) => {
      set((s) => ({ games: s.games.map((g) => (g.id === gameId ? { ...g, homeName: home, awayName: away } : g)) }))
      supabase.from('games').update({ home_name: home, away_name: away }).eq('id', gameId).then(({ error }) => fail(error))
    },
    addGamePlayers: (gameId, side, list) => {
      const rows: GamePlayer[] = list.map((p) => ({ id: uid(), gameId, side, number: p.number, name: p.name, playerId: p.playerId ?? null }))
      set((s) => ({ gamePlayers: [...s.gamePlayers, ...rows] }))
      supabase.from('game_players').insert(rows.map((r) => ({ id: r.id, game_id: gameId, side, number: r.number, name: r.name, player_id: r.playerId })))
        .then(({ error }) => { if (fail(error)) get().loadGame(gameId) })
    },
    updateGamePlayer: (id, p) => {
      set((s) => ({ gamePlayers: s.gamePlayers.map((x) => (x.id === id ? { ...x, ...p } : x)) }))
      supabase.from('game_players').update(p).eq('id', id).then(({ error }) => { if (fail(error)) get().loadGame(useUi.getState().gameId) })
    },
    removeGamePlayer: (id) => {
      set((s) => ({ gamePlayers: s.gamePlayers.filter((p) => p.id !== id), stats: s.stats.filter((e) => e.gamePlayerId !== id), lineups: s.lineups.filter((e) => e.gamePlayerId !== id) }))
      supabase.from('game_players').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addStat: (e) => {
      const id = uid()
      set((s) => ({ stats: [...s.stats, { ...e, id, createdAt: Date.now() }] }))
      supabase.from('stat_events').insert({
        id, game_id: e.gameId, side: e.side, game_player_id: e.gamePlayerId, type: e.type, period: e.period,
        video_id: e.videoId, video_t: e.videoT, clock_s: e.clockS ?? null,
      }).then(({ error }) => { if (fail(error)) get().loadGame(e.gameId) })
      return id
    },
    setClock: (gameId, p) => {
      set((s) => ({ games: s.games.map((g) => (g.id === gameId ? { ...g, ...p } : g)) }))
      const row: Record<string, unknown> = {}
      if (p.periodLen !== undefined) row.period_len = p.periodLen
      if (p.clockPeriod !== undefined) row.clock_period = p.clockPeriod
      if (p.clockRemaining !== undefined) row.clock_remaining = p.clockRemaining
      if (p.clockRunning !== undefined) row.clock_running = p.clockRunning
      if (p.clockStartedAt !== undefined) row.clock_started_at = p.clockStartedAt ? new Date(p.clockStartedAt).toISOString() : null
      supabase.from('games').update(row).eq('id', gameId).then(({ error }) => fail(error))
    },
    addLineup: (e) => {
      const id = uid()
      set((s) => ({ lineups: [...s.lineups, { ...e, id, createdAt: Date.now() }] }))
      supabase.from('lineup_events').insert({ id, game_id: e.gameId, side: e.side, game_player_id: e.gamePlayerId, kind: e.kind, period: e.period, clock_s: e.clockS })
        .then(({ error }) => { if (fail(error)) get().loadGame(e.gameId) })
    },
    removeLineup: (id) => {
      set((s) => ({ lineups: s.lineups.filter((e) => e.id !== id) }))
      supabase.from('lineup_events').delete().eq('id', id).then(({ error }) => fail(error))
    },
    setStatVideo: (id, videoId, videoT) => {
      set((s) => ({ stats: s.stats.map((e) => (e.id === id ? { ...e, videoId, videoT } : e)) }))
      supabase.from('stat_events').update({ video_id: videoId, video_t: videoT }).eq('id', id).then(({ error }) => fail(error))
    },
    removeStat: (id) => {
      set((s) => ({ stats: s.stats.filter((e) => e.id !== id) }))
      supabase.from('stat_events').delete().eq('id', id).then(({ error }) => fail(error))
    },
    removePlaylist: (id) => {
      set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }))
      supabase.from('playlists').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addComment: (clipId, text) => {
      const id = uid()
      const author = get().session?.user.id ?? ''
      set((s) => ({ comments: [...s.comments, { id, clipId, author, text, createdAt: Date.now() }] }))
      supabase.from('comments').insert({ id, clip_id: clipId, body: text, author })
        .then(({ error }) => { if (fail(error)) get().loadGame(useUi.getState().gameId) })
    },
  }
})

/* ---------- Trạng thái giao diện (không lưu) ---------- */
export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export interface Caption { on: boolean; pos: Corner }
function loadCaption(): Caption {
  try {
    const c = JSON.parse(localStorage.getItem('gr-caption') ?? '')
    if (c && typeof c.on === 'boolean' && ['tl', 'tr', 'bl', 'br'].includes(c.pos)) return c
  } catch { /* chưa lưu hoặc trình duyệt chặn */ }
  return { on: true, pos: 'bl' }
}
export function setCaption(c: Caption) {
  useUi.getState().set({ caption: c })
  try { localStorage.setItem('gr-caption', JSON.stringify(c)) } catch { /* bỏ qua */ }
}
export interface RecState {
  phase: 'recording' | 'waiting' | 'hidden' | 'done' | 'error'
  index: number // đoạn đang ghi (bắt đầu từ 1)
  total: number
  remain: number // số giây còn phải ghi (ước tính)
  msg: string
  url?: string
  size?: number
  ext?: string
  title?: string
}
export interface Filter { side: Side | null; playerIds: string[]; playType: string }
interface UiState {
  orgId: string // trung tâm đang xem (quản trị hệ thống chọn được)
  squadId: string
  gameId: string | null
  videoId: string | null // video (hiệp) đang xem
  clipId: string | null
  filter: Filter
  pre: number
  post: number
  time: number
  duration: number
  playing: boolean
  playlist: boolean
  playlistId: string
  inPoint: number | null // điểm Vào (phím I) đang chờ điểm Ra
  spotEdit: { clipId: string; t: number; hold: number; boxes: SpotBox[] } | null // đang vẽ khung khoanh
  spotHold: { boxes: SpotBox[]; frame: string | null } | null // đang dừng hình tại điểm khoanh
  spotPreview: string | null // clipId đang xem thử khoanh
  lastSide: Side
  pending: { t: number; play: boolean } | null // tua tới đây sau khi video mới tải xong
  overview: boolean // màn hình tổng quan trận đấu
  autoNext: boolean // hết hiệp tự sang hiệp sau
  toast: string // thông báo xanh ngắn (tự ẩn)
  caption: Caption // thẻ nhận xét trên video khi quay / phát playlist
  rec: RecState | null // trạng thái quay màn hình
  set: (p: Partial<UiState>) => void
}
export const useUi = create<UiState>((set) => ({
  orgId: '',
  squadId: '',
  gameId: null,
  videoId: null,
  clipId: null,
  filter: { side: null, playerIds: [], playType: '' },
  pre: 5,
  post: 8,
  time: 0,
  duration: 0,
  playing: false,
  playlist: false,
  playlistId: '',
  inPoint: null,
  spotEdit: null,
  spotHold: null,
  spotPreview: null,
  lastSide: 'ATK',
  pending: null,
  overview: false,
  autoNext: true,
  toast: '',
  caption: loadCaption(),
  rec: null,
  set: (p) => set(p),
}))

export function matches(c: Clip, f: Filter): boolean {
  if (f.side && c.side !== f.side) return false
  if (f.playType && c.playType !== f.playType) return false
  if (f.playerIds.length && !f.playerIds.some((id) => c.playerIds.includes(id))) return false
  return true
}

/** Video theo thứ tự hiệp của một trận. */
export function videosOf(gameId: string | null): GameVideo[] {
  if (!gameId) return []
  return useData.getState().videos.filter((v) => v.gameId === gameId).sort((a, b) => a.position - b.position)
}

/** Mở một trận: chọn video đầu tiên và xoá trạng thái của trận cũ. */
export function selectGame(gameId: string | null) {
  useUi.getState().set({
    gameId, videoId: videosOf(gameId)[0]?.id ?? null, clipId: null,
    inPoint: null, playlist: false, playlistId: '', pending: null,
  })
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** Thông báo ngắn ở cuối màn hình, tự ẩn sau 2,5 giây. */
export function toast(msg: string) {
  useUi.getState().set({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => useUi.getState().set({ toast: '' }), 2500)
}

/** Vai trò của tôi trong trung tâm (owner / coach / viewer), hoặc null. */
export function myOrgRole(orgId: string): OrgMember['role'] | null {
  const d = useData.getState()
  const me = d.session?.user.id
  return d.orgMembers.find((m) => m.orgId === orgId && m.userId === me)?.role ?? null
}
export function orgExpired(o: Org | undefined): boolean {
  return !!o?.expiresOn && o.expiresOn < new Date().toISOString().slice(0, 10)
}
