import { useState } from 'react'
import { exportVideo, mergeSegs } from '../lib/exportVideo'
import { fmt } from '../util'
import type { Clip } from '../types'

export function ExportModal(props: { clips: Clip[]; title: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [offset, setOffset] = useState(0)
  const [accurate, setAccurate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [frac, setFrac] = useState(0)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ url: string; size: number } | null>(null)

  const segs = mergeSegs(props.clips.map((c) => ({ start: c.start, end: c.end })))
  const total = segs.reduce((a, s) => a + (s.end - s.start), 0)

  const run = async () => {
    if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const blob = await exportVideo(file, segs, {
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
          {segs.length} đoạn, tổng {fmt(total)}. App cắt ngay trên máy bạn từ file video gốc, file không bị upload đi đâu.
        </div>

        <label className="field-label">1. Chọn file video gốc (cùng nội dung với video YouTube của trận)</label>
        <input type="file" accept="video/*" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <div className="muted">{file.name} · {(file.size / 1e6).toFixed(0)} MB</div>}

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
          <button className="btn primary" disabled={!file || busy || !segs.length} onClick={run}>{busy ? 'Đang xử lý…' : 'Bắt đầu cắt'}</button>
        )}
      </div>
    </div>
  )
}
