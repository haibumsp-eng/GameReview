import type { LineupEvent, StatEvent, TeamSide } from '../types'
import { lineOf, type Line } from './boxscore'
import { byGameTime, elapsed, periodLength } from './minutes'

/**
 * Phân tích trận từ các pha đã ghi (theo thứ tự ghi). Không cần bấm thêm gì ngoài các pha thường,
 * trừ: điểm trong paint / fast break (cờ trên cú ném) và team rebound / team turnover (pha của TEAM).
 */

const PTS: Partial<Record<StatEvent['type'], number>> = { '2PM': 2, '3PM': 3, FTM: 1 }
export const other = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const byTime = <T extends { period: number; clockS?: number | null; createdAt: number }>(a: T[]) => byGameTime(a)
const pair = () => ({ home: 0, away: 0 })

/** Điểm từng hiệp của 2 đội. */
export function periodScores(stats: StatEvent[]) {
  const periods = Math.max(4, ...stats.map((e) => e.period))
  const rows: { period: number; home: number; away: number }[] = []
  for (let p = 1; p <= periods; p++) {
    const r = { period: p, home: 0, away: 0 }
    for (const e of stats) if (e.period === p && PTS[e.type]) r[e.side] += PTS[e.type]!
    rows.push(r)
  }
  return rows
}

/** 5 người vào sân đầu tiên ở hiệp 1 của mỗi đội = đá chính. */
export function starters(lineups: LineupEvent[]): Set<string> {
  const res = new Set<string>()
  const n = pair()
  for (const l of byTime(lineups)) {
    if (l.kind !== 'in' || l.period !== 1 || n[l.side] >= 5 || res.has(l.gamePlayerId)) continue
    res.add(l.gamePlayerId); n[l.side]++
  }
  return res
}

/** Cạnh tranh tỉ số: cách biệt lớn nhất, đổi người dẫn, số lần hoà, thời gian dẫn, chuỗi ghi điểm liên tiếp. */
export function flow(stats: StatEvent[], len: number, nowPeriod: number, nowRemaining: number) {
  const score = pair()
  const biggestLead = pair(), biggestRun = pair(), timeLeading = pair()
  let leadChanges = 0, timesTied = 0, leader: TeamSide | null = null, lastLeader: TeamSide | null = null
  let run = { side: null as TeamSide | null, pts: 0 }
  let lastT: number | null = null
  let hasClock = true
  for (const e of byTime(stats)) {
    const p = PTS[e.type]
    if (!p) continue
    const t = e.clockS != null ? elapsed(e.period, e.clockS, len) : null
    if (t == null) hasClock = false
    if (hasClock && t != null) { if (leader && lastT != null) timeLeading[leader] += Math.max(0, t - lastT); lastT = t }
    score[e.side] += p
    // chuỗi ghi điểm: cộng dồn tới khi đối phương ghi
    run = run.side === e.side ? { side: e.side, pts: run.pts + p } : { side: e.side, pts: p }
    biggestRun[e.side] = Math.max(biggestRun[e.side], run.pts)
    const diff = score.home - score.away
    leader = diff > 0 ? 'home' : diff < 0 ? 'away' : null
    if (diff > 0) biggestLead.home = Math.max(biggestLead.home, diff)
    if (diff < 0) biggestLead.away = Math.max(biggestLead.away, -diff)
    if (leader === null) timesTied++
    else { if (lastLeader && lastLeader !== leader) leadChanges++; lastLeader = leader }
  }
  if (hasClock && leader && lastT != null) timeLeading[leader] += Math.max(0, elapsed(nowPeriod, nowRemaining, len) - lastT)
  return { biggestLead, biggestRun, leadChanges, timesTied, timeLeading: hasClock ? timeLeading : null }
}

/**
 * Điểm theo nguồn: trong paint, fast break, dự bị, sau mất bóng, cơ hội thứ hai.
 * "Sau mất bóng" và "cơ hội thứ hai" suy ra từ chuỗi pha (lượt tấn công), nên cần ghi đủ rebound
 * (kể cả TEAM REB) và mất bóng (kể cả TEAM TOV) thì mới chính xác.
 */
