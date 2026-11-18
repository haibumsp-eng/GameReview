import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../supabase'
import { Logo } from './Logo'
import { BoardOverlay } from './Board'
import { confirmDialog } from '../lib/dialog'

/* ================= Máy tính: tạo mã QR cho điện thoại ================= */
export function RemoteModal(props: { gameId: string; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [copiedB, setCopiedB] = useState(false)
  const [token, setToken] = useState('')
  const [bpos, setBpos] = useState<'top' | 'bottom'>('top')
  const [bscale, setBscale] = useState(1)
  const [tab, setTab] = useState<'phone' | 'obs'>('phone')
  const [bonus, setBonus] = useState({ home: 0, away: 0 })
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'revoked'>('loading')

  const make = async () => {
    setErr(''); setQr(''); setState('loading')
    const { data, error } = await supabase.rpc('create_remote_token', { p_game: props.gameId })
    if (error) return setErr(error.message)
    const u = `${location.origin}${location.pathname}#remote=${data as string}`
    setUrl(u); setToken(data as string)
    setQr(await QRCode.toDataURL(u, { width: 320, margin: 1, errorCorrectionLevel: 'M' }))
    setState('ready')
  }
  const boardUrl = token ? `${location.origin}${location.pathname}#board=${token}${bpos === 'bottom' ? '&pos=bottom' : ''}${bscale !== 1 ? `&scale=${bscale.toFixed(1)}` : ''}` : ''
  useEffect(() => { void make() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const revoke = async () => {
    if (!(await confirmDialog({ title: 'Thu hồi mã?', message: 'Mọi điện thoại đang dùng mã này sẽ không bấm được nữa.', okText: 'Thu hồi', danger: true }))) return
    const { error } = await supabase.from('remote_tokens').delete().eq('game_id', props.gameId)
    if (error) return setErr(error.message)
    setQr(''); setUrl(''); setState('revoked')
  }

  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Kết nối</b><button className="icon-btn" onClick={props.onClose}>×</button></div>
        <div className="seg-toggle">
          <button className={tab === 'phone' ? 'on' : ''} onClick={() => setTab('phone')}>📱 Điện thoại</button>
          <button className={tab === 'obs' ? 'on' : ''} onClick={() => setTab('obs')}>📺 Livestream OBS</button>
        </div>
        {err && <div className="err">{err}</div>}
        {qr ? (
          <>
            {tab === 'phone' && <>
            <div className="muted small-note">Quét mã bằng camera điện thoại để mở bảng bấm của trận này. Không cần đăng nhập. Mỗi pha bấm trên điện thoại hiện ngay trên máy tính.</div>
            <img className="remote-qr" src={qr} alt="Mã QR bảng bấm" />
            <div className="row">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? '✓' : 'Copy'}</button>
            </div>
            <div className="muted small-note">Mã chỉ ghi được stats của <b>trận này</b>, tự hết hạn sau <b>12 giờ</b>. Ai có mã đều bấm được, nên chỉ đưa cho người ghi stats. Địa chỉ OBS cũng dùng chung mã này: đừng để lộ lên hình stream.</div>
            </>}
            {tab === 'obs' && <div className="remote-obs">
              <div className="obs-preview" title="Xem trước (nền xanh giả làm hình video)">
                <div className="obs-stage">{token && <BoardOverlay token={token} pos={bpos} scale={bscale * 0.5} inline bonus={bonus} />}</div>
              </div>
              <div className="row wrap">
                <span className="muted small-note">Thử hiệu ứng</span>
                {[1, 2, 3].map((n) => <button key={n} className="btn sm" onClick={() => setBonus((b) => ({ ...b, home: b.home + n }))}>HOME +{n}</button>)}
                {[1, 2, 3].map((n) => <button key={'a' + n} className="btn sm" onClick={() => setBonus((b) => ({ ...b, away: b.away + n }))}>AWAY +{n}</button>)}
                <button className="btn sm ghost" onClick={() => setBonus({ home: 0, away: 0 })}>Đặt lại</button>
              </div>
              <div className="row">
                <label className="muted small-note">Vị trí</label>
                <select value={bpos} onChange={(e) => setBpos(e.target.value as 'top' | 'bottom')}><option value="top">Phía trên</option><option value="bottom">Phía dưới</option></select>
                <label className="muted small-note">Cỡ</label>
                <input type="range" min={0.6} max={1.6} step={0.1} value={bscale} onChange={(e) => setBscale(+e.target.value)} style={{ flex: 1 }} />
                <span className="muted small-note">{Math.round(bscale * 100)}%</span>
              </div>
              <div className="row">
                <input readOnly value={boardUrl} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(boardUrl).then(() => { setCopiedB(true); setTimeout(() => setCopiedB(false), 1500) })}>{copiedB ? '✓' : 'Copy'}</button>
              </div>
              <ol className="muted small-note">
                <li>OBS → Sources → <b>+</b> → <b>Browser</b>.</li>
                <li>Dán địa chỉ trên vào ô <b>URL</b>, đặt Width <b>1920</b>, Height <b>1080</b>.</li>
                <li>Địa chỉ đã gồm vị trí và cỡ bạn chọn ở trên. Trong OBS nền bảng trong suốt, ô xanh chỉ để xem trước.</li>
              </ol>
            </div>}
            <button className="btn danger" onClick={revoke}>Thu hồi mã</button>
          </>
        ) : state === 'loading' && !err ? <div className="muted">Đang tạo mã…</div> : (
          <>
            {state === 'revoked' && <div className="muted">Đã thu hồi. Các điện thoại cũ không bấm được nữa.</div>}
            <button className="btn primary" onClick={make}>Tạo mã mới</button>
          </>
        )}
      </div>
    </div>
  )
}

