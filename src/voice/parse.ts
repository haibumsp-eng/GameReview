import type { StatType, TeamSide } from '../types'

/**
 * Hiểu câu nói của người bấm stats → danh sách pha.
 * Quy ước nói: [tên/màu đội] số <áo> <hành động> ..., ví dụ
 *   "Xanh, số 24 assist, số 4 ghi 2 điểm"
 *   "Tím số 4 turn over, xanh số 15 steal, số 15 assist, số 11 ghi điểm"
 *   "Dừng giờ, xanh số 25 lỗi cá nhân, tím số 7 ném phạt vào trượt"
 * Đội được giữ cho tới khi nói đội khác; cầu thủ được giữ cho tới khi nói số khác.
 */

export interface VPlayer { id: string; side: TeamSide; number: number; on: boolean }
export interface VoiceCtx { homeWords: string[]; awayWords: string[]; players: VPlayer[] }

export type VoiceItem =
  | { kind: 'stat'; type: StatType; side: TeamSide | null; number: number | null; gamePlayerId: string | null; warn?: string; error?: string }
  | { kind: 'clock'; run: boolean }
  | { kind: 'note'; text: string }

/** Chữ thường, bỏ dấu, đ → d; dấu câu thành dấu phẩy. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/#/g, ' so ')
    .replace(/(\d+)/g, ' $1 ')
    .replace(/[.,;:!?…"“”()\-–—/]+/g, ' , ')
    .replace(/\s+/g, ' ')
    .trim()
}

const UNIT: Record<string, number> = { khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, nham: 5, sau: 6, bay: 7, tam: 8, chin: 9 }
const isNumWord = (t: string) => t in UNIT || t === 'muoi' || t === 'linh' || t === 'le'
/** Từ có thể mở đầu một số ("lăm", "tư", "linh" chỉ đứng sau). */
const START = new Set(['khong', 'mot', 'hai', 'ba', 'bon', 'nam', 'sau', 'bay', 'tam', 'chin', 'muoi'])

/** Đọc số từ chữ: "hai mươi tư" / "hai tư" = 24, "mười lăm" = 15, "ba" = 3. */
function wordsToNumber(ws: string[]): number | null {
  const w = ws.filter((x) => x !== 'linh' && x !== 'le')
  if (!w.length) return null
  const i = w.indexOf('muoi')
  if (i === -1) {
    if (w.length === 1) return UNIT[w[0]]
    if (w.length === 2) return UNIT[w[0]] * 10 + UNIT[w[1]]
    return null
  }
  const tens = i === 0 ? 1 : w.length > 0 && i === 1 ? UNIT[w[0]] : NaN
  const rest = w.slice(i + 1)
  if (rest.length > 1 || Number.isNaN(tens)) return null
  return tens * 10 + (rest.length ? UNIT[rest[0]] : 0)
}

type Act =
  | { t: 'stat'; type: StatType }
  | { t: 'shot' }
  | { t: 'reb' }
  | { t: 'ft' }
  | { t: 'made' }
  | { t: 'miss' }
  | { t: 'clock'; run: boolean }
  | { t: 'oreb-mod' }
  | { t: 'dreb-mod' }
  | { t: 'points' }
  | { t: 'skip' }

