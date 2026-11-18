import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '../supabase'
import { useData, useUi, myOrgRole } from '../store'
import { confirmDialog, promptDialog } from '../lib/dialog'
import { BoardOverlay } from './Board'
import { ScorePad } from './ScorePad'

interface Board {
  id: string; name: string; league: string; home: string; away: string; periodLen: number; controlToken: string; viewToken: string
}
const fromRow = (r: any): Board => ({ id: r.id, name: r.name, league: r.league, home: r.home_name, away: r.away_name, periodLen: r.period_len, controlToken: r.control_token, viewToken: r.view_token })
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

/** Trang "Bảng tỉ số": riêng hoàn toàn với mổ băng và Live Stats. */
export function ScoreboardPage() {
  const { orgId } = useUi(useShallow((s) => ({ orgId: s.orgId })))
  const isSuper = useData((s) => s.isSuper)
  const canEdit = isSuper || ['owner', 'coach'].includes(myOrgRole(orgId) ?? '')
  const [boards, setBoards] = useState<Board[]>([])
  const [sel, setSel] = useState('')
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!orgId || !canEdit) { setLoaded(true); return }
    const { data, error } = await supabase.from('scoreboards').select('*').eq('org_id', orgId).order('created_at')
    if (error) { setErr(error.message); setLoaded(true); return }
    const list = (data ?? []).map(fromRow)
    setBoards(list); setErr(''); setLoaded(true)
    setSel((cur) => (list.some((b) => b.id === cur) ? cur : list[0]?.id ?? ''))
  }, [orgId, canEdit])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    const n = await promptDialog({ title: 'Bảng tỉ số mới', label: 'Tên bảng (chỉ để bạn phân biệt)', placeholder: 'vd: Sân 1, Giải hè', okText: 'Tạo', validate: (x) => (x.trim() ? null : 'Nhập tên bảng') })
    if (!n) return
    const { data, error } = await supabase.from('scoreboards').insert({ org_id: orgId, name: n }).select('*').single()
    if (error) return setErr(error.message)
    setBoards((b) => [...b, fromRow(data)]); setSel(data.id)
  }
  const remove = async (b: Board) => {
    if (!(await confirmDialog({ title: `Xoá bảng “${b.name}”?`, message: 'Các địa chỉ OBS và điện thoại đang dùng bảng này sẽ ngừng hoạt động.', okText: 'Xoá', danger: true }))) return
    const { error } = await supabase.from('scoreboards').delete().eq('id', b.id)
    if (error) return setErr(error.message)
    setBoards((l) => l.filter((x) => x.id !== b.id)); setSel('')
    void load()
  }
  const patch = async (b: Board, p: Partial<Board>) => {
    const row: Record<string, unknown> = {}
    if (p.name !== undefined) row.name = p.name
    if (p.league !== undefined) row.league = p.league
    if (p.home !== undefined) row.home_name = p.home
    if (p.away !== undefined) row.away_name = p.away
    if (p.periodLen !== undefined) row.period_len = p.periodLen
    if (p.controlToken !== undefined) row.control_token = p.controlToken
    if (p.viewToken !== undefined) row.view_token = p.viewToken
    setBoards((l) => l.map((x) => (x.id === b.id ? { ...x, ...p } : x)))
    const { error } = await supabase.from('scoreboards').update(row).eq('id', b.id)
    if (error) { setErr(error.message); void load() }
  }

  const cur = boards.find((b) => b.id === sel)

  return (
    <div className="sb">
      <div className="sb-side card stack">
        <div className="row"><b className="grow">Bảng tỉ số</b>{canEdit && <button className="btn sm primary" onClick={add}>+ Bảng mới</button>}</div>
        <ul className="list">
          {boards.map((b) => (
            <li key={b.id} className={b.id === sel ? 'item active' : 'item'} onClick={() => setSel(b.id)}>
              <span className="grow">{b.name}</span>
              {canEdit && <button className="icon-btn" title="Xoá" onClick={(e) => { e.stopPropagation(); void remove(b) }}>×</button>}
            </li>
          ))}
          {loaded && boards.length === 0 && canEdit && <li className="empty">Chưa có bảng nào. Bấm “+ Bảng mới”.</li>}
        </ul>
        {!canEdit && <div className="muted small-note">Chỉ chủ trung tâm và HLV mới dùng được bảng tỉ số.</div>}
        <div className="muted small-note">Bảng tỉ số hoạt động độc lập: không cần có trận hay stats. Chỉ có tên đội, tên giải, điểm và đồng hồ.</div>
      </div>

      <div className="sb-main">
        {err && <div className="card err" onClick={() => setErr('')}>{err}</div>}
        {cur ? <BoardDetail key={cur.id} b={cur} onPatch={(p) => patch(cur, p)} /> : loaded && canEdit && boards.length > 0 && <div className="card muted">Chọn một bảng bên trái.</div>}
      </div>
    </div>
  )
}