/* ================= Điện thoại: bảng bấm (không cần đăng nhập) ================= */
interface RPlayer { id: string; side: 'home' | 'away'; number: number; name: string; on: boolean; pts: number; pf: number }
interface RState {
  game: { title: string; home: string; away: string; period: number; clock: number; running: boolean }
  score: { home: number; away: number }
  players: RPlayer[]
  recent: { id: string; type: string; side: string; number: number; name: string; remote: boolean }[]
}
const ACTIONS: { type: string; label: string; sub?: string; tone?: string }[] = [
  { type: '2PM', label: '2PT', sub: '+2', tone: 'made' }, { type: '3PM', label: '3PT', sub: '+3', tone: 'made' }, { type: 'FTM', label: 'FT', sub: '+1', tone: 'made' },
  { type: '2PX', label: '2PT', sub: 'miss', tone: 'miss' }, { type: '3PX', label: '3PT', sub: 'miss', tone: 'miss' }, { type: 'FTX', label: 'FT', sub: 'miss', tone: 'miss' },
  { type: 'OREB', label: 'OREB' }, { type: 'DREB', label: 'DREB' }, { type: 'AST', label: 'AST' },
  { type: 'STL', label: 'STL' }, { type: 'BLK', label: 'BLK' }, { type: 'TOV', label: 'TOV' }, { type: 'PF', label: 'PF' }, { type: 'PFS', label: 'SF' },
]
const NAME: Record<string, string> = { '2PM': '2PT made', '2PX': '2PT missed', '3PM': '3PT made', '3PX': '3PT missed', FTM: 'FT made', FTX: 'FT missed', PFS: 'Shooting foul' }
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)

