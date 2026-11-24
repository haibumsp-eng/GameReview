// Chạy sau `npm run build`: báo lỗi nếu có file nào quá giới hạn 25 MiB của Cloudflare Pages (hoặc quá 20.000 file).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LIMIT = 25 * 1024 * 1024
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk('dist').map((f) => ({ f, size: statSync(f).size }))
const big = files.filter((x) => x.size > LIMIT)
const top = [...files].sort((a, b) => b.size - a.size).slice(0, 3)
console.log(`dist: ${files.length} file, lớn nhất: ${top.map((x) => `${x.f.replace('dist/', '')} (${(x.size / 1048576).toFixed(1)} MiB)`).join(', ')}`)
if (big.length) {
  console.error(`\nLỖI: ${big.length} file vượt 25 MiB (Cloudflare Pages sẽ từ chối):`)
  for (const x of big) console.error(`  ${x.f}  ${(x.size / 1048576).toFixed(1)} MiB`)
  process.exit(1)
}
if (files.length > 20000) { console.error(`LỖI: ${files.length} file, vượt 20.000.`); process.exit(1) }
