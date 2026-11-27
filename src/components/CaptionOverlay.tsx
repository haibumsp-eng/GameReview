import { useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, matches, playerLabel } from '../store'
import type { Clip } from '../types'

/** Cỡ chữ (đơn vị cqw = % bề rộng khung video) để toàn bộ lời nhận xét vừa khít khung video, dài bao nhiêu cũng hiện đủ. */
export function introFontCqw(noteLen: number): number {
  return Math.max(0.8, Math.min(3.4, Math.sqrt(4600 / (noteLen + 110))))
}

function Head({ c }: { c: Clip }) {
  const who = c.teamWide ? 'Cả đội' : c.playerIds.map((id) => playerLabel(id)).filter(Boolean).join(', ')
  return (
    <div className="caption-head">
      <span className={`caption-side ${c.side}`}>{c.side === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'}</span>
      {who && <span className="caption-who">{who}</span>}
      {c.playType && <span className="caption-type">{c.playType}</span>}
    </div>
  )
}

/** Thẻ nhận xét đầy đủ lúc dừng hình: chữ tự co đến cỡ lớn nhất mà vẫn hiện hết trong khung video (đo thật, mọi tỉ lệ khung). */
function IntroCard({ c }: { c: Clip }) {
  const box = useRef<HTMLDivElement>(null)
  const note = useRef<HTMLDivElement>(null)
  const text = c.note.trim()
  useLayoutEffect(() => {
    const b = box.current, n = note.current, host = b?.parentElement
    if (!b || !n || !host) return
    const fit = () => {
      let lo = 7, hi = Math.min(host.clientWidth * 0.019, host.clientHeight * 0.055, 30)
      if (hi <= lo) { n.style.fontSize = `${lo}px`; return }
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2
        n.style.fontSize = `${mid}px`
        if (b.scrollHeight <= b.clientHeight + 1) lo = mid; else hi = mid
      }
      n.style.fontSize = `${lo}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    return () => ro.disconnect()
  }, [text])
  return (
    <div className="caption-intro" ref={box}>
      <Head c={c} />
      {text && <div className="caption-intro-note" ref={note}>{text}</div>}
    </div>
  )
}

/**
 * Thẻ nhận xét của HLV trên video (nằm trong khung được quay nên có trong file video).
 * - Lúc DỪNG ở khung đầu của tình huống: hiện ĐẦY ĐỦ lời nhận xét, cỡ chữ tự co để vừa khung video.
 * - Lúc tình huống đang chạy: thẻ ở 1 trong 4 góc, thu gọn / giữ nguyên / ẩn theo cài đặt.
 * Chỉ hiện khi đang quay hoặc đang phát playlist.
 */
export function CaptionOverlay() {
  const { caption, rec, playlist, gameId, videoId, time, filter, hold } = useUi(useShallow((s) => ({
    caption: s.caption, rec: s.rec, playlist: s.playlist, gameId: s.gameId, videoId: s.videoId, time: s.time, filter: s.filter, hold: s.captionHold,
  })))
  const clips = useData((s) => s.clips)
  const recording = !!rec && (rec.phase === 'recording' || rec.phase === 'waiting')
  if (!caption.on || !(recording || playlist)) return null

  // Đang dừng để đọc: hiện đầy đủ ở giữa khung video.
  if (hold) {
    const c = clips.find((x) => x.id === hold.clipId)
    if (c) {
      return <IntroCard c={c} />
    }
  }

  if (caption.after === 'hide') return null
  // Tình huống đang phát: khớp bộ lọc, cùng hiệp, chứa thời điểm hiện tại (ưu tiên cái bắt đầu muộn nhất).
  const c = clips
    .filter((x) => x.gameId === gameId && x.videoId === videoId && matches(x, filter) && x.start <= time + 0.2 && time <= x.end + 0.2)
    .sort((a, b) => b.start - a.start)[0]
  if (!c) return null

  return (
    <div className={`caption caption-${caption.pos}`}>
      <Head c={c} />
      {caption.after === 'full' && c.note && <div className="caption-note">{c.note}</div>}
    </div>
  )
}
