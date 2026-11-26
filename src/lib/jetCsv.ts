/**
 * Đọc file danh sách VĐV của JET (bảng tính "BHL - Thông tin vận động viên").
 * CHỈ lấy: tên đội, tên HLV, họ tên VĐV và số áo. Mọi cột khác (ngày sinh, điện thoại, chiều cao, cân nặng, học phí…)
 * bị bỏ qua ngay khi đọc và không bao giờ được lưu hay gửi đi.
 */

export interface JetPlayerRow { name: string; number: number | null; note: string }
export interface JetTeamRow { name: string; coach: string; players: JetPlayerRow[] }
export interface JetParse { teams: JetTeamRow[]; skipped: { team: string; name: string; why: string }[] }

/** CSV chuẩn RFC 4180: ô có thể chứa dấu phẩy, nháy kép và xuống dòng. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

/** "LẠI PHÚC ANH" → "Lại Phúc Anh". Tên đã viết hoa chữ đầu thì giữ nguyên. */
export function niceName(s: string): string {
  const c = clean(s)
  if (c !== c.toLocaleUpperCase('vi')) return c
  return c.toLocaleLowerCase('vi').split(' ').map((w) => (w ? w[0].toLocaleUpperCase('vi') + w.slice(1) : w)).join(' ')
}

export function parseJetCsv(text: string): JetParse {
  const rows = parseCsv(text)
  // Tìm các cột theo tiêu đề để không phụ thuộc vị trí.
  const head = rows.find((r) => r.some((c) => fold(c).includes('ho & ten') || fold(c) === 'ho va ten')) ?? []
  const col = (pred: (h: string) => boolean, fallback: number) => { const i = head.findIndex((c) => pred(fold(c))); return i >= 0 ? i : fallback }
  const cName = col((h) => h.includes('ho') && h.includes('ten'), 1)
  const cNum = col((h) => h.includes('so ao'), 7)
  const cStatus = col((h) => h.includes('trang thai'), 9)

  const teams: JetTeamRow[] = []
  const skipped: JetParse['skipped'] = []
  let cur: JetTeamRow | null = null
  for (const r of rows) {
    const first = clean(r[0] ?? ''), name = clean(r[cName] ?? '')
    // Dòng tên đội: "SATURN - COACH HOÀNG TÙNG" (các ô khác trống).
    if (first && !/^\d+$/.test(first) && !name && !fold(first).includes('stt') && !fold(first).includes('tong')) {
      const m = first.match(/^(.*?)\s*[-–]\s*coach\s+(.+)$/i)
      cur = { name: niceName(m ? m[1] : first), coach: m ? niceName(m[2]) : '', players: [] }
      teams.push(cur)
      continue
    }
    if (!cur || !name || !/^\d+$/.test(first)) continue
    const status = fold(r[cStatus] ?? '')
    if (status.includes('tu choi')) { skipped.push({ team: cur.name, name: niceName(name), why: 'Trạng thái "Từ chối"' }); continue }
    const rawNum = clean(r[cNum] ?? '')
    const n = /^\d{1,2}$/.test(rawNum) ? +rawNum : null
    cur.players.push({ name: niceName(name), number: n, note: status.includes('muon tham gia') ? 'Trạng thái "Muốn tham gia"' : '' })
  }
  return { teams: teams.filter((t) => t.players.length), skipped }
}

/**
 * Số áo trong một đội phải khác nhau và nằm trong 0–99. Người thiếu số hoặc trùng số được gán số trống
 * (từ 99 trở xuống) và được đánh dấu để bạn đổi lại ở "Số áo trận này" của từng trận.
 */
export function assignNumbers(players: JetPlayerRow[], taken: Iterable<number> = []): { name: string; number: number; temp: boolean; note: string }[] {
  const used = new Set<number>(taken)
  const out = players.map((p) => {
    const ok = p.number != null && !used.has(p.number)
    if (ok) used.add(p.number!)
    return { name: p.name, number: ok ? p.number! : -1, temp: !ok, note: p.number == null ? 'Thiếu số áo' : ok ? p.note : `Trùng số ${p.number}` }
  })
  let next = 99
  for (const o of out) if (o.temp) { while (used.has(next)) next--; o.number = next; used.add(next) }
  return out
}
