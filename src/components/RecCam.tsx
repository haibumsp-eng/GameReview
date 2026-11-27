import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

interface RState {
  game: { title: string; home: string; away: string; period: number; clock: number; running: boolean }
  score: { home: number; away: number }
}
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)
const HOME = { bg: '#bedf00', ink: '#0b0c00' }, AWAY = { bg: '#9aa0ff', ink: '#0a0b1a' }

/** Định dạng ghi: ưu tiên MP4 (iPhone xem và lưu được ngay), không có thì WebM. */
function pickFormat(): { mime: string; ext: string } {
  const cands: [string, string][] = [['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']]
  for (const [mime, ext] of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  return { mime: '', ext: 'webm' }
}

/** Vẽ bảng tỉ số (kiểu bảng OBS, không hiệu ứng) lên canvas, ở cạnh dưới chính giữa. */
function drawBoard(ctx: CanvasRenderingContext2D, W: number, H: number, d: { home: string; away: string; hs: number; as: number; period: number; clock: number; running: boolean }) {
  const s = W / 1920
  const barH = 84 * s, y = H - 84 * s - 28 * s, nameW = 290 * s, scoreW = 96 * s, midW = 170 * s
  const total = nameW * 2 + scoreW * 2 + midW
  let x = (W - total) / 2
  const rr = (px: number, w: number, fill: string, r: [number, number, number, number]) => {
    ctx.fillStyle = fill; ctx.beginPath()
    ctx.moveTo(px + r[0], y); ctx.lineTo(px + w - r[1], y); ctx.quadraticCurveTo(px + w, y, px + w, y + r[1])
    ctx.lineTo(px + w, y + barH - r[2]); ctx.quadraticCurveTo(px + w, y + barH, px + w - r[2], y + barH)
    ctx.lineTo(px + r[3], y + barH); ctx.quadraticCurveTo(px, y + barH, px, y + barH - r[3])
    ctx.lineTo(px, y + r[0]); ctx.quadraticCurveTo(px, y, px + r[0], y); ctx.fill()
  }
  const font = (size: number, weight: number) => `${weight} ${size}px "Archivo Variable", "Archivo", system-ui, sans-serif`
  const fit = (text: string, maxW: number, size: number, weight: number) => {
    let sz = size
    ctx.font = font(sz, weight)
    while (sz > 10 * s && ctx.measureText(text).width > maxW) { sz -= 1 * s; ctx.font = font(sz, weight) }
  }
  const r = 12 * s
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const name = (px: number, t: string, color: string, left: boolean) => {
    rr(px, nameW, '#0b0b0cee', left ? [r, 0, 0, r] : [0, r, r, 0])
    ctx.fillStyle = color; ctx.fillRect(px, y, nameW, 5 * s)
    ctx.fillStyle = '#fff'; fit(t.toUpperCase(), nameW - 40 * s, 30 * s, 800)
    ctx.fillText(t.toUpperCase(), px + nameW / 2, y + barH / 2 + 3 * s)
  }
  const score = (px: number, n: number, c: { bg: string; ink: string }) => {
    rr(px, scoreW, c.bg, [0, 0, 0, 0])
    ctx.fillStyle = c.ink; ctx.font = font(60 * s, 900); ctx.fillText(String(n), px + scoreW / 2, y + barH / 2 + 3 * s)
  }
  name(x, d.home, HOME.bg, true); x += nameW
  score(x, d.hs, HOME); x += scoreW
  rr(x, midW, '#16161a', [0, 0, 0, 0])
  ctx.fillStyle = '#ffffffb3'; ctx.font = font(15 * s, 700); ctx.fillText(qLabel(d.period), x + midW / 2, y + 22 * s)
  ctx.fillStyle = d.running ? '#bedf00' : '#fff'; ctx.font = font(38 * s, 700); ctx.fillText(mmss(d.clock), x + midW / 2, y + 54 * s)
  x += midW
  score(x, d.as, AWAY); x += scoreW
  name(x, d.away, AWAY.bg, false)
  // viền ngoài mảnh cho giống bảng OBS
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 2 * s
  ctx.beginPath(); ctx.roundRect?.((W - total) / 2, y, total, barH, r); ctx.stroke()
}

interface Take { id: number; label: string; url: string; size: number; ext: string; blob: Blob }

/**
 * Điện thoại quay hình (iPhone): dùng camera sau, vẽ bảng tỉ số lên hình rồi quay luôn thành file, mỗi hiệp một file.
 * Mở bằng #rec=<mã QR>. Tỉ số và đồng hồ lấy từ trận đang bấm.
 */
export function RecCam({ token }: { token: string }) {
  const [st, setSt] = useState<RState | null>(null)
  const [err, setErr] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [res, setRes] = useState<'720' | '1080'>('1080')
  const [camErr, setCamErr] = useState('')
  const [rec, setRec] = useState<{ since: number; label: string } | null>(null)
  const [takes, setTakes] = useState<Take[]>([])
  const [hidden, setHidden] = useState(false)
  const [, tick] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const stRef = useRef<RState | null>(null)
  const fetchedAt = useRef(Date.now())
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const wake = useRef<{ release: () => Promise<void> } | null>(null)
  const seq = useRef(0)
  const fmt = useRef(pickFormat())

  // Tỉ số / đồng hồ của trận.
  useEffect(() => {
    let live = true
    const load = async () => {
      const t0 = Date.now()
      const { data, error } = await supabase.rpc('cam_state', { p_token: token })
      const t1 = Date.now()
      if (!live) return
      if (error) return setErr('Mất kết nối, bảng tỉ số có thể chưa mới.')
      if ((data as { error?: string })?.error) return setErr((data as { error: string }).error)
      setErr(''); fetchedAt.current = (t0 + t1) / 2; stRef.current = data as RState; setSt(data as RState)
    }
    void load()
    const iv = setInterval(() => { void load() }, 1500)
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => { live = false; clearInterval(iv); clearInterval(t) }
  }, [token])

  // Camera.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      stream.current?.getTracks().forEach((t) => t.stop())
      setCamErr('')
      try {
        const [w, h] = res === '1080' ? [1920, 1080] : [1280, 720]
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } }, audio: true })
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
      } catch (e) {
        setCamErr(e instanceof Error ? `${e.name}: ${e.message}` : 'Không mở được camera. Hãy cho phép dùng camera và micro cho trang này.')
      }
    })()
    return () => { cancelled = true }
  }, [facing, res])

  // Vòng vẽ: hình camera + bảng tỉ số.
  useEffect(() => {
    let raf = 0, live = true
    const loop = () => {
      if (!live) return
      const c = canvas.current, v = video.current
      if (c && v && v.videoWidth) {
        const W = res === '1080' ? 1920 : 1280, H = res === '1080' ? 1080 : 720
        if (c.width !== W) { c.width = W; c.height = H }
        const ctx = c.getContext('2d')!
        // phủ kín khung 16:9 (cắt phần thừa nếu camera khác tỉ lệ)
        const sr = v.videoWidth / v.videoHeight, dr = W / H
        let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0
        if (sr > dr) { sw = sh * dr; sx = (v.videoWidth - sw) / 2 } else { sh = sw / dr; sy = (v.videoHeight - sh) / 2 }
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H)
        const g = stRef.current
        if (g) {
          const clk = g.game.running ? Math.max(0, g.game.clock - (Date.now() - fetchedAt.current) / 1000) : g.game.clock
          drawBoard(ctx, W, H, { home: g.game.home, away: g.game.away, hs: g.score.home, as: g.score.away, period: g.game.period, clock: clk, running: g.game.running })
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { live = false; cancelAnimationFrame(raf) }
  }, [res])

  // Cảnh báo khi màn hình bị che / app chuyển nền (iPhone sẽ dừng quay).
  useEffect(() => {
    const f = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])

  const start = async () => {
    const c = canvas.current, s = stream.current
    if (!c || !s || !st) return
    const label = `Hiệp ${qLabel(st.game.period).replace('Q', '').replace('OT', 'OT')}`
    const out = new MediaStream([...c.captureStream(30).getVideoTracks(), ...s.getAudioTracks()])
    const mr = new MediaRecorder(out, { ...(fmt.current.mime ? { mimeType: fmt.current.mime } : {}), videoBitsPerSecond: res === '1080' ? 10_000_000 : 5_000_000 })
    chunks.current = []
    mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(chunks.current, { type: fmt.current.mime || 'video/webm' })
      chunks.current = []
      const url = URL.createObjectURL(blob)
      setTakes((t) => [{ id: ++seq.current, label, url, size: blob.size, ext: fmt.current.ext, blob }, ...t])
      void wake.current?.release().catch(() => {}); wake.current = null
    }
    mr.start(2000)
    recorder.current = mr
    try { wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* không bắt buộc */ }
    setRec({ since: Date.now(), label })
  }
  const stop = () => { recorder.current?.stop(); recorder.current = null; setRec(null) }

  const fileName = (t: Take) => `${(st?.game.title ?? 'tran-dau').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${t.label.replace(/\s+/g, '-')}.${t.ext}`
  const save = async (t: Take) => {
    const file = new File([t.blob], fileName(t), { type: t.blob.type })
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: t.label }); return } catch (e) { if ((e as Error).name === 'AbortError') return }
    }
    const a = document.createElement('a'); a.href = t.url; a.download = fileName(t); document.body.appendChild(a); a.click(); a.remove()
  }
  const drop = (t: Take) => { URL.revokeObjectURL(t.url); setTakes((l) => l.filter((x) => x.id !== t.id)) }

  const elapsed = rec ? Math.floor((Date.now() - rec.since) / 1000) : 0
  const recMB = rec ? chunks.current.reduce((a, c) => a + c.size, 0) / 1e6 : 0
  const period = st ? qLabel(st.game.period) : '…'

  return (
    <div className="rc">
      <video ref={video} className="rc-src" playsInline muted autoPlay />
      <canvas ref={canvas} className="rc-view" width={1280} height={720} />
      <div className="rc-top">
        {rec ? <span className="rc-live"><i /> ĐANG QUAY {rec.label} · {mmss(elapsed)} · {recMB.toFixed(0)} MB</span> : <span className="rc-idle">Sẵn sàng · {period}</span>}
        {err && <span className="rc-err">{err}</span>}
        {rec && hidden && <span className="rc-err">Màn hình đang bị che: iPhone có thể dừng quay!</span>}
      </div>
      {camErr && <div className="rc-camerr">{camErr}</div>}
      <div className="rc-bar">
        <div className="rc-side">
          <button disabled={!!rec} onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>⟲ Đổi camera</button>
          <button disabled={!!rec} onClick={() => setRes(res === '720' ? '1080' : '720')}>{res === '720' ? '720p' : '1080p'}</button>
        </div>
        {rec
          ? <button className="rc-rec stop" onClick={stop}>■ DỪNG · {rec.label}</button>
          : <button className="rc-rec" disabled={!stream.current || !st || !!camErr} onClick={() => void start()}>● QUAY {period.replace('Q', 'HIỆP ')}</button>}
        <div className="rc-side right">{takes.length > 0 && <span>{takes.length} file</span>}</div>
      </div>
      {takes.length > 0 && (
        <div className="rc-takes">
          <b>Video đã quay (nhớ lưu về máy)</b>
          {takes.map((t) => (
            <div key={t.id} className="rc-take">
              <span>{t.label} · {(t.size / 1e6).toFixed(1)} MB</span>
              <button className="save" onClick={() => void save(t)}>⬇ Lưu video</button>
              <button onClick={() => drop(t)}>Xoá</button>
            </div>
          ))}
          <small>Bấm “Lưu video”, chọn “Lưu vào Tệp” hoặc “Lưu video”. Chỉ xoá khỏi bộ nhớ sau khi đã lưu xong.</small>
        </div>
      )}
    </div>
  )
}
