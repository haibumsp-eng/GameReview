import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Clip, Comment, Game, Player, Side, Squad } from './types'
import { uid } from './util'

/**
 * Data layer. Hiện lưu ở localStorage (chế độ demo, 1 trình duyệt).
 * Khi nối Supabase, chỉ cần thay các action bên dưới bằng gọi API —
 * schema nằm ở supabase/schema.sql.
 */
interface DataState {
  user: string
  squads: Squad[]
  players: Player[]
  games: Game[]
  clips: Clip[]
  comments: Comment[]
  setUser: (name: string) => void
  addSquad: (name: string) => string
  addPlayer: (squadId: string, number: number, name: string) => void
  removePlayer: (id: string) => void
  addGame: (g: Omit<Game, 'id'>) => string
  removeGame: (id: string) => void
  addClip: (gameId: string, at: number, side: Side, pre: number, post: number) => string
  updateClip: (id: string, patch: Partial<Clip>) => void
  removeClip: (id: string) => void
  addComment: (clipId: string, text: string) => void
}

const seedSquad: Squad = { id: 'squad-1', name: 'U16 Nam' }
const seedPlayers: Player[] = [
  [4, 'Minh'], [5, 'Hùng'], [7, 'Nam'], [8, 'Long'], [11, 'Tuấn'], [23, 'Khoa'],
].map(([n, name]) => ({ id: uid(), squadId: seedSquad.id, number: n as number, name: name as string }))

export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      user: '',
      squads: [seedSquad],
      players: seedPlayers,
      games: [],
      clips: [],
      comments: [],
      setUser: (user) => set({ user }),
      addSquad: (name) => {
        const id = uid()
        set((s) => ({ squads: [...s.squads, { id, name }] }))
        return id
      },
      addPlayer: (squadId, number, name) =>
        set((s) => ({ players: [...s.players, { id: uid(), squadId, number, name }] })),
      removePlayer: (id) =>
        set((s) => ({
          players: s.players.filter((p) => p.id !== id),
          clips: s.clips.map((c) => ({ ...c, playerIds: c.playerIds.filter((x) => x !== id) })),
        })),
      addGame: (g) => {
        const id = uid()
        set((s) => ({ games: [...s.games, { ...g, id }] }))
        return id
      },
      removeGame: (id) =>
        set((s) => {
          const gone = new Set(s.clips.filter((c) => c.gameId === id).map((c) => c.id))
          return {
            games: s.games.filter((g) => g.id !== id),
            clips: s.clips.filter((c) => c.gameId !== id),
            comments: s.comments.filter((c) => !gone.has(c.clipId)),
          }
        }),
      addClip: (gameId, at, side, pre, post) => {
        const id = uid()
        const clip: Clip = {
          id, gameId, side,
          start: Math.max(0, at - pre),
          end: at + post,
          teamWide: false, playerIds: [], playType: '', note: '',
          author: get().user,
        }
        set((s) => ({ clips: [...s.clips, clip] }))
        return id
      },
      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeClip: (id) =>
        set((s) => ({
          clips: s.clips.filter((c) => c.id !== id),
          comments: s.comments.filter((c) => c.clipId !== id),
        })),
      addComment: (clipId, text) =>
        set((s) => ({
          comments: [...s.comments, { id: uid(), clipId, text, author: s.user, createdAt: Date.now() }],
        })),
    }),
    { name: 'gamereview-data-v1' },
  ),
)

/** Trạng thái giao diện (không lưu). */
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
  set: (p: Partial<UiState>) => void
}
export const useUi = create<UiState>((set) => ({
  squadId: seedSquad.id,
  gameId: null,
  clipId: null,
  filter: { side: null, playerIds: [], playType: '' },
  pre: 5,
  post: 8,
  time: 0,
  duration: 0,
  playing: false,
  playlist: false,
  set: (p) => set(p),
}))

export function matches(c: Clip, f: Filter): boolean {
  if (f.side && c.side !== f.side) return false
  if (f.playType && c.playType !== f.playType) return false
  if (f.playerIds.length && !f.playerIds.some((id) => c.playerIds.includes(id))) return false
  return true
}
