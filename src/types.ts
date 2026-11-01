export type Side = 'ATK' | 'DEF'

export interface Squad { id: string; name: string }
export interface Player { id: string; squadId: string; number: number; name: string }
export interface Game {
  id: string
  squadId: string
  title: string
  date: string
  youtubeId: string
}
export interface Clip {
  id: string
  gameId: string
  start: number
  end: number
  side: Side
  teamWide: boolean
  playerIds: string[]
  playType: string
  note: string
  author: string
}
export interface Comment {
  id: string
  clipId: string
  author: string
  text: string
  createdAt: number
}

export const PLAY_TYPES = [
  'Pick & Roll',
  'Fast break',
  'Isolation',
  'Post up',
  'Set play',
  'Transition D',
  'Zone',
  'Man-to-man',
  'Rebound',
  'Turnover',
  'Ném 3 điểm',
  'Ném phạt',
]
