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

type BoardData = { home: string; away: string; hs: number; as: number; period: number; clock: number; running: boolean }
/**
 * Vẽ bảng tỉ số (kiểu bảng OBS, không hiệu ứng) vào một canvas NHỎ riêng. Chỉ vẽ lại khi số liệu đổi (mỗi giây một lần),
 * còn mỗi khung hình chỉ dán canvas nhỏ này lên hình: nhẹ hơn nhiều, máy đỡ nóng.
 */
function renderBoard(c: HTMLCanvasElement, W: number, d: BoardData) {
  const s = W / 1920
  const pad = Math.ceil(3 * s), barH = 84 * s, nameW = 290 * s, scoreW = 96 * s, midW = 170 * s
  const total = nameW * 2 + scoreW * 2 + midW
  c.width = Math.ceil(total + pad * 2); c.height = Math.ceil(barH + pad * 2)
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  const y = pad
  let x = pad
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
  const score = (px: number, n: number, c2: { bg: string; ink: string }) => {
    rr(px, scoreW, c2.bg, [0, 0, 0, 0])
    ctx.fillStyle = c2.ink; ctx.font = font(60 * s, 900); ctx.fillText(String(n), px + scoreW / 2, y + barH / 2 + 3 * s)
  }
  name(x, d.home, HOME.bg, true); x += nameW
  score(x, d.hs, HOME); x += scoreW
  rr(x, midW, '#16161a', [0, 0, 0, 0])
  ctx.fillStyle = '#ffffffb3'; ctx.font = font(15 * s, 700); ctx.fillText(qLabel(d.period), x + midW / 2, y + 22 * s)
  ctx.fillStyle = d.running ? '#bedf00' : '#fff'; ctx.font = font(38 * s, 700); ctx.fillText(mmss(d.clock), x + midW / 2, y + 54 * s)
  x += midW
  score(x, d.as, AWAY); x += scoreW
  name(x, d.away, AWAY.bg, false)
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 2 * s
  ctx.beginPath(); ctx.roundRect?.(pad, y, total, barH, r); ctx.stroke()
}

/** Ba mức chất lượng: gọn (file nhẹ, ít nóng) / cân bằng / nét (số áo rõ nhất, file nặng và máy nóng hơn). bps = tốc độ dữ liệu mục tiêu. */
const PRESETS = {
  eco: { label: 'Gọn · 720p', w: 1280, h: 720, fps: 25, bps: 2_500_000 },
  bal: { label: 'Cân bằng · 1080p', w: 1920, h: 1080, fps: 30, bps: 5_000_000 },
  hi: { label: 'Nét · 1080p', w: 1920, h: 1080, fps: 30, bps: 8_000_000 },
} as const
type Q = keyof typeof PRESETS

interface Take { id: number; label: string; url: string; size: number; ext: string; blob: Blob; name?: string }

/** Tên file chỉ dùng chữ không dấu (ổ lưu trữ của trình duyệt không nhận chữ có dấu ổn định). */
const slug = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')

/* ---- Ghi xuống ổ lưu trữ (OPFS) qua worker ---- */
const hasOpfs = () => typeof Worker !== 'undefined' && !!(navigator as unknown as { storage?: { getDirectory?: unknown } }).storage?.getDirectory
interface Disk { write: (buf: ArrayBuffer) => Promise<void>; close: () => Promise<void>; q: Promise<void> }
function openDisk(name: string): Promise<Disk> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./recWriter.worker.ts', import.meta.url), { type: 'module' })
    let n = 0
    const waits = new Map<number, { ok: () => void; bad: (e: Error) => void }>()
    w.onmessage = (e) => {
      const m = e.data, h = waits.get(m.id)
      if (!h) return
      waits.delete(m.id)
      if (m.t === 'error') h.bad(new Error(m.msg)); else h.ok()
    }
    w.onerror = () => reject(new Error('worker lỗi'))
    const call = (msg: Record<string, unknown>, tr: Transferable[] = []) => new Promise<void>((ok, bad) => { const id = ++n; waits.set(id, { ok, bad }); w.postMessage({ ...msg, id }, tr) })
    const timer = setTimeout(() => reject(new Error('quá thời gian mở ổ lưu trữ')), 4000)
    call({ t: 'open', name }).then(() => {
      clearTimeout(timer)
      resolve({ q: Promise.resolve(), write: (buf) => call({ t: 'write', buf }, [buf]), close: () => call({ t: 'close' }).finally(() => w.terminate()) })
    }, (e) => { clearTimeout(timer); w.terminate(); reject(e) })
  })
}
async function opfsDir() { const root = await (navigator as unknown as { storage: { getDirectory: () => Promise<any> } }).storage.getDirectory(); return root.getDirectoryHandle('rec', { create: true }) }
async function opfsFile(name: string): Promise<File> { return (await (await opfsDir()).getFileHandle(name)).getFile() }
async function opfsRemove(name: string) { try { await (await opfsDir()).removeEntry(name) } catch { /* đã xoá */ } }
async function opfsList(): Promise<File[]> {
  if (!hasOpfs()) return []
  try {
    const out: File[] = []
    for await (const [, h] of (await opfsDir()).entries()) if (h.kind === 'file') out.push(await h.getFile())
    return out
  } catch { return [] }
}

