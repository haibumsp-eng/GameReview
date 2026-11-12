/* Quay lại các đoạn đã lọc từ chính tab đang phát YouTube (không cần file gốc). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useUi } from '../store'
import { goToClip } from '../nav'
import { yt } from '../youtube'
import type { Clip } from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Định dạng ghi: ưu tiên MP4 (xem được trên iPhone), không có thì WebM. */
export function pickFormat(): { mime: string; ext: string } {
  const cands = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,opus', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'],
  ]
  for (const [mime, ext] of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  return { mime: '', ext: 'webm' }
}

export function canRecord(): boolean {
  return !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'
}

/**
 * Xin quyền ghi tab và chỉ giữ khung video. Phải gọi trực tiếp trong sự kiện bấm nút.
 * Ném lỗi có thông điệp dễ hiểu nếu người dùng chọn sai hoặc huỷ.
 */
export async function startCapture(videoEl: HTMLElement): Promise<MediaStream> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 }, height: { max: 1080 } },
      audio: true,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
      systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
    } as any)
  } catch {
    throw new Error('Bạn đã huỷ hoặc trình duyệt không cho phép quay. Hãy bấm lại và chọn “Cho phép / Chia sẻ”.')
  }
  const track = stream.getVideoTracks()[0] as any
  const settings = track.getSettings?.() ?? {}
  if (settings.displaySurface && settings.displaySurface !== 'browser') {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Hãy chọn mục “Tab” (thẻ trình duyệt) và chọn đúng tab GameReview này, không chọn cả màn hình hay cửa sổ.')
  }
  // Chỉ giữ khung video: ưu tiên Element Capture, sau đó Region Capture (Chrome/Edge).
  const W = window as any
  try {
    if (W.RestrictionTarget && track.restrictTo) await track.restrictTo(await W.RestrictionTarget.fromElement(videoEl))
    else if (W.CropTarget && track.cropTo) await track.cropTo(await W.CropTarget.fromElement(videoEl))
  } catch {
    try {
      if (W.CropTarget && track.cropTo) await track.cropTo(await W.CropTarget.fromElement(videoEl))
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('Bạn đã chọn sai tab. Hãy bấm lại và chọn đúng tab GameReview đang mở.')
    }
  }
  await track.applyConstraints?.({ frameRate: { max: 30 } }).catch(() => {})
  return stream
}

let cancelled = false
export function cancelRecording() { cancelled = true }

/** Phát lần lượt từng đoạn và chỉ ghi khi video thật sự đang chạy (tự dừng khi YouTube đang tải hoặc khi rời tab). */
export async function runRecording(stream: MediaStream, clips: Clip[], title: string) {
  cancelled = false
  const ui = useUi.getState
  const setRec = (p: Partial<NonNullable<ReturnType<typeof ui>['rec']>>) => {
    const cur = ui().rec
    const next = { phase: 'recording' as const, index: 0, total: clips.length, remain: 0, msg: '', ...cur, ...p }
    if (p.remain !== undefined) next.remain = Math.ceil(p.remain)
    if (cur && cur.phase === next.phase && cur.index === next.index && cur.msg === next.msg && cur.remain === next.remain && !p.url) return
    ui().set({ rec: next })
  }
  const remainFrom = (i: number, t: number) =>
    clips.slice(i).reduce((a, c, j) => a + (j === 0 ? Math.max(0, c.end - Math.max(t, c.start)) : c.end - c.start), 0)

  const { mime, ext } = pickFormat()
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((r) => { rec.onstop = () => r() })
  let userStopped = false
  stream.getVideoTracks()[0].addEventListener('ended', () => { userStopped = true }) // bấm "Dừng chia sẻ" của trình duyệt
  rec.start(1000)
  rec.pause()
  const pauseRec = () => { if (rec.state === 'recording') rec.pause() }
  const resumeRec = () => { if (rec.state === 'paused') rec.resume() }

  try {
    for (let i = 0; i < clips.length && !cancelled && !userStopped; i++) {
      const c = clips[i]
      setRec({ phase: 'waiting', index: i + 1, remain: remainFrom(i, c.start), msg: 'Đang tua tới đoạn tiếp theo…' })
      const pre = Math.max(0, c.start - 1) // tua lùi 1 giây để YouTube kịp hiện hình trước khi ghi
      goToClip({ ...c, start: pre }, true)
      const t0 = Date.now()
      let lastT = -1
      let lastSeek = performance.now()
      let lastPlay = 0
      while (!cancelled && !userStopped) {
        const u = ui()
        const here = !u.pending && u.videoId === c.videoId && yt.ready()
        if (here) {
          const t = yt.time()
          const moving = yt.state() === 1 && lastT >= 0 && t > lastT + 0.01 // thời gian thật sự tăng = hình đang chạy
          if (moving && t >= c.start) break
          const now = performance.now()
          // Lệch chỗ thì tua lại, nhưng chờ ít nhất 1,5 giây sau lần tua trước (YouTube cần thời gian để tua xong).
          if ((t < pre - 0.5 || t > c.end) && now - lastSeek > 1500) { yt.seek(pre); lastSeek = now }
          if (yt.state() !== 1 && yt.state() !== 3 && now - lastPlay > 500) { yt.play(); lastPlay = now }
          lastT = t
        }
        if (Date.now() - t0 > 30000) throw new Error('Video không chạy được. Kiểm tra mạng rồi thử lại.')
        await sleep(40)
      }
      // Ghi tới hết đoạn.
      let lastMove = performance.now()
      while (!cancelled && !userStopped) {
        if (document.hidden) {
          pauseRec(); yt.pause()
          setRec({ phase: 'hidden', msg: 'Đã tạm dừng vì bạn rời tab. Quay lại tab này để ghi tiếp.' })
          while (document.hidden && !cancelled) await sleep(300)
          await sleep(800)
          yt.play()
          lastMove = 0 // chỉ ghi tiếp khi hình chạy lại thật sự
          continue
        }
        const t = yt.time()
        if (t >= c.end) break
        if (t > lastT + 0.005) lastMove = performance.now()
        lastT = t
        const stalled = performance.now() - lastMove > 120 // hình đứng hơn 0,12 giây (≈3 khung) thì ngừng ghi
        if (yt.state() === 1 && !stalled) {
          resumeRec()
          setRec({ phase: 'recording', remain: remainFrom(i, t), msg: '' })
        } else {
          pauseRec()
          if (yt.state() === 3 || stalled) setRec({ phase: 'waiting', msg: 'Mạng chậm, đang chờ YouTube tải… (phần này không bị ghi vào video)' })
          if (yt.state() !== 1 && yt.state() !== 3 && performance.now() - lastMove > 500) yt.play()
        }
        await sleep(25)
      }
      pauseRec()
    }
  } catch (e) {
    yt.pause(); pauseRec()
    if (rec.state !== 'inactive') rec.stop()
    stream.getTracks().forEach((t) => t.stop())
    setRec({ phase: 'error', msg: e instanceof Error ? e.message : String(e) })
    return
  }

  yt.pause()
  if (rec.state !== 'inactive') rec.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())
  if (cancelled) return ui().set({ rec: null })
  const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' })
  setRec({
    phase: 'done', remain: 0, url: URL.createObjectURL(blob), size: blob.size,
    ext: (rec.mimeType || mime).includes('mp4') ? 'mp4' : ext, title,
    msg: userStopped ? 'Bạn đã dừng chia sẻ giữa chừng: file chỉ gồm phần đã ghi.' : '',
  })
}
