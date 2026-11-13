import { useState } from 'react'
import { exportVideo, mergeSegs } from '../lib/exportVideo'
import { canRecord, pickFormat, runRecording, startCapture } from '../lib/recordScreen'
import { useUi, setCaption, type Corner } from '../store'
import { fmt } from '../util'
import type { Clip, GameVideo } from '../types'

export function ExportModal(props: { clips: Clip[]; videos: GameVideo[]; title: string; onClose: () => void }) {
  const [mode, setMode] = useState<'record' | 'file'>(canRecord() ? 'record' : 'file')
  const caption = useUi((s) => s.caption)
  const [recErr, setRecErr] = useState('')
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

  // Thứ tự quay: theo hiệp rồi theo thời gian; gộp đoạn chồng nhau.
  const recClips = groups.flatMap((g) => g.segs.map((sg, i) => ({
    ...props.clips.find((c) => c.videoId === g.video.id)!, id: `${g.video.id}-${i}`, start: sg.start, end: sg.end,
    // Điểm khoanh của các tình huống nằm trong đoạn này: dừng hình đúng một lần tại mỗi điểm.
    spots: props.clips.filter((c) => c.videoId === g.video.id && c.spotlight && c.spotlight.t >= sg.start && c.spotlight.t < sg.end).map((c) => c.spotlight!),
  })))
  const holdTotal = recClips.reduce((a, c) => a + c.spots.reduce((x, s) => x + s.hold, 0), 0)

  const startRec = async () => {
    setRecErr('')
    const el = document.querySelector('.video-wrap') as HTMLElement | null
    if (!el) return setRecErr('Không tìm thấy khung video. Hãy mở trận trước.')
    try {
      const stream = await startCapture(el) // phải gọi ngay trong lần bấm nút
      useUi.getState().set({ playlist: false, clipId: null, rec: { phase: 'waiting', index: 0, total: recClips.length, remain: total, msg: 'Chuẩn bị…' } })
      props.onClose() // đóng cửa sổ để không bị quay vào
      runRecording(stream, recClips, props.title)
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : String(e))
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

        <div className="seg-toggle">
          <button className={mode === 'record' ? 'on' : ''} onClick={() => setMode('record')}>Quay lại từ YouTube (không cần file)</button>
          <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>Cắt từ file gốc</button>
        </div>

        {mode === 'record' ? (
          <div className="stack">
            {!canRecord() && <div className="err">Trình duyệt này không quay được. Hãy dùng Chrome hoặc Edge trên máy tính.</div>}
            <div className="card stack rec-notes">
              <b>Trước khi quay, hãy kiểm tra:</b>
              <ol>
                <li><b>Wifi ổn định</b> (tốt nhất cắm dây mạng). Mạng yếu thì YouTube tự giảm độ nét và video quay ra sẽ mờ.</li>
                <li>Dùng <b>Chrome hoặc Edge trên máy tính</b>.</li>
                <li>Khi trình duyệt hỏi, chọn <b>đúng tab này</b> và để bật <b>“Chia sẻ âm thanh”</b>.</li>
                <li><b>Không thu nhỏ cửa sổ</b>, không rê chuột lên video trong lúc quay.</li>
                <li>Thời gian quay bằng độ dài video: khoảng <b>{fmt(total + holdTotal)}</b>. Nếu bạn chuyển sang tab khác, app <b>tự tạm dừng</b> và ghi tiếp khi bạn quay lại.</li>
              </ol>
              <div className="muted">File sẽ là .{pickFormat().ext}{pickFormat().ext === 'mp4' ? ' (xem được trên điện thoại)' : ' (xem tốt trên máy tính)'}.</div>
            </div>
            <div className="card stack">
              <label className="row tight">
                <input type="checkbox" checked={caption.on} onChange={(e) => setCaption({ ...caption, on: e.target.checked })} />
                <b>Hiện nhận xét của HLV trong video</b>
              </label>
              {caption.on && (
                <div className="caption-pick">
                  <div className="caption-frame">
                    <span className="caption-frame-hint">Chọn góc không che bảng tỉ số / tình huống</span>
                    {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((pos) => (
                      <button key={pos} className={`corner corner-${pos} ${caption.pos === pos ? 'on' : ''}`} onClick={() => setCaption({ ...caption, pos })}>
                        {caption.pos === pos ? 'Nhận xét ở đây' : ''}
                      </button>
                    ))}
                  </div>
                  <div className="muted small-note">Mẹo: bấm “▶ Phát” danh sách ở module Tình huống để xem trước vị trí trên video thật.</div>
                </div>
              )}
            </div>
            {recErr && <div className="err">{recErr}</div>}
            <button className="btn primary" disabled={!canRecord() || !count} onClick={startRec}>● Bắt đầu quay</button>
          </div>
        ) : (
          <div className="stack">
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
        )}
      </div>
    </div>
  )
}
