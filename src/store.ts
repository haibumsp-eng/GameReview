import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Clip, Comment, Game, Player, Playlist, Side, Squad } from './types'
import { uid } from './util'

/* ---------- Dữ liệu (Supabase) ---------- */
interface DataState {
  ready: boolean
  session: Session | null
  squads: Squad[]
  players: Player[]
  games: Game[]
  clips: Clip[] // chỉ của trận đang mở
  comments: Comment[] // chỉ của trận đang mở
  playlists: Playlist[] // chỉ của trận đang mở
  profiles: Record<string, string>
  error: string
  init: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string, name: string) => Promise<string | null>
  signOut: () => Promise<void>
  loadBase: () => Promise<void>
  loadGame: (gameId: string | null) => Promise<void>
  addSquad: (name: string) => string
  addMember: (squadId: string, email: string, role: string) => Promise<string | null>
  addPlayer: (squadId: string, number: number, name: string) => void
  addPlayers: (squadId: string, list: { number: number; name: string }[]) => void
  removePlayer: (id: string) => void
  addGame: (g: Omit<Game, 'id'>) => string
  removeGame: (id: string) => void
  addClip: (gameId: string, at: number, side: Side, pre: number, post: number) => string
  updateClip: (id: string, patch: Partial<Clip>) => void
  removeClip: (id: string) => void
  addComment: (clipId: string, text: string) => void
  addPlaylist: (gameId: string, name: string, f: Filter) => string
  removePlaylist: (id: string) => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pending = new Map<string, Partial<Clip>>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let reloadTimer: ReturnType<typeof setTimeout> | undefined

export const useData = create<DataState>((set, get) => {
  const fail = (e: { message: string } | null) => {
    if (e) { console.error(e); set({ error: e.message }) }
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
    squads: [], players: [], games: [], clips: [], comments: [], playlists: [],
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
        else set({ squads: [], players: [], games: [], clips: [], comments: [] })
      })
      supabase
        .channel('gamereview')
        .on('postgres_changes', { event: '*', schema: 'public' }, reloadSoon)
        .subscribe()
    },

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error?.message ?? null
    },
    signUp: async (email, password, name) => {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
      if (error) return error.message
      return data.session ? null : 'Đã gửi email xác nhận. Hãy bấm link trong email rồi đăng nhập.'
    },
    signOut: async () => { await supabase.auth.signOut() },

    loadBase: async () => {
      const [sq, pl, ga, pr] = await Promise.all([
        supabase.from('squads').select('*').order('created_at'),
        supabase.from('players').select('*'),
        supabase.from('games').select('*').order('played_on', { ascending: false }),
        supabase.from('profiles').select('*'),
      ])
      if (fail(sq.error) || fail(pl.error) || fail(ga.error) || fail(pr.error)) return
      set({
        squads: (sq.data ?? []).map((r: any) => ({ id: r.id, name: r.name })),
        players: (pl.data ?? []).map((r: any) => ({ id: r.id, squadId: r.squad_id, number: r.number, name: r.name })),
        games: (ga.data ?? []).map((r: any) => ({ id: r.id, squadId: r.squad_id, title: r.title, date: r.played_on ?? '', youtubeId: r.youtube_id })),
        profiles: Object.fromEntries((pr.data ?? []).map((r: any) => [r.id, r.name])),
      })
    },

    loadGame: async (gameId) => {
      if (!gameId) return set({ clips: [], comments: [], playlists: [] })
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
        id: r.id, gameId: r.game_id, start: r.start_s, end: r.end_s, side: r.side,
        teamWide: r.team_wide, playerIds: r.clip_players.map((x: any) => x.player_id),
        playType: r.play_type ?? '', note: r.note ?? '', author: r.author ?? '',
        ...pending.get(r.id),
      }))
      const { data: pl, error: e3 } = await supabase.from('playlists').select('*').eq('game_id', gameId).order('created_at')
      if (fail(e3)) return
      set({
        playlists: (pl ?? []).map((r: any) => ({
          id: r.id, gameId: r.game_id, name: r.name, side: r.side,
          playType: r.play_type ?? '', playerIds: r.player_ids ?? [],
        })),
        clips,
        comments: (cm ?? []).map((r: any) => ({ id: r.id, clipId: r.clip_id, author: r.author ?? '', text: r.body, createdAt: new Date(r.created_at).getTime() })),
      })
    },

    addSquad: (name) => {
      const id = uid()
      set((s) => ({ squads: [...s.squads, { id, name }] }))
      supabase.rpc('create_squad', { p_id: id, p_name: name }).then(({ error }) => { if (fail(error)) get().loadBase() })
      return id
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
    addGame: (g) => {
      const id = uid()
      set((s) => ({ games: [...s.games, { ...g, id }] }))
      supabase.from('games').insert({ id, squad_id: g.squadId, title: g.title, played_on: g.date || null, youtube_id: g.youtubeId })
        .then(({ error }) => { if (fail(error)) get().loadBase() })
      return id
    },
    removeGame: (id) => {
      set((s) => ({ games: s.games.filter((g) => g.id !== id), clips: s.clips.filter((c) => c.gameId !== id) }))
      supabase.from('games').delete().eq('id', id).then(({ error }) => fail(error))
    },
    addClip: (gameId, at, side, pre, post) => {
      const id = uid()
      const clip: Clip = {
        id, gameId, side,
        start: Math.max(0, at - pre), end: at + post,
        teamWide: false, playerIds: [], playType: '', note: '',
        author: get().session?.user.id ?? '',
      }
      set((s) => ({ clips: [...s.clips, clip] }))
      supabase.from('clips').insert({
        id, game_id: gameId, side, start_s: clip.start, end_s: clip.end,
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
export interface Filter { side: Side | null; playerIds: string[]; playType: string }
interface UiState {
  squadId: string
  gameId: string | null
  clipId: string | null
  filter: Filter
  pre: number
  post: number
  time: number
  duration: number
  playing: boolean
  playlist: boolean
  playlistId: string
  set: (p: Partial<UiState>) => void
}
export const useUi = create<UiState>((set) => ({
  squadId: '',
  gameId: null,
  clipId: null,
  filter: { side: null, playerIds: [], playType: '' },
  pre: 5,
  post: 8,
  time: 0,
  duration: 0,
  playing: false,
  playlist: false,
  playlistId: '',
  set: (p) => set(p),
}))

export function matches(c: Clip, f: Filter): boolean {
  if (f.side && c.side !== f.side) return false
  if (f.playType && c.playType !== f.playType) return false
  if (f.playerIds.length && !f.playerIds.some((id) => c.playerIds.includes(id))) return false
  return true
}
