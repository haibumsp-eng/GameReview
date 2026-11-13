import type { StatEvent, StatType } from '../types'

export interface Line {
  pts: number; fgm: number; fga: number; p2m: number; p2a: number; p3m: number; p3a: number; ftm: number; fta: number
  oreb: number; dreb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number
}

/** Cộng dồn các pha thành một dòng box score (như FIBA). */
export function lineOf(events: StatEvent[]): Line {
  const n = (t: StatType) => events.filter((e) => e.type === t).length
  const p2m = n('2PM'), p2a = p2m + n('2PX'), p3m = n('3PM'), p3a = p3m + n('3PX'), ftm = n('FTM'), fta = ftm + n('FTX')
  const oreb = n('OREB'), dreb = n('DREB')
  return {
    pts: 2 * p2m + 3 * p3m + ftm, fgm: p2m + p3m, fga: p2a + p3a, p2m, p2a, p3m, p3a, ftm, fta,
    oreb, dreb, reb: oreb + dreb, ast: n('AST'), stl: n('STL'), blk: n('BLK'), tov: n('TOV'), pf: n('PF') + n('PFS'),
  }
}

/** PF thường hoặc shooting foul: đều tính vào lỗi cá nhân và lỗi đồng đội. */
export const isFoul = (t: StatType) => t === 'PF' || t === 'PFS'

export const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 1000) / 10}%` : '–')
export const periodLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)

/** Thuật ngữ thống kê (tiếng Anh, theo FIBA). */
export const STAT_LABEL: Record<StatType, string> = {
  '2PM': '2PT made', '2PX': '2PT missed', '3PM': '3PT made', '3PX': '3PT missed', FTM: 'FT made', FTX: 'FT missed',
  OREB: 'OREB', DREB: 'DREB', AST: 'AST', STL: 'STL', BLK: 'BLK', TOV: 'TOV', PF: 'PF', PFS: 'Shooting foul',
}
