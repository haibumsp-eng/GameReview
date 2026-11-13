import { useUi } from './store'
import type { Clip } from './types'
import { yt } from './youtube'

/** Đi tới một tình huống: nếu nó ở hiệp khác thì đổi video rồi tua tới đúng mốc. */
export function goToClip(c: Clip, play = false) {
  const ui = useUi.getState()
  if (c.videoId === ui.videoId) {
    yt.seek(c.start)
    if (play) yt.play()
    ui.set({ clipId: c.id })
  } else {
    ui.set({ clipId: c.id, videoId: c.videoId, pending: { t: c.start, play }, time: c.start })
  }
}

/** Tua tới một thời điểm trong một video (hiệp) bất kỳ của trận đang mở. */
export function seekVideo(videoId: string, t: number, play = false) {
  const ui = useUi.getState()
  if (videoId === ui.videoId) { yt.seek(t); if (play) yt.play() }
  else ui.set({ videoId, clipId: null, pending: { t, play }, time: t })
}