export function RemotePad({ token }: { token: string }) {
  const [st, setSt] = useState<RState | null>(null)
  const [err, setErr] = useState('')
  const [side, setSide] = useState<'home' | 'away'>('home')
  const [sel, setSel] = useState<RPlayer | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fetchedAt = useRef(Date.now())
  const [, tick] = useState(0)

  const load = async () => {
    const { data, error } = await supabase.rpc('remote_state', { p_token: token })
    if (error) return setErr('Mất kết nối, đang thử lại…')
    if ((data as { error?: string })?.error) return setErr((data as { error: string }).error)
    setErr(''); fetchedAt.current = Date.now(); setSt(data as RState)
  }
  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 2000)
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => { clearInterval(iv); clearInterval(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1800) }
  const act = async (type: string) => {
    if (!sel) return flash('Chọn cầu thủ trước')
    setBusy(true)
    const { data, error } = await supabase.rpc('remote_add_stat', { p_token: token, p_player: sel.id, p_type: type })
    setBusy(false)
    if (error || data !== 'ok') return flash(error?.message ?? String(data))
    navigator.vibrate?.(30)
    flash(`✓ #${sel.number} ${sel.name} · ${NAME[type] ?? type}`)
    setSel(null); void load()
  }
  const undo = async () => {
    const { data, error } = await supabase.rpc('remote_undo', { p_token: token })
    flash(error ? error.message : data === 'ok' ? '↶ Đã hoàn tác' : String(data)); void load()
  }

  useEffect(() => {
    if (sel && st && !st.players.some((p) => p.id === sel.id && p.on)) setSel(null)
  }, [st, sel])

  if (!st) return <div className="rp rp-center">{err ? <div className="err">{err}</div> : <div className="muted">Đang tải…</div>}</div>
  const clock = st.game.running ? st.game.clock - (Date.now() - fetchedAt.current) / 1000 : st.game.clock
  // Chỉ cầu thủ đang trên sân (thay người làm trên máy tính).
  const on = st.players.filter((p) => p.side === side && p.on)

  return (
    <div className="rp">
      <div className="rp-head">
        <Logo size={22} />
        <span className="muted rp-title">{st.game.title}</span>
      </div>
      <div className="rp-score">
        <span className="rp-tname">{st.game.home}</span>
        <b className="home">{st.score.home}</b>
        <span className={`rp-clock ${st.game.running ? 'run' : ''}`}>{qLabel(st.game.period)} {mmss(clock)}</span>
        <b className="away">{st.score.away}</b>
        <span className="rp-tname">{st.game.away}</span>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="seg-toggle rp-sides">
        <button className={side === 'home' ? 'on atk' : ''} onClick={() => { setSide('home'); setSel(null) }}>{st.game.home}</button>
        <button className={side === 'away' ? 'on' : ''} onClick={() => { setSide('away'); setSel(null) }}>{st.game.away}</button>
      </div>
      <div className="rp-players">
        {on.map((p) => (
          <button key={p.id} className={`rp-player oncourt ${sel?.id === p.id ? 'sel' : ''} ${p.pf >= 5 ? 'out' : ''}`} onClick={() => setSel(sel?.id === p.id ? null : p)}>
            <b>{p.number}</b><span>{p.name}</span><small>{p.pts} PTS · {p.pf} PF</small>
          </button>
        ))}
        {on.length === 0 && <div className="rp-empty muted">Chưa có cầu thủ trên sân. Hãy đưa đội hình vào sân trên máy tính.</div>}
      </div>
      <div className="rp-sel">{sel ? <>Đang chọn <b>#{sel.number} {sel.name}</b></> : 'Chọn cầu thủ, rồi bấm hành động'}</div>
      <div className={`rp-actions ${sel ? '' : 'idle'}`}>
        {ACTIONS.map((a) => (
          <button key={a.type} disabled={busy} className={`rp-act ${a.tone ?? ''}`} onClick={() => act(a.type)}>
            <span>{a.label}</span>{a.sub && <small>{a.sub}</small>}
          </button>
        ))}
      </div>
      <div className="row"><b className="grow">Gần đây</b><button className="btn sm" onClick={undo}>↶ Hoàn tác</button></div>
      <ul className="list rp-recent">
        {st.recent.slice(0, 5).map((r) => <li key={r.id} className="item"><span className={`st-dot ${r.side}`} /><span className="grow"><b>#{r.number} {r.name}</b> {NAME[r.type] ?? r.type}</span>{r.remote && <span className="muted small-note">📱</span>}</li>)}
      </ul>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