/**
 * Điện thoại quay hình (iPhone): dùng camera sau, vẽ bảng tỉ số lên hình rồi quay luôn thành file, mỗi hiệp một file.
 * Mở bằng #rec=<mã QR>. Tỉ số và đồng hồ lấy từ trận đang bấm.
 */
export function RecCam({ token }: { token: string }) {
  const [st, setSt] = useState<RState | null>(null)
  const [err, setErr] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [q, setQ] = useState<Q>('bal')
  const [dark, setDark] = useState(false) // tối màn hình (OLED đen = đỡ nóng, đỡ hao pin), chạm để bật lại
  const board = useRef<{ c: HTMLCanvasElement; key: string }>({ c: document.createElement('canvas'), key: '' })
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
  const recBytes = useRef(0)
  const rate = useRef<{ t: number; b: number }[]>([]) // dung lượng theo thời gian, để hiện tốc độ dữ liệu thực tế
  const [diskMode, setDiskMode] = useState(false)
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
        const { w, h } = PRESETS[q]
        // 30 khung hình/giây là đủ xem số áo; không xin 60 để máy đỡ nóng.
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: PRESETS[q].fps, max: PRESETS[q].fps } }, audio: true })
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}) }
      } catch (e) {
        setCamErr(e instanceof Error ? `${e.name}: ${e.message}` : 'Không mở được camera. Hãy cho phép dùng camera và micro cho trang này.')
      }
    })()
    return () => { cancelled = true }
  }, [facing, q])

  // Vòng vẽ: chỉ vẽ khi camera có khung hình MỚI (tối đa 30 lần/giây, không theo tần số quét màn hình 60-120Hz),
  // bảng tỉ số là một canvas nhỏ vẽ sẵn, mỗi khung chỉ dán lên.
  useEffect(() => {
    let live = true, timer = 0
    const draw = () => {
      const c = canvas.current, v = video.current
      if (!c || !v || !v.videoWidth) return
      const { w: W, h: H } = PRESETS[q]
      if (c.width !== W) { c.width = W; c.height = H }
      const ctx = c.getContext('2d', { alpha: false })!
      // phủ kín khung 16:9 (cắt phần thừa nếu camera khác tỉ lệ)
      const sr = v.videoWidth / v.videoHeight, dr = W / H
      let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0
      if (sr > dr) { sw = sh * dr; sx = (v.videoWidth - sw) / 2 } else { sh = sw / dr; sy = (v.videoHeight - sh) / 2 }
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H)
      const g = stRef.current
      if (g) {
        const clk = g.game.running ? Math.max(0, g.game.clock - (Date.now() - fetchedAt.current) / 1000) : g.game.clock
        const d: BoardData = { home: g.game.home, away: g.game.away, hs: g.score.home, as: g.score.away, period: g.game.period, clock: Math.floor(clk), running: g.game.running }
        const key = `${W}|${d.home}|${d.away}|${d.hs}|${d.as}|${d.period}|${d.clock}|${d.running}`
        if (key !== board.current.key) { renderBoard(board.current.c, W, d); board.current.key = key }
        const bc = board.current.c
        ctx.drawImage(bc, (W - bc.width) / 2, H - bc.height - (28 * W) / 1920)
      }
    }
    type V = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    const tickLoop = () => {
      if (!live) return
      draw()
      const v = video.current as V | null
      if (v?.requestVideoFrameCallback) v.requestVideoFrameCallback(tickLoop)
      else timer = window.setTimeout(tickLoop, 33)
    }
    tickLoop()
    return () => { live = false; clearTimeout(timer) }
  }, [q])

  // Video đã quay nhưng chưa lưu (tải lại trang, treo, đóng nhầm): còn nằm trong ổ lưu trữ nên khôi phục lại để lưu.
  useEffect(() => {
    void opfsList().then((files) => {
      if (!files.length) return
      setTakes((cur) => [...cur, ...files.filter((f) => !cur.some((t) => t.name === f.name)).map((f) => {
        const m = f.name.match(/_(Hiep-[^_]+)_/)
        return { id: ++seq.current, label: m ? m[1].replace('Hiep-', 'Hiệp ') : 'Video cũ', url: URL.createObjectURL(f), size: f.size, ext: f.name.split('.').pop() ?? 'mp4', blob: f, name: f.name }
      })])
    })
  }, [])

  // Cảnh báo khi màn hình bị che / app chuyển nền (iPhone sẽ dừng quay).
  useEffect(() => {
    const f = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])

  const baseName = () => slug(st?.game.title ?? 'tran-dau') || 'tran-dau'
  const start = async () => {
    const c = canvas.current, s = stream.current
    if (!c || !s || !st) return
    const label = `Hiệp ${qLabel(st.game.period).replace('Q', '')}`
    const out = new MediaStream([...c.captureStream(PRESETS[q].fps).getVideoTracks(), ...s.getAudioTracks()])
    const mr = new MediaRecorder(out, { ...(fmt.current.mime ? { mimeType: fmt.current.mime } : {}), videoBitsPerSecond: PRESETS[q].bps, audioBitsPerSecond: 96_000, bitsPerSecond: PRESETS[q].bps + 96_000 })
    // Ưu tiên ghi thẳng xuống ổ lưu trữ của điện thoại (quay được hiệp dài 30 phút, không đầy RAM); không được thì giữ trong bộ nhớ.
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    const name = `${baseName()}_${slug(label)}_${stamp}.${fmt.current.ext}`
    let disk: Disk | null = null
    if (hasOpfs()) { try { disk = await openDisk(name) } catch (e) { console.warn('Không ghi được xuống ổ lưu trữ, dùng RAM:', e); disk = null } }
    setDiskMode(!!disk)
    chunks.current = []; recBytes.current = 0; rate.current = []
    mr.ondataavailable = (e) => {
      if (!e.data.size) return
      recBytes.current += e.data.size
      rate.current.push({ t: Date.now(), b: recBytes.current })
      if (disk) { const d = disk; d.q = d.q.then(async () => d.write(await e.data.arrayBuffer())) } else chunks.current.push(e.data)
    }
    mr.onstop = async () => {
      let take: Take
      if (disk) {
        try { await disk.q; await disk.close() } catch { /* sẽ báo ở dưới nếu file lỗi */ }
        const file = await opfsFile(name)
        take = { id: ++seq.current, label, url: URL.createObjectURL(file), size: file.size, ext: fmt.current.ext, blob: file, name }
      } else {
        const blob = new Blob(chunks.current, { type: fmt.current.mime || 'video/webm' })
        chunks.current = []
        take = { id: ++seq.current, label, url: URL.createObjectURL(blob), size: blob.size, ext: fmt.current.ext, blob }
      }
      setTakes((t) => [take, ...t])
      void wake.current?.release().catch(() => {}); wake.current = null
    }
    mr.start(2000)
    recorder.current = mr
    try { wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* không bắt buộc */ }
    setRec({ since: Date.now(), label })
  }
  const stop = () => { recorder.current?.stop(); recorder.current = null; setRec(null) }

  const fileName = (t: Take) => t.name ?? `${baseName()}_${slug(t.label)}.${t.ext}`
  const save = async (t: Take) => {
    // File lấy từ ổ lưu trữ thì dùng thẳng (không nạp vào RAM); file trong bộ nhớ thì bọc lại để có tên đẹp.
    const file = t.name ? (t.blob as File) : new File([t.blob], fileName(t), { type: t.blob.type })
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: t.label }); return } catch (e) { if ((e as Error).name === 'AbortError') return }
    }
    const a = document.createElement('a'); a.href = t.url; a.download = fileName(t); document.body.appendChild(a); a.click(); a.remove()
  }
  const drop = (t: Take) => { URL.revokeObjectURL(t.url); if (t.name) void opfsRemove(t.name); setTakes((l) => l.filter((x) => x.id !== t.id)) }

  const elapsed = rec ? Math.floor((Date.now() - rec.since) / 1000) : 0
  const recMB = rec ? recBytes.current / 1e6 : 0
  // Tốc độ dữ liệu thực tế trong ~20 giây gần nhất (Mb/giây) so với mức đã đặt.
  const mbps = (() => {
    const r = rate.current
    if (!rec || r.length < 3) return 0
    const last = r[r.length - 1], first = r.find((x) => last.t - x.t <= 20000) ?? r[0]
    return last.t > first.t ? ((last.b - first.b) * 8) / 1e6 / ((last.t - first.t) / 1000) : 0
  })()
  const target = PRESETS[q].bps / 1e6
  const period = st ? qLabel(st.game.period) : '…'

  return (
    <div className="rc">
      <video ref={video} className="rc-src" playsInline muted autoPlay />
      <canvas ref={canvas} className={`rc-view ${dark ? 'off' : ''}`} width={1280} height={720} />
      <div className="rc-top">
        {rec ? <span className="rc-live"><i /> ĐANG QUAY {rec.label} · {mmss(elapsed)} · {recMB.toFixed(0)} MB{mbps > 0 ? ` · ${mbps.toFixed(1)} Mb/s (${(mbps * 7.5).toFixed(0)} MB/phút)` : ''} · {diskMode ? 'ổ lưu trữ' : 'RAM'}</span> : <span className="rc-idle">Sẵn sàng · {period}</span>}
        {rec && mbps > target * 1.6 && <span className="rc-err">Máy đang quay nặng gấp {(mbps / target).toFixed(1)} lần mức đặt ({target} Mb/s). Chọn mức “Gọn” để nhẹ hơn.</span>}
        {err && <span className="rc-err">{err}</span>}
        {rec && hidden && <span className="rc-err">Màn hình đang bị che: iPhone có thể dừng quay!</span>}
      </div>
      {camErr && <div className="rc-camerr">{camErr}</div>}
      {dark && (
        <div className="rc-dark" onClick={() => setDark(false)}>
          <span>{rec ? `● ĐANG QUAY ${rec.label} · ${mmss(elapsed)}` : 'Chạm để bật màn hình'}</span><small>Màn hình tối giúp máy đỡ nóng. Chạm bất kỳ đâu để bật lại.</small>
        </div>
      )}
      <div className="rc-bar">
        <div className="rc-side">
          <button disabled={!!rec} onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}>⟲ Đổi camera</button>
          <button disabled={!!rec} onClick={() => setQ(q === 'eco' ? 'bal' : q === 'bal' ? 'hi' : 'eco')}>{PRESETS[q].label}</button>
          <button onClick={() => setDark(true)}>🌙 Tối màn hình</button>
        </div>
        {rec
          ? <button className="rc-rec stop" onClick={stop}>■ DỪNG · {rec.label}</button>
          : <button className="rc-rec" disabled={!stream.current || !st || !!camErr} onClick={() => void start()}>● QUAY {period.replace('Q', 'HIỆP ')}</button>}
        <div className="rc-side right">{takes.length > 0 && <span>{takes.length} file</span>}</div>
      </div>
      {takes.length > 0 && (
        <div className="rc-takes">
          <b>Video đã quay (nhớ lưu về máy)</b>{diskMode && <small> · đang ghi thẳng xuống ổ lưu trữ</small>}
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
