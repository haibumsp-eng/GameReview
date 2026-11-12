import { useState } from 'react'
import { exportVideo, mergeSegs } from '../lib/exportVideo'
import { fmt } from '../util'
import type { Clip, GameVideo } from '../types'

export function ExportModal(props: { clips: Clip[]; videos: GameVideo[]; title: string; onClose: () => void }) {
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [offset, setOffset] = useState(0)
  const [accurate, setAccurate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [frac, setFrac] = useState(0)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ url: string; size: number } | null>(null)

  // Chỉ cần file cho những hiệp có tình huống được chọn.
  const groups = [...props.videos]
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ video: v, segs: mergeSegs(props.clips.filter((c) => c.videoId === v.id).map((c) => ({ start: c.start, end: c.end }))) }))
    .filter((g) => g.segs.length)
  const total = groups.reduce((a, g) => a + g.segs.reduce((x, s) => x + (s.end - s.start), 0), 0)
  const count = groups.reduce((a, g) => a + g.segs.length, 0)
  const ready = groups.length > 0 && groups.every((g) => files[g.video.id])

  const run = async () => {
    setBusy(true); setErr(''); setResult(null)
    try {
      const blob = await exportVideo(groups.map((g) => ({ file: files[g.video.id]!, segs: g.segs })), {
        offset, accurate,
        onProgress: (m, f) => { setMsg(m); setFrac(f) },
      })
      setResult({ url: URL.createObjectURL(blob), size: blob.size })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const safe = props.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'playlist'

  return (
    <div className="modal-back" onClick={() => !busy && props.onClose()}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b className="grow">Tải video: {props.title}</b>
          <button className="icon-btn" disabled={busy} onClick={props.onClose}>×</button>
        </div>
        <div className="muted">
          {count} đoạn, tổng {fmt(total)}. App cắt ngay trên máy bạn từ file video gốc, file không bị upload đi đâu.
        </div>

        <label className="field-label">1. Chọn file video gốc của từng hiệp (cùng nội dung với video YouTube)</label>
        {groups.map((g) => (
          <div key={g.video.id} className="stack">
            <div className="row"><b>{g.video.label}</b><span className="muted">{g.segs.length} đoạn</span></div>
            <input type="file" accept="video/*" disabled={busy} onChange={(e) => setFiles({ ...files, [g.video.id]: e.target.files?.[0] })} />
            {files[g.video.id] && <div className="muted">{files[g.video.id]!.name} · {(files[g.video.id]!.size / 1e6).toFixed(0)} MB</div>}
          </div>
        ))}

        <label className="field-label">2. Lệch thời gian (giây), nếu file gốc dài/ngắn hơn bản YouTube</label>
        <input type="number" step="0.5" value={offset} disabled={busy} onChange={(e) => setOffset(+e.target.value)} />

        <label className="row tight">
          <input type="checkbox" style={{ width: 'auto' }} checked={accurate} disabled={busy} onChange={(e) => setAccurate(e.target.checked)} />
          <span>Cắt chính xác từng giây (nén lại, chậm hơn rất nhiều)</span>
        </label>
        <div className="muted">Mặc định cắt nhanh: giữ nguyên chất lượng nhưng đầu đoạn có thể sớm hơn vài giây.</div>

        {busy && (
          <div className="stack">
            <div className="bar"><div style={{ width: `${Math.round(frac * 100)}%` }} /></div>
            <div className="muted">{msg}</div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
        {result ? (
          <a className="btn primary" href={result.url} download={`${safe}.mp4`}>⬇ Tải file ({(result.size / 1e6).toFixed(1)} MB)</a>
        ) : (
          <button className="btn primary" disabled={!ready || busy} onClick={run}>{busy ? 'Đang xử lý…' : 'Bắt đầu cắt'}</button>
        )}
      </div>
    </div>
  )
}
