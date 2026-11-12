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
      video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
  return stream
}

let cancelled = false
export function cancelRecording() { cancelled = true }

/** Phát lần lượt từng đoạn và chỉ ghi khi video thật sự đang chạy (tự dừng khi YouTube đang tải hoặc khi rời tab). */
export async function runRecording(stream: MediaStream, clips: Clip[], title: string) {
  cancelled = false
  const ui = useUi.getState
  const setRec = (p: Partial<NonNullable<ReturnType<typeof ui>['rec']>>) =>
    ui().set({ rec: { phase: 'recording', index: 0, total: clips.length, remain: 0, msg: '', ...ui().rec, ...p } })
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
      goToClip(c, true)
      // Chờ video (có thể là hiệp khác) tải xong, tua đúng chỗ và bắt đầu chạy.
      const t0 = Date.now()
      while (!cancelled && !userStopped) {
        const u = ui()
        if (!u.pending && u.videoId === c.videoId && yt.ready() && yt.state() === 1 && Math.abs(yt.time() - c.start) < 2) break
        if (yt.ready() && !u.pending && u.videoId === c.videoId && yt.state() !== 1 && yt.state() !== 3) {
          if (Math.abs(yt.time() - c.start) >= 2) yt.seek(c.start)
          yt.play()
        }
        if (Date.now() - t0 > 30000) throw new Error('Video không chạy được. Kiểm tra mạng rồi thử lại.')
        await sleep(100)
      }
      // Ghi tới hết đoạn.
      while (!cancelled && !userStopped) {
        if (document.hidden) {
          pauseRec(); yt.pause()
          setRec({ phase: 'hidden', msg: 'Đã tạm dừng vì bạn rời tab. Quay lại tab này để ghi tiếp.' })
          while (document.hidden && !cancelled) await sleep(300)
          await sleep(800)
          yt.play()
          continue
        }
        const t = yt.time()
        if (t >= c.end) break
        if (yt.state() === 1) {
          resumeRec()
          setRec({ phase: 'recording', remain: remainFrom(i, t), msg: '' })
        } else {
          pauseRec()
          if (yt.state() === 3) setRec({ phase: 'waiting', msg: 'Mạng chậm, đang chờ YouTube tải… (phần này không bị ghi vào video)' })
          else yt.play()
        }
        await sleep(50)
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