function BoardDetail({ b, onPatch }: { b: Board; onPatch: (p: Partial<Board>) => void }) {
  const [f, setF] = useState({ name: b.name, league: b.league, home: b.home, away: b.away, mins: String(Math.round(b.periodLen / 60)) })
  const [qr, setQr] = useState('')
  const [pos, setPos] = useState<'top' | 'bottom'>('top')
  const [scale, setScale] = useState(1)
  const [bonus, setBonus] = useState({ home: 0, away: 0 })
  const [copied, setCopied] = useState('')
  const base = `${location.origin}${location.pathname}`
  const padUrl = `${base}#scorepad=${b.controlToken}`
  const obsUrl = `${base}#board=${b.viewToken}${pos === 'bottom' ? '&pos=bottom' : ''}${scale !== 1 ? `&scale=${scale.toFixed(1)}` : ''}`

  useEffect(() => { void QRCode.toDataURL(padUrl, { width: 260, margin: 1, errorCorrectionLevel: 'M' }).then(setQr) }, [padUrl])
  const copy = (k: string, v: string) => navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1500) })
  const save = (k: 'name' | 'league' | 'home' | 'away') => { if (f[k] !== b[k]) onPatch({ [k]: f[k].trim() } as Partial<Board>) }
  const saveMins = () => {
    const m = Math.max(1, Math.min(60, Math.round(+f.mins || 10)))
    setF((x) => ({ ...x, mins: String(m) }))
    if (m * 60 !== b.periodLen) onPatch({ periodLen: m * 60 })
  }
  const regen = async () => {
    if (!(await confirmDialog({ title: 'Đổi mã?', message: 'Địa chỉ OBS và điện thoại cũ sẽ ngừng hoạt động. Bạn phải dán địa chỉ mới.', okText: 'Đổi mã', danger: true }))) return
    onPatch({ controlToken: newToken(), viewToken: newToken() })
  }

  return (
    <>
      <div className="card stack">
        <b>Thông tin hiển thị</b>
        <div className="sb-form">
          <label>Tên bảng (để phân biệt)<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => save('name')} /></label>
          <label>Tên giải (hiện trên bảng)<input placeholder="vd: Giải Bóng Rổ Học Sinh" value={f.league} onChange={(e) => setF({ ...f, league: e.target.value })} onBlur={() => save('league')} /></label>
          <label>Đội nhà<input value={f.home} onChange={(e) => setF({ ...f, home: e.target.value })} onBlur={() => save('home')} /></label>
          <label>Đội khách<input value={f.away} onChange={(e) => setF({ ...f, away: e.target.value })} onBlur={() => save('away')} /></label>
          <label>Phút mỗi hiệp<input type="number" min={1} max={60} value={f.mins} onChange={(e) => setF({ ...f, mins: e.target.value })} onBlur={saveMins} /></label>
        </div>
      </div>

      <div className="sb-cols">
        <div className="card stack">
          <b>📱 Điều khiển bằng điện thoại</b>
          <div className="muted small-note">Quét mã để mở bảng điều khiển tỉ số và đồng hồ. Không cần đăng nhập.</div>
          {qr && <img className="remote-qr" src={qr} alt="Mã QR điều khiển" />}
          <div className="row"><input readOnly value={padUrl} onFocus={(e) => e.currentTarget.select()} /><button className="btn sm" onClick={() => copy('pad', padUrl)}>{copied === 'pad' ? '✓' : 'Copy'}</button></div>
          <div className="muted small-note">Ai có địa chỉ này đều điều khiển được bảng. Chỉ đưa cho người cầm bảng.</div>
        </div>

        <div className="card stack">
          <b>⌨ Điều khiển ngay trên máy này</b>
          <ScorePad token={b.controlToken} embedded />
        </div>
      </div>

      <div className="card stack">
        <b>📺 Livestream OBS</b>
        <div className="sb-obs">
          <div className="stack">
            <div className="obs-preview" title="Xem trước (nền xanh giả làm hình video)">
              <div className="obs-stage"><BoardOverlay token={b.viewToken} pos={pos} scale={scale * 0.6} inline bonus={bonus} /></div>
            </div>
            <div className="row wrap">
              <span className="muted small-note">Thử hiệu ứng</span>
              {[1, 2, 3].map((n) => <button key={n} className="btn sm" onClick={() => setBonus((x) => ({ ...x, home: x.home + n }))}>HOME +{n}</button>)}
              {[1, 2, 3].map((n) => <button key={'a' + n} className="btn sm" onClick={() => setBonus((x) => ({ ...x, away: x.away + n }))}>AWAY +{n}</button>)}
              <button className="btn sm ghost" onClick={() => setBonus({ home: 0, away: 0 })}>Đặt lại</button>
            </div>
          </div>
          <div className="stack">
            <div className="row">
              <label className="muted small-note">Vị trí</label>
              <select style={{ width: 'auto' }} value={pos} onChange={(e) => setPos(e.target.value as 'top' | 'bottom')}><option value="top">Phía trên</option><option value="bottom">Phía dưới</option></select>
              <label className="muted small-note">Cỡ</label>
              <input type="range" min={0.6} max={1.6} step={0.1} value={scale} onChange={(e) => setScale(+e.target.value)} style={{ flex: 1 }} />
              <span className="muted small-note">{Math.round(scale * 100)}%</span>
            </div>
            <div className="row"><input readOnly value={obsUrl} onFocus={(e) => e.currentTarget.select()} /><button className="btn sm" onClick={() => copy('obs', obsUrl)}>{copied === 'obs' ? '✓' : 'Copy'}</button></div>
            <ol className="muted small-note">
              <li>OBS → Sources → <b>+</b> → <b>Browser</b>.</li>
              <li>Dán địa chỉ vào ô <b>URL</b>, đặt Width <b>1920</b>, Height <b>1080</b>.</li>
              <li>Địa chỉ đã gồm vị trí và cỡ bạn chọn. Trong OBS nền trong suốt, ô xanh chỉ để xem trước.</li>
            </ol>
            <div className="muted small-note">Địa chỉ OBS chỉ <b>xem</b>, không điều khiển được. Có thể để lộ mà không sợ ai đổi tỉ số.</div>
            <button className="btn danger" onClick={regen}>Đổi mã (thu hồi địa chỉ cũ)</button>
          </div>
        </div>
      </div>
    </>
  )
}
