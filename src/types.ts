export type Side = 'ATK' | 'DEF'

export interface Squad { id: string; name: string; orgId: string }
export type OrgRole = 'owner' | 'coach' | 'viewer'
/** Trung tâm / CLB: một khách hàng. */
export interface Org { id: string; name: string; plan: string; maxSquads: number | null; expiresOn: string | null; joinCode: string }
export interface OrgMember { orgId: string; userId: string; role: OrgRole }
export interface Player { id: string; squadId: string; number: number; name: string }
export interface Game {
  id: string
  squadId: string
  title: string
  date: string
}
/** Một video (một hiệp / OT) của trận. Mốc thời gian của mark tính theo video này. */
export interface GameVideo {
  id: string
  gameId: string
  label: string
  youtubeId: string
  position: number
}
export interface Clip {
  id: string
  gameId: string
  videoId: string
  start: number
  end: number
  side: Side
  teamWide: boolean
  playerIds: string[]
  playType: string
  note: string
  author: string
  spotlight?: Spotlight | null
}
/** Khung khoanh cầu thủ, toạ độ 0..1 theo khung hình video (16:9). */
export interface SpotBox { x: number; y: number; w: number; h: number; label?: string }
/** Dừng hình tại thời điểm t trong `hold` giây và khoanh các cầu thủ. */
export interface Spotlight { t: number; hold: number; boxes: SpotBox[] }
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

export interface Playlist {
  id: string
  gameId: string
  name: string
  side: Side | null
  playType: string
  playerIds: string[]
}
