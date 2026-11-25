export type Cell = string | number | null | undefined

/** Một ô CSV: số giữ nguyên; chữ được bọc nháy khi cần, và chặn công thức (=, +, -, @) để Excel không chạy tên cầu thủ như công thức. */
function esc(c: Cell): string {
  if (c == null) return ''
  if (typeof c === 'number') return Number.isFinite(c) ? String(Math.round(c * 1000) / 1000) : ''
  let s = String(c)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}

/** Tải file CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt). */
export function downloadCsv(filename: string, rows: Cell[][]) {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