/** Cụm từ (đã bỏ dấu). Cụm dài khớp trước. */
const PHRASES: [string, Act][] = [
  // đồng hồ
  ['tam dung gio', { t: 'clock', run: false }], ['dung gio', { t: 'clock', run: false }], ['dung dong ho', { t: 'clock', run: false }],
  ['stop gio', { t: 'clock', run: false }], ['chay gio', { t: 'clock', run: true }], ['bat gio', { t: 'clock', run: true }],
  ['chay dong ho', { t: 'clock', run: true }], ['tiep tuc gio', { t: 'clock', run: true }],
  // lỗi
  ['shooting foul', { t: 'stat', type: 'PFS' }], ['loi khi nem', { t: 'stat', type: 'PFS' }], ['loi nem', { t: 'stat', type: 'PFS' }], ['sf', { t: 'stat', type: 'PFS' }],
  ['loi ca nhan', { t: 'stat', type: 'PF' }], ['pham loi', { t: 'stat', type: 'PF' }], ['personal foul', { t: 'stat', type: 'PF' }],
  ['foul', { t: 'stat', type: 'PF' }], ['phao', { t: 'stat', type: 'PF' }], ['pf', { t: 'stat', type: 'PF' }], ['loi', { t: 'stat', type: 'PF' }],
  // kiến tạo, cướp, mất bóng, chắn
  ['kien tao', { t: 'stat', type: 'AST' }], ['assist', { t: 'stat', type: 'AST' }], ['assists', { t: 'stat', type: 'AST' }], ['ast', { t: 'stat', type: 'AST' }], ['a xit', { t: 'stat', type: 'AST' }],
  ['cuop bong', { t: 'stat', type: 'STL' }], ['cuop', { t: 'stat', type: 'STL' }], ['cat bong', { t: 'stat', type: 'STL' }], ['steal', { t: 'stat', type: 'STL' }], ['stl', { t: 'stat', type: 'STL' }], ['still', { t: 'stat', type: 'STL' }],
  ['turn over', { t: 'stat', type: 'TOV' }], ['turnover', { t: 'stat', type: 'TOV' }], ['tov', { t: 'stat', type: 'TOV' }], ['mat bong', { t: 'stat', type: 'TOV' }], ['mat banh', { t: 'stat', type: 'TOV' }],
  ['ton o vo', { t: 'stat', type: 'TOV' }], ['tan o vo', { t: 'stat', type: 'TOV' }],
  ['chan bong', { t: 'stat', type: 'BLK' }], ['block', { t: 'stat', type: 'BLK' }], ['blk', { t: 'stat', type: 'BLK' }], ['bloc', { t: 'stat', type: 'BLK' }], ['chan', { t: 'stat', type: 'BLK' }],
  // bắt bóng
  ['oreb', { t: 'stat', type: 'OREB' }], ['dreb', { t: 'stat', type: 'DREB' }],
  ['offensive rebound', { t: 'stat', type: 'OREB' }], ['defensive rebound', { t: 'stat', type: 'DREB' }],
  ['bat bong bat bong', { t: 'reb' }], ['bat bong', { t: 'reb' }], ['tranh bong', { t: 'reb' }], ['rebound', { t: 'reb' }], ['ri bao', { t: 'reb' }],
  ['tan cong', { t: 'oreb-mod' }], ['phong thu', { t: 'dreb-mod' }],
  // ném phạt
  ['nem phat', { t: 'ft' }], ['free throw', { t: 'ft' }], ['ft', { t: 'ft' }], ['phat', { t: 'ft' }],
  // ném rổ
  ['ghi diem', { t: 'shot' }], ['len ro', { t: 'shot' }], ['an diem', { t: 'shot' }], ['ghi', { t: 'shot' }], ['nem', { t: 'shot' }], ['tha', { t: 'shot' }],
  ['diem', { t: 'points' }],
  ['khong vao', { t: 'miss' }], ['truot', { t: 'miss' }], ['hong', { t: 'miss' }], ['miss', { t: 'miss' }], ['xit', { t: 'miss' }], ['tach', { t: 'miss' }],
  ['vao', { t: 'made' }], ['trung', { t: 'made' }], ['made', { t: 'made' }],
  // bỏ qua
  ['qua', { t: 'skip' }], ['lan', { t: 'skip' }], ['duoc', { t: 'skip' }], ['cua', { t: 'skip' }], ['thu', { t: 'skip' }],
].map(([p, a]) => [p as string, a as Act])
PHRASES.sort((a, b) => b[0].split(' ').length - a[0].split(' ').length)

