import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData, useUi, matches } from '../store'
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
 * Video KHÔNG dừng: khung chỉ hiện khi thời gian video nằm trong [t, t + hold] của tình huống.
 * Hiện khi phát playlist, khi quay, khi xem thử, hoặc khi đang chọn đúng tình huống đó.
 * Khi HLV đang vẽ: kéo chuột để tạo khung.
 */
export function SpotlightLayer() {
  const { spotEdit, set, time, gameId, videoId, filter, playlist, rec, spotPreview, clipId } = useUi(useShallow((s) => ({
    spotEdit: s.spotEdit, set: s.set, time: s.time, gameId: s.gameId, videoId: s.videoId, filter: s.filter,
    playlist: s.playlist, rec: s.rec, spotPreview: s.spotPreview, clipId: s.clipId,
  })))
  const clips = useData((s) => s.clips)
  const listMode = playlist || (!!rec && (rec.phase === 'recording' || rec.phase === 'waiting'))
  const shown = spotEdit ? undefined : clips.find((c) => {
    const sp = c.spotlight
    if (!sp || c.gameId !== gameId || c.videoId !== videoId) return false
    const mine = spotPreview ? c.id === spotPreview : listMode ? matches(c, filter) : c.id === clipId
    return mine && time >= sp.t - 0.05 && time <= sp.t + sp.hold
  })
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
  const boxes = [...(spotEdit?.boxes ?? shown?.spotlight?.boxes ?? []), ...(draft ? [draft] : [])]
  const on = !!spotEdit || !!shown
  const px = (b: SpotBox) => ({ x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h })

  const norm = (e: React.PointerEvent) => {
    const bb = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - bb.left) / bb.width)), y: Math.min(1, Math.max(0, (e.clientY - bb.top) / bb.height)) }
  }

  return (
    <div ref={ref} className={`spot-layer ${spotEdit ? 'editing' : ''}`}>
      {on && boxes.length > 0 && (
        <svg className="spot-svg" width={size.w} height={size.h}>
          <defs>
            <mask id="spot-mask">
              <rect width={size.w} height={size.h} fill="white" />
              {boxes.map((b, i) => { const p = px(b); return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={8} fill="black" /> })}
            </mask>
          </defs>
          <rect width={size.w} height={size.h} fill={spotEdit ? '#0000004d' : '#00000066'} mask="url(#spot-mask)" />
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
