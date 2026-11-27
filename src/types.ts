export type Side = 'ATK' | 'DEF'

export interface Squad { id: string; name: string; orgId: string; /** Giải JET (PRO.JET | JET | JR.JET | WJET) nếu đây là đội giải JET. */ league?: string | null; season?: string; coach?: string; /** true = tuyến cũ có chữ JET (không phải đội giải): ẩn khỏi danh sách đội, chỉ giữ các trận. */ jetLegacy?: boolean }
/** jet_ref: Trọng tài JET (admin riêng của Giải JET, không phải chủ trung tâm). jet_coach: HLV JET (chỉ đội được giao). */
export type OrgRole = 'owner' | 'coach' | 'viewer' | 'jet_ref' | 'jet_coach'
/** Trung tâm / CLB: một khách hàng. */
export interface Org { id: string; name: string; plan: string; maxSquads: number | null; expiresOn: string | null; joinCode: string; /** Bật mục Giải JET (riêng Junsport). */ jetEnabled?: boolean }
export interface OrgMember { orgId: string; userId: string; role: OrgRole }
/** number: số áo mặc định của tuyến; đội giải JET không có số mặc định (null), số áo ghi theo từng trận. */
export interface Player { id: string; squadId: string; number: number | null; name: string }
export interface Game {
  id: string
  squadId: string
  title: string
  date: string
  homeName?: string
  awayName?: string
  /** Đội JET làm đội khách (nếu có): danh sách VĐV tự nạp vào "Danh sách trận" của đội khách. */
  awaySquadId?: string | null
  /** Đồng hồ thi đấu (trang Live Stats) */
  periodLen?: number
  clockPeriod?: number
  clockRemaining?: number | null
  clockRunning?: boolean
  clockStartedAt?: number | null
  /** Máy quay đánh dấu bắt đầu trận: giờ thật (ms) và số giây còn lại trên đồng hồ lúc đó. */
  startMarkedAt?: number | null
  startMarkClock?: number | null
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
  /** Lần sửa gần nhất (nếu đã sửa). */
  editedAt?: number | null
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
export type StatType = '2PM' | '2PX' | '3PM' | '3PX' | 'FTM' | 'FTX' | 'OREB' | 'DREB' | 'AST' | 'STL' | 'BLK' | 'TOV' | 'PF' | 'PFS' | 'PFT' | 'PFU' | 'PFD' | 'TMO'
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
  /** Cú ném trong khu vực paint (dưới rổ). */
  paint?: boolean
  /** Ghi trong tình huống phản công nhanh. */
  fastBreak?: boolean
  /** Cầu thủ (đối phương) bị phạm lỗi. */
  drawnBy?: string | null
  /** AST: cú ghi điểm được kiến tạo. TOV bị steal: pha STL của đối thủ. STL: pha TOV tương ứng. */
  linkedId?: string | null
  /** TOV: 'self' = tự mất bóng, 'stolen' = bị cướp bóng; trống = chưa rõ (tự ghép với STL gần đó). */
  tovKind?: 'self' | 'stolen' | null
  /** Vị trí ném trên nửa sân, 0..1 (x: ngang sân, y: từ đường biên cuối). */
  shotX?: number | null
  shotY?: number | null
  /** Pha do bàn thư ký ghi, đang chờ người bấm stats bổ sung (vị trí, rebound, kiến tạo…). */
  pending?: boolean
  /** Lỗi chưa ném phạt (chưa ném xong): hàng đợi ném phạt lưu theo trận. */
  ftOpen?: boolean
  /** Số quả phạt phải ném cho lỗi này. */
  ftCount?: number | null
  createdAt: number
}
/** Vào sân / ra sân, ghi theo đồng hồ thi đấu. */
export interface LineupEvent { id: string; gameId: string; side: TeamSide; gamePlayerId: string; kind: 'in' | 'out'; period: number; clockS: number; createdAt: number }