const shotType = (pts: number, miss: boolean): StatType =>
  pts === 1 ? (miss ? 'FTX' : 'FTM') : pts === 3 ? (miss ? '3PX' : '3PM') : (miss ? '2PX' : '2PM')

export function parseVoice(text: string, ctx: VoiceCtx): VoiceItem[] {
  const toks = norm(text).split(' ').filter(Boolean)
  const teamPhrases: [string[], TeamSide][] = [
    ...ctx.homeWords.map((w) => [norm(w).replace(/ , /g, ' ').split(' ').filter((x) => x !== ','), 'home'] as [string[], TeamSide]),
    ...ctx.awayWords.map((w) => [norm(w).replace(/ , /g, ' ').split(' ').filter((x) => x !== ','), 'away'] as [string[], TeamSide]),
  ].filter(([w]) => w.length && w.join(' ').length >= 2)
  teamPhrases.sort((a, b) => b[0].length - a[0].length)
  const at = (i: number, words: string[]) => words.every((w, k) => toks[i + k] === w)

  const out: VoiceItem[] = []
  let team: TeamSide | null = null
  let player: number | null = null
  let pending: Extract<VoiceItem, { kind: 'stat' }>[] = [] // hành động nói trước số áo
  let lastShot: { item: Extract<VoiceItem, { kind: 'stat' }>; idx: number; ptsSet: boolean } | null = null
  let ft: { idx: number; used: boolean } | null = null
  let missBefore = -99
  let lastReb: { item: Extract<VoiceItem, { kind: 'stat' }>; idx: number } | null = null
  let pointsFor: { pts: number; idx: number } | null = null

  const emit = (type: StatType, extra: Partial<Extract<VoiceItem, { kind: 'stat' }>> = {}) => {
    const it: Extract<VoiceItem, { kind: 'stat' }> = { kind: 'stat', type, side: team, number: player, gamePlayerId: null, ...extra }
    out.push(it)
    if (player == null) pending.push(it)
    return it
  }
  const setPlayer = (n: number) => {
    player = n
    for (const it of pending) { it.number = n; if (!it.side) it.side = team }
    pending = []
  }

  let i = 0
  while (i < toks.length) {
    const tk = toks[i]
    if (tk === ',') { i++; continue }

    // Đội
    const tp = teamPhrases.find(([w]) => at(i, w))
    if (tp) { team = tp[1]; player = null; pending = []; i += tp[0].length; continue }

    // Số (chữ số hoặc chữ)
    let num: number | null = null, len = 0
    if (/^\d+$/.test(tk)) { num = +tk; len = 1 }
    else if (START.has(tk)) {
      let j = i + 1
      while (j < toks.length && isNumWord(toks[j])) j++
      let ws = toks.slice(i, j)
      // "số bốn hai điểm": chữ cuối là số điểm, phần trước là số áo
      if (ws.length >= 2 && toks[j] === 'diem' && !ws.includes('muoi')) ws = ws.slice(0, -1)
      num = wordsToNumber(ws)
      len = ws.length
      if (num == null) { i = j; continue }
    }
    if (num != null) {
      const next = toks[i + len]
      const prev = toks[i - 1]
      if (prev === 'thu') { i += len; continue } // "lỗi thứ hai"
      if (next === 'qua' || next === 'lan' || next === 'trai') { i += len; continue } // "2 quả ném phạt"
      if (next === 'diem') { pointsFor = { pts: num, idx: i }; i += len; continue }
      setPlayer(num)
      lastShot = null; ft = null; lastReb = null
      i += len; continue
    }
    if (tk === 'so' || tk === 'ao') { i++; continue }

    // Cụm từ
    const ph = PHRASES.find(([p]) => at(i, p.split(' ')))
    if (!ph) { i++; continue }
    const [p, a] = ph
    const step = p.split(' ').length
    switch (a.t) {
      case 'clock': out.push({ kind: 'clock', run: a.run }); break
      case 'stat': emit(a.type); break
      case 'reb': lastReb = { item: emit('DREB', { warn: 'Không nói tấn công / phòng thủ: tạm tính DREB' }), idx: i }; break
      case 'oreb-mod': case 'dreb-mod':
        if (lastReb && i - lastReb.idx <= 3) { lastReb.item.type = a.t === 'oreb-mod' ? 'OREB' : 'DREB'; delete lastReb.item.warn; lastReb = null }
        else if (toks.slice(i + step, i + step + 3).some((x) => x === 'rebound' || x === 'bat' || x === 'tranh')) {
          // "tấn công rebound": xử lý khi gặp rebound
          const j = toks.findIndex((x, k) => k >= i + step && (x === 'rebound' || x === 'bat' || x === 'tranh'))
          const isO = a.t === 'oreb-mod'
          const ph2 = PHRASES.find(([pp]) => at(j, pp.split(' ')))
          emit(isO ? 'OREB' : 'DREB')
          i = j + (ph2 ? ph2[0].split(' ').length : 1)
          continue
        }
        break
      case 'ft': ft = { idx: i, used: false }; break
      case 'made': case 'miss':
        if (ft && i - ft.idx <= 8) { emit(a.t === 'made' ? 'FTM' : 'FTX'); ft.used = true; ft.idx = i; break }
        if (a.t === 'miss') {
          if (lastShot && i - lastShot.idx <= 4) { lastShot.item.type = shotType(lastShot.item.type.startsWith('3') ? 3 : 2, true); if (lastShot.item.warn) lastShot.item.warn = 'Không nói 2 hay 3 điểm: tạm tính 2PT trượt' }
          else missBefore = i
        }
        break
      case 'shot': {
        const miss = i - missBefore <= 3
        const it = emit(miss ? '2PX' : '2PM', { warn: 'Không nói 2 hay 3 điểm: tạm tính 2PT' })
        lastShot = { item: it, idx: i, ptsSet: false }
        break
      }
      case 'points': {
        // "<n> điểm"
        const pts = pointsFor && pointsFor.idx >= i - 3 ? pointsFor.pts : null
        pointsFor = null
        if (pts == null || pts < 1 || pts > 3) break
        const miss = i - missBefore <= 4
        if (lastShot && !lastShot.ptsSet && i - lastShot.idx <= 4) {
          const wasMiss = lastShot.item.type.endsWith('X')
          lastShot.item.type = shotType(pts, miss || wasMiss)
          delete lastShot.item.warn
          lastShot.ptsSet = true
        } else {
          lastShot = { item: emit(shotType(pts, miss)), idx: i, ptsSet: true }
        }
        break
      }
      case 'skip': break
    }
    i += step
  }

  if (ft && !ft.used) out.push({ kind: 'note', text: 'Ném phạt: chưa nói vào hay trượt' })

  // Gắn cầu thủ thật + kiểm tra
  for (const it of out) {
    if (it.kind !== 'stat') continue
    if (it.number == null) { it.error = 'Không rõ cầu thủ'; continue }
    let cands = ctx.players.filter((p) => p.number === it.number && (!it.side || p.side === it.side))
    if (!it.side && cands.length > 1) {
      const on = cands.filter((p) => p.on)
      if (on.length === 1) cands = on
    }
    if (cands.length === 0) { it.error = `${it.side ? (it.side === 'home' ? 'HOME' : 'AWAY') + ' không' : 'Không'} có số ${it.number}`; continue }
    if (cands.length > 1) { it.error = `Số ${it.number} có ở cả 2 đội: nói tên/màu đội`; continue }
    it.gamePlayerId = cands[0].id
    it.side = cands[0].side
    if (!cands[0].on && !it.warn) it.warn = `#${it.number} đang ở BENCH`
  }
  return out
}