export function pointSources(stats: StatEvent[], lineups: LineupEvent[]) {
  const paint = pair(), fastBreak = pair(), bench = pair(), offTov = pair(), secondChance = pair()
  const start = starters(lineups)
  // Lượt tấn công hiện tại: đội nào, bắt đầu từ mất bóng của đối phương?, đã có rebound tấn công?
  let poss: { side: TeamSide; fromTov: boolean; afterOreb: boolean } | null = null
  // Ném phạt ngay sau cú ghi điểm (and-1) vẫn thuộc lượt cũ.
  let justScored: { side: TeamSide; fromTov: boolean; afterOreb: boolean } | null = null
  const take = (side: TeamSide) => { if (!poss || poss.side !== side) poss = { side, fromTov: false, afterOreb: false } }

  for (const e of byTime(stats)) {
    const p = PTS[e.type] ?? 0
    if (p && e.gamePlayerId && !start.has(e.gamePlayerId)) bench[e.side] += p
    if (e.type === '2PM' && (e.paint || (e.shotX != null && e.shotY != null && zoneOf(e.shotX, e.shotY) === 'paint'))) paint[e.side] += 2
    if ((e.type === '2PM' || e.type === '3PM') && e.fastBreak) fastBreak[e.side] += p

    switch (e.type) {
      case 'TOV': poss = { side: other(e.side), fromTov: true, afterOreb: false }; justScored = null; break
      case 'STL': poss = { side: e.side, fromTov: true, afterOreb: false }; justScored = null; break
      case 'DREB': poss = { side: e.side, fromTov: false, afterOreb: false }; justScored = null; break
      case 'OREB': take(e.side); poss!.afterOreb = true; justScored = null; break
      case '2PM': case '3PM': case '2PX': case '3PX': {
        take(e.side)
        const cur = poss!
        if (p) {
          if (cur.fromTov) offTov[e.side] += p
          if (cur.afterOreb) secondChance[e.side] += p
          justScored = { ...cur }
          poss = { side: other(e.side), fromTov: false, afterOreb: false }
        } else justScored = null
        break
      }
      case 'FTM': case 'FTX': {
        const flags = justScored && justScored.side === e.side ? justScored : (take(e.side), poss!)
        if (p) { if (flags.fromTov) offTov[e.side] += p; if (flags.afterOreb) secondChance[e.side] += p }
        break
      }
    }
  }
  return { paint, fastBreak, bench, offTov, secondChance }
}

/** Chỉ số hiệu quả kiểu FIBA/NBA (EFF): cộng điểm, rebound, kiến tạo, cướp, chắn; trừ ném trượt và mất bóng. */
export const eff = (l: Line) => l.pts + l.reb + l.ast + l.stl + l.blk - (l.fga - l.fgm) - (l.fta - l.ftm) - l.tov

/** Chỉ số nâng cao của một đội (so với đối phương). */
export function advanced(mine: StatEvent[], theirs: StatEvent[]) {
  const a = lineOf(mine), b = lineOf(theirs)
  const poss = a.fga - a.oreb + a.tov + 0.44 * a.fta
  const r = (x: number, y: number) => (y ? x / y : null)
  return {
    line: a,
    efg: r(a.fgm + 0.5 * a.p3m, a.fga),
    ts: r(a.pts, 2 * (a.fga + 0.44 * a.fta)),
    tovPct: r(a.tov, a.fga + 0.44 * a.fta + a.tov),
    orebPct: r(a.oreb, a.oreb + b.dreb),
    ftRate: r(a.fta, a.fga),
    astTo: r(a.ast, a.tov),
    poss,
    ortg: r(100 * a.pts, poss),
    teamReb: mine.filter((e) => !e.gamePlayerId && (e.type === 'OREB' || e.type === 'DREB')).length,
    teamTov: mine.filter((e) => !e.gamePlayerId && e.type === 'TOV').length,
  }
}

/** Lỗi đồng đội tính cho hiệp: hiệp phụ cộng dồn với hiệp 4 (theo FIBA). Từ lỗi thứ 5 đối phương được ném phạt. */
export function teamFouls(stats: StatEvent[], side: TeamSide, period: number) {
  const inP = (p: number) => (period >= 4 ? p >= 4 : p === period)
  // Chỉ lỗi của cầu thủ trên sân (lỗi kỹ thuật của HLV / ghế không tính là lỗi đồng đội).
  return stats.filter((e) => e.side === side && e.gamePlayerId && PLAYER_FOULS.includes(e.type) && inP(e.period)).length
}
export const PLAYER_FOULS: StatEvent['type'][] = ['PF', 'PFS', 'PFT', 'PFU', 'PFD']

/**
 * Tình trạng lỗi của cầu thủ (FIBA): 5 lỗi; hoặc 2 lỗi kỹ thuật; hoặc 2 lỗi phản tinh thần thể thao;
 * hoặc 1 kỹ thuật + 1 phản tinh thần thể thao; hoặc 1 lỗi truất quyền → phải rời sân.
 */
