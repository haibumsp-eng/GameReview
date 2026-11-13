import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, matches } from '../store'
import { yt } from '../youtube'
import type { SpotBox } from '../types'

/** Khung hình video (16:9) nằm trong khung player (có thể có viền đen). */
export function videoRect(W: number, H: number) {
  if (!W || !H) return { x: 0, y: 0, w: 0, h: 0 }
  if (W / H > 16 / 9) { const w = (H * 16) / 9; return { x: (W - w) / 2, y: 0, w, h: H } }
  const h = (W * 9) / 16
  return { x: 0, y: (H - h) / 2, w: W, h }
}

/**
 * Lớp khoanh cầu thủ nằm trong khung video (được quay vào file).
 * Khung CHỈ hiện khi đang dừng hình tại điểm khoanh (spotHold) hoặc khi HLV đang vẽ (spotEdit).
 * Khi quay: ảnh khung hình chụp lúc dừng phủ lên để che giao diện tạm dừng của YouTube.
 */
export function SpotlightLayer() {
  const { spotEdit, spotHold, set } = useUi(useShallow((s) => ({ spotEdit: s.spotEdit, spotHold: s.spotHold, set: s.set })))
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<SpotBox | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const r = videoRect(size.w, size.h)
  const boxes = [...(spotEdit?.boxes ?? spotHold?.boxes ?? []), ...(draft ? [draft] : [])]
  const on = !!spotEdit || !!spotHold
  const px = (b: SpotBox) => ({ x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h })

  const norm = (e: React.PointerEvent) => {
    const bb = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - bb.left) / bb.width)), y: Math.min(1, Math.max(0, (e.clientY - bb.top) / bb.height)) }
  }

  return (
    <div ref={ref} className={`spot-layer ${spotEdit ? 'editing' : ''}`}>
      {spotHold?.frame && <img className="spot-frame" src={spotHold.frame} alt="" />}
      {on && boxes.length > 0 && (
        <svg className="spot-svg" width={size.w} height={size.h}>
          <defs>
            <mask id="spot-mask">
              <rect width={size.w} height={size.h} fill="white" />
              {boxes.map((b, i) => { const p = px(b); return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={8} fill="black" /> })}
            </mask>
          </defs>
          <rect width={size.w} height={size.h} fill={spotEdit ? '#0000004d' : '#00000080'} mask="url(#spot-mask)" />
          {boxes.map((b, i) => { const p = px(b); return <rect key={i} className="spot-box" x={p.x} y={p.y} width={p.w} height={p.h} rx={8} /> })}
        </svg>
      )}
      {on && boxes.map((b, i) => {
        const p = px(b)
        return b.label ? <div key={i} className="spot-label" style={{ left: p.x + p.w / 2, top: p.y }}>{b.label}</div> : null
      })}
      {spotEdit && (
        <div
          className="spot-draw"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = norm(e); setDraft(null) }}
          onPointerMove={(e) => {
            if (!start.current) return
            const p = norm(e), s = start.current
            setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
          }}
          onPointerUp={() => {
            const d = draft
            start.current = null; setDraft(null)
            if (!d || d.w < 0.015 || d.h < 0.02 || spotEdit.boxes.length >= 3) return
            set({ spotEdit: { ...spotEdit, boxes: [...spotEdit.boxes, { ...d, label: defaultLabel(spotEdit.clipId, spotEdit.boxes.length) }] } })
          }}
        />
      )}
    </div>
  )
}

/** Tên gợi ý cho khung thứ i: lấy theo thứ tự cầu thủ đã gắn cho tình huống. */
function defaultLabel(clipId: string, i: number): string | undefined {
  const d = useData.getState()
  const c = d.clips.find((x) => x.id === clipId)
  const p = c && d.players.find((x) => x.id === c.playerIds[i])
  return p ? `#${p.number} ${p.name}` : undefined
}

/**
 * Dừng hình khi PHÁT PLAYLIST hoặc XEM THỬ (không áp dụng khi quay: bộ quay tự xử lý).
 * Mỗi tình huống chỉ dừng MỘT lần trong một lượt phát; danh sách "đã dừng" chỉ xoá khi bắt đầu lượt mới.
 */
export function SpotlightRunner() {
  const { time, playlist, rec, spotPreview, videoId, gameId, filter } = useUi(useShallow((s) => ({
    time: s.time, playlist: s.playlist, rec: s.rec, spotPreview: s.spotPreview, videoId: s.videoId, gameId: s.gameId, filter: s.filter,
  })))
  const clips = useData((s) => s.clips)
  const done = useRef(new Set<string>())
  const holding = useRef(false)
  const recording = !!rec && rec.phase !== 'done' && rec.phase !== 'error'
  const live = (playlist || !!spotPreview) && !recording

  // Lượt phát mới (bật playlist / xem thử khác) thì cho phép dừng lại từ đầu.
  useEffect(() => { done.current.clear() }, [playlist, spotPreview])

  useEffect(() => {
    if (!live || holding.current) return
    const c = clips.find((x) => x.spotlight && x.gameId === gameId && x.videoId === videoId &&
      (spotPreview ? x.id === spotPreview : matches(x, filter)) &&
      !done.current.has(x.id) && time >= x.spotlight.t - 0.05 && time < x.spotlight.t + 1)
    if (!c) return
    const sp = c.spotlight!
    done.current.add(c.id)
    holding.current = true
    yt.pause()
    useUi.getState().set({ spotHold: { boxes: sp.boxes, frame: null } })
    setTimeout(() => {
      useUi.getState().set({ spotHold: null })
      holding.current = false
      yt.play()
    }, Math.max(0.5, sp.hold) * 1000)
  }, [time, live, clips, gameId, videoId, filter, spotPreview])
  return null
}
