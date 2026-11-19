import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../supabase'
import { Logo } from './Logo'
import { confirmDialog } from '../lib/dialog'

/* ================= Máy tính: tạo mã QR cho điện thoại ================= */
export function RemoteModal(props: { gameId: string; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'revoked'>('loading')

  const make = async () => {
    setErr(''); setQr(''); setState('loading')
    const { data, error } = await supabase.rpc('create_remote_token', { p_game: props.gameId })
    if (error) return setErr(error.message)
    const u = `${location.origin}${location.pathname}#remote=${data as string}`
    setUrl(u)
    setQr(await QRCode.toDataURL(u, { width: 320, margin: 1, errorCorrectionLevel: 'M' }))
    setState('ready')
  }
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
        <div className="row"><b className="grow">📱 Bấm stats trên điện thoại</b><button className="icon-btn" onClick={props.onClose}>×</button></div>
        <div className="muted small-note">Quét mã bằng camera điện thoại để mở bảng bấm của trận này. Không cần đăng nhập. Mỗi pha bấm trên điện thoại hiện ngay trên máy tính.</div>
        {err && <div className="err">{err}</div>}
        {qr ? (
          <>
            <img className="remote-qr" src={qr} alt="Mã QR bảng bấm" />
            <div className="row">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? '✓' : 'Copy'}</button>
            </div>
            <div className="muted small-note">Mã chỉ ghi được stats của <b>trận này</b>, tự hết hạn sau <b>12 giờ</b>. Ai có mã đều bấm được, nên chỉ đưa cho người ghi stats.</div>
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
  recent: { id: string; type: string; side: string; number: number | null; name: string | null; remote: boolean; paint?: boolean; fb?: boolean }[]
  fouls?: { home: number; away: number }
  timeouts?: { home: number; away: number; max: number }
}
const TEAM_TYPES = ['OREB', 'DREB', 'TOV']
const SHOTS = ['2PM', '2PX', '3PM', '3PX']
const ACTIONS: { type: string; label: string; sub?: string; tone?: string }[] = [
  { type: '2PM', label: '2PT', sub: '+2', tone: 'made' }, { type: '3PM', label: '3PT', sub: '+3', tone: 'made' }, { type: 'FTM', label: 'FT', sub: '+1', tone: 'made' },
  { type: '2PX', label: '2PT', sub: 'miss', tone: 'miss' }, { type: '3PX', label: '3PT', sub: 'miss', tone: 'miss' }, { type: 'FTX', label: 'FT', sub: 'miss', tone: 'miss' },
  { type: 'OREB', label: 'OREB' }, { type: 'DREB', label: 'DREB' }, { type: 'AST', label: 'AST' },
  { type: 'STL', label: 'STL' }, { type: 'BLK', label: 'BLK' }, { type: 'TOV', label: 'TOV' }, { type: 'PF', label: 'PF' }, { type: 'PFS', label: 'SF' },
  { type: 'PFT', label: 'TF', sub: 'technical' }, { type: 'PFU', label: 'UF', sub: 'unsport.' },
]
const NAME: Record<string, string> = { '2PM': '2PT made', '2PX': '2PT missed', '3PM': '3PT made', '3PX': '3PT missed', FTM: 'FT made', FTX: 'FT missed', PFS: 'Shooting foul', PFT: 'Technical foul', PFU: 'Unsportsmanlike foul', PFD: 'Disqualifying foul', TMO: 'Timeout' }
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)

export function RemotePad({ token }: { token: string }) {
  const [st, setSt] = useState<RState | null>(null)
  const [err, setErr] = useState('')
  const [side, setSide] = useState<'home' | 'away'>('home')
  const [sel, setSel] = useState<RPlayer | null>(null)
  const [team, setTeam] = useState(false) // chọn TEAM của đội đang xem
  const [mods, setMods] = useState({ paint: false, fb: false })
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
  const send = async (player: string | null, type: string, forSide: 'home' | 'away', label: string) => {
    setBusy(true)
    const shot = SHOTS.includes(type)
    const { data, error } = await supabase.rpc('remote_add_event', {
      p_token: token, p_player: player, p_type: type, p_side: forSide,
      p_paint: shot && type.startsWith('2') && mods.paint, p_fb: shot && mods.fb,
    })
    setBusy(false)
    if (error || data !== 'ok') return flash(error?.message ?? String(data))
    navigator.vibrate?.(30)
    const tags = shot ? [type.startsWith('2') && mods.paint ? 'sơn' : '', mods.fb ? 'FB' : ''].filter(Boolean).join(', ') : ''
    flash(`✓ ${label} · ${NAME[type] ?? type}${tags ? ` (${tags})` : ''}`)
    if (shot) setMods({ paint: false, fb: false })
    setSel(null); setTeam(false); void load()
  }
  const act = (type: string) => {
    if (team) {
      if (!TEAM_TYPES.includes(type)) return flash('TEAM chỉ ghi được OREB, DREB, TOV')
      return send(null, type, side, `TEAM ${side === 'home' ? st?.game.home : st?.game.away}`)
    }
    if (!sel) return flash('Chọn cầu thủ (hoặc TEAM) trước')
    return send(sel.id, type, sel.side, `#${sel.number} ${sel.name}`)
  }
  const timeout = (s: 'home' | 'away') => send(null, 'TMO', s, s === 'home' ? st?.game.home ?? 'HOME' : st?.game.away ?? 'AWAY')
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
      <div className="rp-meta">
        {(['home', 'away'] as const).map((s) => {
          const f = st.fouls?.[s] ?? 0, tu = st.timeouts?.[s] ?? 0, tm = st.timeouts?.max ?? 0
          return (
            <div key={s} className={`rp-meta-side ${s}`}>
              <span className={f >= 4 ? 'bonus' : ''}>TF {f}{f >= 4 ? ' · BONUS' : ''}</span>
              <button className={`rp-tmo ${tu >= tm ? 'out' : ''}`} disabled={busy} onClick={() => timeout(s)}>Timeout {tu}/{tm}</button>
            </div>
          )
        })}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="seg-toggle rp-sides">
        <button className={side === 'home' ? 'on atk' : ''} onClick={() => { setSide('home'); setSel(null); setTeam(false) }}>{st.game.home}</button>
        <button className={side === 'away' ? 'on' : ''} onClick={() => { setSide('away'); setSel(null); setTeam(false) }}>{st.game.away}</button>
      </div>
      <div className="rp-players">
        {on.map((p) => (
          <button key={p.id} className={`rp-player oncourt ${sel?.id === p.id ? 'sel' : ''} ${p.pf >= 5 ? 'out' : ''}`} onClick={() => { setTeam(false); setSel(sel?.id === p.id ? null : p) }}>
            <b>{p.number}</b><span>{p.name}</span><small>{p.pts} PTS · {p.pf} PF</small>
          </button>
        ))}
        {on.length > 0 && (
          <button className={`rp-player oncourt rp-team ${team ? 'sel' : ''}`} onClick={() => { setSel(null); setTeam(!team) }}>
            <b>TEAM</b><span>REB · TOV</span><small>không gắn cầu thủ</small>
          </button>
        )}
        {on.length === 0 && <div className="rp-empty muted">Chưa có cầu thủ trên sân. Hãy đưa đội hình vào sân trên máy tính.</div>}
      </div>
      <div className="rp-sel">{sel ? <>Đang chọn <b>#{sel.number} {sel.name}</b></> : team ? <>Đang chọn <b>TEAM</b> (OREB, DREB, TOV)</> : 'Chọn cầu thủ, rồi bấm hành động'}</div>
      <div className="rp-mods">
        <button className={mods.paint ? 'on' : ''} onClick={() => setMods({ ...mods, paint: !mods.paint })}>🎯 Trong sơn</button>
        <button className={mods.fb ? 'on' : ''} onClick={() => setMods({ ...mods, fb: !mods.fb })}>⚡ Fast break</button>
      </div>
      <div className={`rp-actions ${sel || team ? '' : 'idle'}`}>
        {ACTIONS.map((a) => (
          <button key={a.type} disabled={busy} className={`rp-act ${a.tone ?? ''}`} onClick={() => act(a.type)}>
            <span>{a.label}</span>{a.sub && <small>{a.sub}</small>}
          </button>
        ))}
      </div>
      <div className="row"><b className="grow">Gần đây</b><button className="btn sm" onClick={undo}>↶ Hoàn tác</button></div>
      <ul className="list rp-recent">
        {st.recent.slice(0, 5).map((r) => <li key={r.id} className="item"><span className={`st-dot ${r.side}`} /><span className="grow"><b>{r.number != null ? `#${r.number} ${r.name}` : r.type === 'TMO' ? '' : 'TEAM'}</b> {NAME[r.type] ?? r.type}{r.paint ? ' · sơn' : ''}{r.fb ? ' · FB' : ''}</span>{r.remote && <span className="muted small-note">📱</span>}</li>)}
      </ul>
      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
