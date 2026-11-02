// Chép lõi ffmpeg.wasm vào public/ để phục vụ cùng domain (chạy sau npm install).
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'

const src = 'node_modules/@ffmpeg/core/dist/esm'
const dst = 'public/ffmpeg'
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true })
  for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(`${src}/${f}`, `${dst}/${f}`)
}