export function foulStatus(stats: StatEvent[], playerId: string) {
  const mine = stats.filter((e) => e.gamePlayerId === playerId)
  const n = (t: StatEvent['type']) => mine.filter((e) => e.type === t).length
  const total = mine.filter((e) => PLAYER_FOULS.includes(e.type)).length
  const t = n('PFT'), u = n('PFU'), d = n('PFD')
  const out = total >= 5 || t >= 2 || u >= 2 || (t >= 1 && u >= 1) || d >= 1
  return { total, t, u, d, out }
}

/** Ghép mỗi AST với cú ghi điểm được kiến tạo: theo liên kết đã lưu, nếu không có thì cú ghi điểm gần nhất cùng đội (±15 giây). */
export function assists(stats: StatEvent[]): Map<string, string> {
  const res = new Map<string, string>() // id cú ghi điểm → id cầu thủ kiến tạo
  const made = stats.filter((e) => e.type === '2PM' || e.type === '3PM')
  for (const a of stats.filter((e) => e.type === 'AST' && e.gamePlayerId && e.linkedId)) res.set(a.linkedId!, a.gamePlayerId!)
  for (const a of byTime(stats.filter((e) => e.type === 'AST' && e.gamePlayerId && !e.linkedId))) {
    const fg = made.filter((m) => m.side === a.side && m.gamePlayerId !== a.gamePlayerId && m.period === a.period && !res.has(m.id) && Math.abs(m.createdAt - a.createdAt) <= 15000)
      .sort((x, y) => Math.abs(x.createdAt - a.createdAt) - Math.abs(y.createdAt - a.createdAt))[0]
    if (fg) res.set(fg.id, a.gamePlayerId!)
  }
  return res
}

/* ---------- Vị trí ném (nửa sân FIBA 15 × 14 m, rổ cách đường biên cuối 1,575 m) ---------- */
export const COURT = { w: 15, h: 14, rim: { x: 7.5, y: 1.575 }, paintW: 4.9, paintH: 5.8, three: 6.75, corner: 0.9 }
const cornerY = COURT.rim.y + Math.sqrt(COURT.three ** 2 - (COURT.rim.x - COURT.corner) ** 2)
export type Zone = 'paint' | 'mid' | 'corner3' | 'above3'
export const ZONE_LABEL: Record<Zone, string> = { paint: 'Trong paint', mid: 'Tầm trung', corner3: '3 điểm góc', above3: '3 điểm trên vòng' }
/** Vùng ném từ toạ độ 0..1. */
export function zoneOf(nx: number, ny: number): Zone {
  const x = nx * COURT.w, y = ny * COURT.h
  const inPaint = Math.abs(x - COURT.rim.x) <= COURT.paintW / 2 && y <= COURT.paintH
  if (inPaint) return 'paint'
  if (y <= cornerY) return x <= COURT.corner || x >= COURT.w - COURT.corner ? 'corner3' : 'mid'
  return Math.hypot(x - COURT.rim.x, y - COURT.rim.y) > COURT.three ? 'above3' : 'mid'
}
export const isThreeZone = (z: Zone) => z === 'corner3' || z === 'above3'
/** FG theo vùng của một đội. */
export function zoneStats(stats: StatEvent[]) {
  const z: Record<Zone, { m: number; a: number }> = { paint: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, corner3: { m: 0, a: 0 }, above3: { m: 0, a: 0 } }
  for (const e of stats) {
    if (e.shotX == null || e.shotY == null || !['2PM', '2PX', '3PM', '3PX'].includes(e.type)) continue
    const k = zoneOf(e.shotX, e.shotY)
    z[k].a++; if (e.type.endsWith('M')) z[k].m++
  }
  return z
}
export const BONUS_AT = 4 // sau 4 lỗi đồng đội, lỗi tiếp theo bị phạt ném

/** Timeout đã dùng / được phép trong giai đoạn hiện tại: nửa đầu 2, nửa sau 3, mỗi hiệp phụ 1. */
export function timeouts(stats: StatEvent[], side: TeamSide, period: number) {
  const mine = stats.filter((e) => e.side === side && e.type === 'TMO')
  if (period <= 2) return { used: mine.filter((e) => e.period <= 2).length, max: 2 }
  if (period <= 4) return { used: mine.filter((e) => e.period >= 3 && e.period <= 4).length, max: 3 }
  return { used: mine.filter((e) => e.period === period).length, max: 1 }
}

