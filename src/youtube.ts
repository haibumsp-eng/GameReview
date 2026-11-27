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

/** Các mức chất lượng của YouTube, từ thấp tới cao. */
export const Q_ORDER = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres']
export const Q_LABEL: Record<string, string> = { tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p', hd1440: '1440p', hd2160: '2160p', highres: '4K+' }
const rank = (q: string) => Q_ORDER.indexOf(q)

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
      events: {
        onReady: () => { onReady(); setTimeout(() => yt.forceBest(), 1500) },
        // Khi bắt đầu phát, lại đề nghị chất lượng cao nhất (danh sách mức chất lượng chỉ có sau khi video bắt đầu chạy).
        onStateChange: (e: any) => { if (e?.data === 1) setTimeout(() => yt.forceBest(), 600) },
      },
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
  /** Chất lượng YouTube đang phát ('hd720'…) hoặc '' nếu chưa biết. */
  quality: (): string => { try { return yt.ready() ? String(player.getPlaybackQuality?.() ?? '') : '' } catch { return '' } },
  /** Các mức chất lượng video này có (cao xuống thấp). */
  qualities: (): string[] => { try { return ((player?.getAvailableQualityLevels?.() as string[] | undefined) ?? []).filter((q) => rank(q) >= 0).sort((a, b) => rank(b) - rank(a)) } catch { return [] } },
  /** Mức cao nhất video có, tối đa 1080p (file quay ra tối đa 1080p). */
  target: (): string => { const a = yt.qualities().filter((q) => rank(q) <= rank('hd1080')); return a[0] ?? '' },
  /** Đã đạt mức cao nhất có thể chưa. */
  reached: (): boolean => { const t = yt.target(), q = yt.quality(); return !!t && rank(q) >= rank(t) },
  /** Đề nghị YouTube phát mức cao nhất có (tối đa 1080p). YouTube coi đây là gợi ý, không phải lệnh, nên cần phát một lúc để đổi thật. */
  forceBest() {
    const q = yt.target()
    if (!q || !yt.ready()) return
    try { player.setPlaybackQualityRange?.(q, q) } catch { /* bản API không có */ }
    try { player.setPlaybackQuality?.(q) } catch { /* bản API không có */ }
  },
}
