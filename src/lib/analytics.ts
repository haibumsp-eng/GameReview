import type { LineupEvent, StatEvent, TeamSide } from '../types'
import { lineOf, type Line } from './boxscore'
import { elapsed, periodLength } from './minutes'

/**
 * Phân tích trận từ các pha đã ghi (theo thứ tự ghi). Không cần bấm thêm gì ngoài các pha thường,
 * trừ: điểm trong sơn / fast break (cờ trên cú ném) và team rebound / team turnover (pha của TEAM).
 */

const PTS: Partial<Record<StatEvent['type'], number>> = { '2PM': 2, '3PM': 3, FTM: 1 }
export const other = (s: TeamSide): TeamSide => (s === 'home' ? 'away' : 'home')
const byTime = <T extends { createdAt: number }>(a: T[]) => [...a].sort((x, y) => x.createdAt - y.createdAt)
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
 * Điểm theo nguồn: trong sơn, fast break, dự bị, sau mất bóng, cơ hội thứ hai.
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
    if (e.type === '2PM' && e.paint) paint[e.side] += 2
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
  return stats.filter((e) => e.side === side && (e.type === 'PF' || e.type === 'PFS') && inP(e.period)).length
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
  type Ev = { at: number; l?: LineupEvent; s?: StatEvent }
  const evs: Ev[] = [...lineups.filter((l) => l.side === side).map((l) => ({ at: l.createdAt, l })), ...stats.map((s) => ({ at: s.createdAt, s }))].sort((a, b) => a.at - b.at)
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
