/* Bọc YouTube IFrame API: 1 player duy nhất cho cả app. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let apiPromise: Promise<void> | null = null
function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve()
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return apiPromise
}

let player: any = null

export const yt = {
  async mount(el: HTMLElement, videoId: string, onReady: () => void) {
    await loadApi()
    yt.destroy()
    const inner = document.createElement('div')
    el.appendChild(inner)
    player = new window.YT.Player(inner, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: { onReady },
    })
  },
  destroy() { try { player?.destroy() } catch { /* noop */ } player = null },
  ready: () => !!player?.getCurrentTime,
  time: (): number => (yt.ready() ? player.getCurrentTime() : 0),
  duration: (): number => (yt.ready() ? player.getDuration() || 0 : 0),
  playing: (): boolean => yt.ready() && player.getPlayerState() === 1,
  ended: (): boolean => yt.ready() && player.getPlayerState() === 0,
  /** -1 chưa bắt đầu, 0 hết, 1 đang phát, 2 dừng, 3 đang tải, 5 đã nạp */
  state: (): number => (yt.ready() ? player.getPlayerState() : -1),
  seek(t: number) { if (yt.ready()) player.seekTo(Math.max(0, t), true) },
  play() { if (yt.ready()) player.playVideo() },
  pause() { if (yt.ready()) player.pauseVideo() },
  toggle() { yt.playing() ? yt.pause() : yt.play() },
}
