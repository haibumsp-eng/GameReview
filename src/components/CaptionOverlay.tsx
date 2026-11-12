import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, matches } from '../store'

/**
 * Thẻ nhận xét của HLV đặt ở 1 trong 4 góc khung video.
 * Nằm bên trong khung được quay nên sẽ xuất hiện trong file video.
 * Chỉ hiện khi đang quay hoặc đang phát playlist, và khi thời điểm hiện tại thuộc một tình huống.
 */
export function CaptionOverlay() {
  const { caption, rec, playlist, gameId, videoId, time, filter } = useUi(useShallow((s) => ({
    caption: s.caption, rec: s.rec, playlist: s.playlist, gameId: s.gameId, videoId: s.videoId, time: s.time, filter: s.filter,
  })))
  const clips = useData((s) => s.clips)
  const players = useData((s) => s.players)
  const recording = !!rec && (rec.phase === 'recording' || rec.phase === 'waiting')
  if (!caption.on || !(recording || playlist)) return null

  // Tình huống đang phát: khớp bộ lọc, cùng hiệp, chứa thời điểm hiện tại (ưu tiên cái bắt đầu muộn nhất).
  const c = clips
    .filter((x) => x.gameId === gameId && x.videoId === videoId && matches(x, filter) && x.start <= time + 0.2 && time <= x.end + 0.2)
    .sort((a, b) => b.start - a.start)[0]
  if (!c) return null

  const who = c.teamWide ? 'Cả đội' : c.playerIds
    .map((id) => players.find((p) => p.id === id)).filter(Boolean)
    .map((p) => `#${p!.number} ${p!.name}`).join(', ')

  return (
    <div className={`caption caption-${caption.pos}`}>
      <div className="caption-head">
        <span className={`caption-side ${c.side}`}>{c.side === 'ATK' ? 'TẤN CÔNG' : 'PHÒNG THỦ'}</span>
        {who && <span className="caption-who">{who}</span>}
        {c.playType && <span className="caption-type">{c.playType}</span>}
      </div>
      {c.note && <div className="caption-note">{c.note}</div>}
    </div>
  )
}
