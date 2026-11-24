import type { LineupEvent, StatEvent, TeamSide } from '../types'

/** Độ dài hiệp (giây): hiệp chính theo cài đặt, hiệp phụ (OT) 5 phút theo FIBA. */
export const periodLength = (period: number, len: number) => (period <= 4 ? len : 300)

/** Đổi (hiệp, giây còn lại) thành số giây đã thi đấu tính từ đầu trận. */
export function elapsed(period: number, remaining: number, len: number): number {
  let t = 0
  for (let p = 1; p < period; p++) t += periodLength(p, len)
  return t + Math.max(0, periodLength(period, len) - remaining)
}

/**
 * Sắp xếp theo GIỜ THI ĐẤU (hiệp, rồi giờ còn lại giảm dần), không theo lúc bấm.
 * Nhờ vậy một lần thay người / pha được ghi bổ sung muộn vẫn nằm đúng chỗ trong trận.
 * Cùng một giờ thì theo thứ tự đã bấm; pha thiếu giờ coi như ở đầu hiệp.
 */
export function byGameTime<T extends { period: number; clockS?: number | null; createdAt: number }>(a: T[]): T[] {
  return [...a].sort((x, y) => x.period - y.period || ((y.clockS ?? 1e9) - (x.clockS ?? 1e9)) || x.createdAt - y.createdAt)
}

/** Ai đang trên sân (theo giờ thi đấu của các lần vào/ra đã ghi). */
export function onCourt(lineups: LineupEvent[]): Set<string> {
  const on = new Set<string>()
  for (const e of byGameTime(lineups)) {
    if (e.kind === 'in') on.add(e.gamePlayerId)
    else on.delete(e.gamePlayerId)
  }
  return on
}

/**
 * Phút thi đấu (giây) của từng cầu thủ, tính theo đồng hồ thi đấu.
 * Cầu thủ còn trên sân được tính tới thời điểm hiện tại của đồng hồ (nowPeriod, nowRemaining).
 */
export function secondsPlayed(lineups: LineupEvent[], len: number, nowPeriod: number, nowRemaining: number): Map<string, number> {
  const res = new Map<string, number>()
  const since = new Map<string, number>()
  for (const e of byGameTime(lineups)) {
    const t = elapsed(e.period, e.clockS, len)
    if (e.kind === 'in') { if (!since.has(e.gamePlayerId)) since.set(e.gamePlayerId, t) }
    else if (since.has(e.gamePlayerId)) {
      res.set(e.gamePlayerId, (res.get(e.gamePlayerId) ?? 0) + Math.max(0, t - since.get(e.gamePlayerId)!))
      since.delete(e.gamePlayerId)
    }
  }
  const now = elapsed(nowPeriod, nowRemaining, len)
  for (const [id, t0] of since) res.set(id, (res.get(id) ?? 0) + Math.max(0, now - t0))
  return res
}

const POINTS: Partial<Record<StatEvent['type'], number>> = { '2PM': 2, '3PM': 3, FTM: 1 }

/** +/-: hiệu số điểm của đội trong lúc cầu thủ ở trên sân (xét theo thứ tự các pha đã ghi). */
export function plusMinus(lineups: LineupEvent[], stats: StatEvent[]): Map<string, number> {
  const pm = new Map<string, number>()
  const on: Record<TeamSide, Set<string>> = { home: new Set(), away: new Set() }
  type Ev = { l?: LineupEvent; s?: StatEvent }
  const evs: Ev[] = byGameTime<{ period: number; clockS?: number | null; createdAt: number; l?: LineupEvent; s?: StatEvent }>([
    ...lineups.map((l) => ({ period: l.period, clockS: l.clockS, createdAt: l.createdAt, l })),
    ...stats.map((s) => ({ period: s.period, clockS: s.clockS, createdAt: s.createdAt, s })),
  ])
  for (const e of evs) {
    if (e.l) { if (e.l.kind === 'in') on[e.l.side].add(e.l.gamePlayerId); else on[e.l.side].delete(e.l.gamePlayerId) }
    else if (e.s && POINTS[e.s.type]) {
      const pts = POINTS[e.s.type]!, other: TeamSide = e.s.side === 'home' ? 'away' : 'home'
      for (const id of on[e.s.side]) pm.set(id, (pm.get(id) ?? 0) + pts)
      for (const id of on[other]) pm.set(id, (pm.get(id) ?? 0) - pts)
    }
  }
  return pm
}

/** 754 giây → "12:34". */
export const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Giây còn lại trên đồng hồ ngay lúc này (đang chạy thì trừ thời gian đã trôi). */
export function clockNow(g: { periodLen?: number; clockPeriod?: number; clockRemaining?: number | null; clockRunning?: boolean; clockStartedAt?: number | null }): number {
  const len = periodLength(g.clockPeriod ?? 1, g.periodLen ?? 600)
  const base = g.clockRemaining ?? len
  if (!g.clockRunning || !g.clockStartedAt) return Math.max(0, base)
  return Math.max(0, base - (Date.now() - g.clockStartedAt) / 1000)
}

/**
 * Các pha của cầu thủ KHÔNG ở trên sân vào lúc đó (thường do quên ghi một lần thay người).
 * Chỉ kiểm tra cầu thủ của đội đã có ghi thay người; đội chưa ghi lần nào thì bỏ qua.
 */
export function offCourtStats(stats: StatEvent[], lineups: LineupEvent[]): Set<string> {
  const tracked = new Set(lineups.map((l) => l.side))
  const on = new Set<string>()
  const bad = new Set<string>()
  type Ev = { period: number; clockS?: number | null; createdAt: number; l?: LineupEvent; s?: StatEvent }
  const evs: Ev[] = byGameTime<Ev>([
    ...lineups.map((l) => ({ period: l.period, clockS: l.clockS, createdAt: l.createdAt, l })),
    ...stats.map((s) => ({ period: s.period, clockS: s.clockS, createdAt: s.createdAt, s })),
  ])
  for (const e of evs) {
    if (e.l) { if (e.l.kind === 'in') on.add(e.l.gamePlayerId); else on.delete(e.l.gamePlayerId) }
    else if (e.s && e.s.gamePlayerId && tracked.has(e.s.side) && !on.has(e.s.gamePlayerId)) bad.add(e.s.id)
  }
  return bad
}

/** Ai đang trên sân của một đội vào đúng thời điểm (hiệp, giờ còn lại), tính cả các lần thay đúng giờ đó. */
export function courtAt(lineups: LineupEvent[], side: TeamSide, period: number, clockS: number): Set<string> {
  const on = new Set<string>()
  for (const e of byGameTime(lineups.filter((l) => l.side === side))) {
    if (e.period > period || (e.period === period && e.clockS < clockS)) break
    if (e.kind === 'in') on.add(e.gamePlayerId); else on.delete(e.gamePlayerId)
  }
  return on
}