/** Các bộ 5 người trên sân: thời gian thi đấu và hiệu số khi bộ 5 đó trên sân. */
export function lineupUnits(side: TeamSide, lineups: LineupEvent[], stats: StatEvent[], len: number, nowPeriod: number, nowRemaining: number) {
  const units = new Map<string, { ids: string[]; secs: number; pf: number; pa: number }>()
  const on = new Set<string>()
  let key = '', since: number | null = null
  const close = (t: number) => {
    if (key && since != null) units.get(key)!.secs += Math.max(0, t - since)
  }
  const open = (t: number) => {
    key = on.size === 5 ? [...on].sort().join('|') : ''
    if (key && !units.has(key)) units.set(key, { ids: [...on], secs: 0, pf: 0, pa: 0 })
    since = t
  }
  type Ev = { period: number; clockS?: number | null; createdAt: number; l?: LineupEvent; s?: StatEvent }
  const evs: Ev[] = byTime<Ev>([
    ...lineups.filter((l) => l.side === side).map((l) => ({ period: l.period, clockS: l.clockS, createdAt: l.createdAt, l })),
    ...stats.map((s) => ({ period: s.period, clockS: s.clockS, createdAt: s.createdAt, s })),
  ])
  for (const e of evs) {
    if (e.l) {
      const t = elapsed(e.l.period, e.l.clockS, len)
      close(t)
      if (e.l.kind === 'in') on.add(e.l.gamePlayerId); else on.delete(e.l.gamePlayerId)
      open(t)
    } else if (e.s && key && PTS[e.s.type]) {
      const u = units.get(key)!
      if (e.s.side === side) u.pf += PTS[e.s.type]!; else u.pa += PTS[e.s.type]!
    }
  }
  close(elapsed(nowPeriod, Math.min(nowRemaining, periodLength(nowPeriod, len)), len))
  return [...units.values()].filter((u) => u.secs > 0 || u.pf || u.pa).sort((a, b) => b.secs - a.secs)
}

/**
 * Phân loại mất bóng: "bị steal" (có pha STL của đối thủ ngay gần đó) hay "tự mất bóng".
 * Ưu tiên liên kết đã lưu; pha chưa phân loại thì tự ghép với STL chưa được ghép của đối thủ nằm trong
 * cùng hiệp và lệch giờ đồng hồ ≤ 3 giây (thiếu giờ thì lệch lúc bấm ≤ 8 giây). Mỗi STL chỉ ghép với một TOV.
 */
export type TovInfo = { kind: 'self' | 'stolen'; stealId: string | null; stealerId: string | null }
export function turnoverInfo(stats: StatEvent[]): Map<string, TovInfo> {
  const res = new Map<string, TovInfo>()
  const stls = stats.filter((e) => e.type === 'STL')
  const byId = new Map(stats.map((e) => [e.id, e]))
  const claimed = new Set<string>()
  const tovs = stats.filter((e) => e.type === 'TOV')
  // 1. Liên kết đã lưu (từ TOV hoặc từ STL).
  for (const t of tovs) {
    if (t.tovKind === 'self') { res.set(t.id, { kind: 'self', stealId: null, stealerId: null }); continue }
    const linked = (t.linkedId && byId.get(t.linkedId)?.type === 'STL' ? byId.get(t.linkedId) : undefined) ?? stls.find((x) => x.linkedId === t.id)
    if (linked) { claimed.add(linked.id); res.set(t.id, { kind: 'stolen', stealId: linked.id, stealerId: linked.gamePlayerId }) }
    else if (t.tovKind === 'stolen') res.set(t.id, { kind: 'stolen', stealId: null, stealerId: null })
  }
  // 2. Chưa phân loại: ghép theo độ gần, cặp gần nhất trước.
  // Hai pha có giờ đồng hồ: cùng hiệp và lệch ≤ 3 giây. Thiếu giờ: dùng thời điểm bấm (≤ 8 giây).
  const hasClock = (a: StatEvent, b: StatEvent) => a.clockS != null && b.clockS != null
  const near = (a: StatEvent, b: StatEvent) => (hasClock(a, b) ? a.period === b.period && Math.abs(a.clockS! - b.clockS!) <= 3 : Math.abs(a.createdAt - b.createdAt) <= 8000)
  const dist = (a: StatEvent, b: StatEvent) => (hasClock(a, b) ? Math.abs(a.clockS! - b.clockS!) * 1000 : Math.abs(a.createdAt - b.createdAt))
  const pairs: { t: StatEvent; s: StatEvent; d: number }[] = []
  for (const t of tovs) {
    if (res.has(t.id)) continue
    for (const s of stls) if (!claimed.has(s.id) && s.side !== t.side && !s.linkedId && near(t, s)) pairs.push({ t, s, d: dist(t, s) })
  }
  for (const { t, s } of pairs.sort((a, b) => a.d - b.d)) {
    if (res.has(t.id) || claimed.has(s.id)) continue
    claimed.add(s.id); res.set(t.id, { kind: 'stolen', stealId: s.id, stealerId: s.gamePlayerId })
  }
  for (const t of tovs) if (!res.has(t.id)) res.set(t.id, { kind: 'self', stealId: null, stealerId: null })
  return res
}
