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
    oreb, dreb, reb: oreb + dreb, ast: n('AST'), stl: n('STL'), blk: n('BLK'), tov: n('TOV'), pf: n('PF'),
  }
}

export const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 1000) / 10}%` : '–')
export const periodLabel = (n: number) => (n <= 4 ? `H${n}` : `OT${n - 4}`)

/** Nhãn hiển thị của từng loại pha. */
export const STAT_LABEL: Record<StatType, string> = {
  '2PM': '2Đ trúng', '2PX': '2Đ trượt', '3PM': '3Đ trúng', '3PX': '3Đ trượt', FTM: 'Ném phạt trúng', FTX: 'Ném phạt trượt',
  OREB: 'Bắt bóng tấn công', DREB: 'Bắt bóng phòng thủ', AST: 'Kiến tạo', STL: 'Cướp bóng', BLK: 'Chắn bóng', TOV: 'Mất bóng', PF: 'Phạm lỗi',
}
