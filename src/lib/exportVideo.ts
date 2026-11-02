import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

export interface Seg { start: number; end: number }

/** Gộp các đoạn chồng lên nhau / sát nhau để không bị lặp hình. */
export function mergeSegs(segs: Seg[]): Seg[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const out: Seg[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end + 0.5) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

let ff: FFmpeg | null = null
async function load(onLog: (m: string) => void): Promise<FFmpeg> {
  if (ff) return ff
  const f = new FFmpeg()
  f.on('log', ({ message }) => onLog(message))
  const base = `${import.meta.env.BASE_URL}ffmpeg/`
  await f.load({
    coreURL: await toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm'),
  })
  ff = f
  return f
}

export interface ExportOpts {
  /** Lệch giữa mốc trong app (video YouTube) và file gốc, tính bằng giây. */
  offset: number
  /** true: nén lại để cắt chính xác từng giây (chậm). false: cắt nhanh, có thể lệch vài giây ở đầu đoạn. */
  accurate: boolean
  onProgress: (msg: string, frac: number) => void
}

/** Cắt và ghép các đoạn từ file gốc ngay trong trình duyệt. File không rời khỏi máy. */
export async function exportVideo(file: File, segsIn: Seg[], o: ExportOpts): Promise<Blob> {
  const segs = mergeSegs(segsIn)
  if (!segs.length) throw new Error('Không có đoạn nào để cắt.')
  o.onProgress('Đang tải bộ cắt video…', 0)
  const f = await load(() => {})

  const ext = (file.name.match(/\.(\w+)$/)?.[1] ?? 'mp4').toLowerCase()
  const inName = `input.${ext}`
  // Bọc lại File để đặt tên an toàn; dữ liệu không bị sao chép vào RAM (WORKERFS đọc theo yêu cầu).
  const wrapped = new File([file], inName, { type: file.type })
  await f.createDir('/in').catch(() => {})
  await f.mount('WORKERFS' as never, { files: [wrapped] }, '/in')

  const parts: string[] = []
  try {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const start = Math.max(0, s.start + o.offset)
      const dur = Math.max(0.5, s.end - s.start)
      const out = `part${i}.mp4`
      o.onProgress(`Đang cắt đoạn ${i + 1}/${segs.length}…`, i / (segs.length + 1))
      const args = ['-ss', String(start), '-i', `/in/${inName}`, '-t', String(dur)]
      if (o.accurate) args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac')
      else args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
      args.push('-y', out)
      const code = await f.exec(args)
      if (code !== 0) throw new Error(`ffmpeg lỗi ở đoạn ${i + 1}. Kiểm tra file gốc có đúng video của trận này không.`)
      parts.push(out)
    }

    o.onProgress('Đang ghép các đoạn…', segs.length / (segs.length + 1))
    await f.writeFile('list.txt', parts.map((p) => `file '${p}'`).join('\n'))
    const code = await f.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-y', 'out.mp4'])
    if (code !== 0) throw new Error('Không ghép được các đoạn.')
    const data = (await f.readFile('out.mp4')) as Uint8Array
    o.onProgress('Xong', 1)
    return new Blob([data as BlobPart], { type: 'video/mp4' })
  } finally {
    for (const p of [...parts, 'list.txt', 'out.mp4']) await f.deleteFile(p).catch(() => {})
    await f.unmount('/in').catch(() => {})
  }
}
