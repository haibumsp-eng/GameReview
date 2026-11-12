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

export interface Source { file: File; segs: Seg[] }

/** Cắt và ghép các đoạn từ file gốc (mỗi hiệp một file) ngay trong trình duyệt. File không rời khỏi máy. */
export async function exportVideo(sources: Source[], o: ExportOpts): Promise<Blob> {
  const groups = sources.map((s) => ({ file: s.file, segs: mergeSegs(s.segs) })).filter((g) => g.segs.length)
  const total = groups.reduce((a, g) => a + g.segs.length, 0)
  if (!total) throw new Error('Không có đoạn nào để cắt.')
  o.onProgress('Đang tải bộ cắt video…', 0)
  const f = await load(() => {})

  const parts: string[] = []
  const mounts: string[] = []
  let done = 0
  try {
    for (let g = 0; g < groups.length; g++) {
      const { file, segs } = groups[g]
      const ext = (file.name.match(/\.(\w+)$/)?.[1] ?? 'mp4').toLowerCase()
      const inName = `input.${ext}`
      // Bọc lại File để đặt tên an toàn; dữ liệu không bị sao chép vào RAM (WORKERFS đọc theo yêu cầu).
      const wrapped = new File([file], inName, { type: file.type })
      const dir = `/in${g}`
      await f.createDir(dir).catch(() => {})
      await f.mount('WORKERFS' as never, { files: [wrapped] }, dir)
      mounts.push(dir)

      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i]
        const start = Math.max(0, sg.start + o.offset)
        const dur = Math.max(0.5, sg.end - sg.start)
        const out = `part${g}_${i}.mp4`
        o.onProgress(`Đang cắt đoạn ${done + 1}/${total}…`, done / (total + 1))
        const args = ['-ss', String(start), '-i', `${dir}/${inName}`, '-t', String(dur)]
        if (o.accurate) args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac')
        else args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
        args.push('-y', out)
        const code = await f.exec(args)
        if (code !== 0) throw new Error(`ffmpeg lỗi ở đoạn ${done + 1}. Kiểm tra file gốc có đúng video của hiệp này không.`)
        parts.push(out)
        done++
      }
    }

    o.onProgress('Đang ghép các đoạn…', total / (total + 1))
    await f.writeFile('list.txt', parts.map((p) => `file '${p}'`).join('\n'))
    const code = await f.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-y', 'out.mp4'])
    if (code !== 0) throw new Error('Không ghép được các đoạn. Nếu các hiệp có định dạng khác nhau, hãy tick “Cắt chính xác”.')
    const data = (await f.readFile('out.mp4')) as Uint8Array
    o.onProgress('Xong', 1)
    return new Blob([data as BlobPart], { type: 'video/mp4' })
  } finally {
    for (const p of [...parts, 'list.txt', 'out.mp4']) await f.deleteFile(p).catch(() => {})
    for (const m of mounts) await f.unmount(m).catch(() => {})
  }
}
