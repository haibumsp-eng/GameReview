import { useUi, introSeconds } from './store'
import type { Clip } from './types'
import { yt } from './youtube'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let introToken = 0

/** Huỷ lần dừng-đọc-nhận-xét đang chạy (khi bạn tự chuyển tình huống, dừng playlist…). */
export function cancelIntro() {
  introToken++
  if (useUi.getState().captionHold) useUi.getState().set({ captionHold: null })
}

/** Đi tới một tình huống: nếu nó ở hiệp khác thì đổi video rồi tua tới đúng mốc. */
export function goToClip(c: Clip, play = false) {
  cancelIntro()
  const ui = useUi.getState()
  if (c.videoId === ui.videoId) {
    yt.seek(c.start)
    if (play) yt.play()
    ui.set({ clipId: c.id })
  } else {
    ui.set({ clipId: c.id, videoId: c.videoId, pending: { t: c.start, play }, time: c.start })
  }
}

/**
 * Phát một tình huống trong playlist. Nếu tình huống có lời nhận xét thì dừng ở khung đầu,
 * hiện ĐẦY ĐỦ lời nhận xét trên video (mặc định 3 giây), rồi mới chạy tình huống.
 */
export function playClip(c: Clip) {
  const sec = introSeconds(c, useUi.getState().caption)
  if (sec <= 0) return goToClip(c, true)
  goToClip(c, false)
  const token = introToken
  void (async () => {
    // Chờ video đúng hiệp tải xong rồi mới bắt đầu đếm, để không mất thời gian đọc vào lúc đang tải.
    const t0 = Date.now()
    const ready = () => { const u = useUi.getState(); return !u.pending && u.videoId === c.videoId && yt.ready() }
    while (token === introToken && !ready() && Date.now() - t0 < 20000) await sleep(80)
    if (token !== introToken) return
    yt.seek(c.start); yt.pause()
    await sleep(350) // cho YouTube hiện đúng khung hình đầu
    if (token !== introToken) return
    useUi.getState().set({ captionHold: { clipId: c.id } })
    const until = Date.now() + sec * 1000
    while (token === introToken && Date.now() < until) await sleep(60)
    if (token !== introToken) return
    useUi.getState().set({ captionHold: null })
    yt.play()
  })()
}

/** Tua tới một thời điểm trong một video (hiệp) bất kỳ của trận đang mở. */
export function seekVideo(videoId: string, t: number, play = false) {
  cancelIntro()
  const ui = useUi.getState()
  if (videoId === ui.videoId) { yt.seek(t); if (play) yt.play() }
  else ui.set({ videoId, clipId: null, pending: { t, play }, time: t })
}
