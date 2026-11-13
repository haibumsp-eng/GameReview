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
  homeName?: string
  awayName?: string
  /** Đồng hồ thi đấu (trang Live Stats) */
  periodLen?: number
  clockPeriod?: number
  clockRemaining?: number | null
  clockRunning?: boolean
  clockStartedAt?: number | null
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

/* ---------- Thống kê (box score kiểu FIBA) ---------- */
export type TeamSide = 'home' | 'away'
/** Cầu thủ của một trận (mỗi đội một bên). playerId: nối với cầu thủ của tuyến nếu có. */
export interface GamePlayer { id: string; gameId: string; side: TeamSide; number: number; name: string; playerId: string | null }
/** M = trúng (made), X = trượt. */
export type StatType = '2PM' | '2PX' | '3PM' | '3PX' | 'FTM' | 'FTX' | 'OREB' | 'DREB' | 'AST' | 'STL' | 'BLK' | 'TOV' | 'PF'
export interface StatEvent {
  id: string
  gameId: string
  side: TeamSide
  gamePlayerId: string | null
  type: StatType
  period: number
  videoId: string | null
  videoT: number | null
  clockS?: number | null
  viaRemote?: boolean
  createdAt: number
}
/** Vào sân / ra sân, ghi theo đồng hồ thi đấu. */
export interface LineupEvent { id: string; gameId: string; side: TeamSide; gamePlayerId: string; kind: 'in' | 'out'; period: number; clockS: number; createdAt: number }
