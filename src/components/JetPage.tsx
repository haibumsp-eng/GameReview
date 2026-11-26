import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '../supabase'
import { useData, useUi, selectGame, toast } from '../store'
import { confirmDialog } from '../lib/dialog'
import { parseJetCsv, type JetParse } from '../lib/jetCsv'

export const JET_LEAGUES = ['PRO.JET', 'JET', 'JR.JET', 'WJET'] as const
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Mục "Giải JET" (riêng Junsport): các đội của PRO.JET, JET, JR.JET, WJET kèm danh sách VĐV.
 * Đội được lưu như một "tuyến" nên chọn đội trong Live Stats là có sẵn danh sách. CHỈ lưu họ tên: số áo mỗi trận một khác
 * nên nhập theo từng trận ở "Danh sách trận / số áo" (sau này lấy từ biên bản online).
 */
export function JetPage({ onOpenStats }: { onOpenStats: () => void }) {
  const { orgId, set } = useUi(useShallow((s) => ({ orgId: s.orgId, set: s.set })))
  const { squads, players, games, isSuper, orgMembers, session } = useData()
  const myRole = orgMembers.find((m) => m.orgId === orgId && m.userId === session?.user.id)?.role
  const canEdit = isSuper || myRole === 'owner' || myRole === 'coach'
  const canDelete = isSuper || myRole === 'owner' // chỉ quản trị tổng và Admin của trung tâm
  const [league, setLeague] = useState<(typeof JET_LEAGUES)[number]>('PRO.JET')
  const [season, setSeason] = useState('')
  const [sel, setSel] = useState('')
  const [modal, setModal] = useState<'' | 'import' | 'match' | 'new'>('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'teams' | 'games'>('games')

  const jet = squads.filter((s) => s.orgId === orgId && s.league)
  const seasons = [...new Set(jet.filter((s) => s.league === league).map((s) => s.season || ''))].sort().reverse()
  const teams = jet.filter((s) => s.league === league && (!season || (s.season || '') === season)).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const team = jet.find((s) => s.id === sel)
  const count = (id: string) => players.filter((p) => p.squadId === id).length
  const reload = () => useData.getState().loadBase()
  // Trận có chữ "JET" trong tên (PRO.JET, JR.JET, WJET, JET5…) hoặc thuộc đội JET, trong trung tâm này.
  const orgSquads = new Map(squads.filter((s) => s.orgId === orgId).map((s) => [s.id, s]))
  const jetGames = games.filter((g) => { const sq = orgSquads.get(g.squadId); return !!sq && (/jet/i.test(g.title) || /jet/i.test(sq.name) || !!sq.league) })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title, 'vi'))
  const openGame = (g: (typeof games)[number]) => { set({ squadId: g.squadId }); selectGame(g.id); onOpenStats() }

  return (
    <div className="jt">
      <div className="jt-side card stack">
        <div className="row"><b className="grow">Giải JET</b>{canEdit && <button className="btn sm primary" onClick={() => setModal('new')}>+ Đội</button>}</div>
        <div className="seg-toggle jt-leagues">
          {JET_LEAGUES.map((l) => <button key={l} className={league === l ? 'on' : ''} onClick={() => { setLeague(l); setSel(''); setSeason('') }}>{l}</button>)}
        </div>
        {seasons.length > 1 && (
          <select value={season} onChange={(e) => { setSeason(e.target.value); setSel('') }}>
            <option value="">Tất cả mùa</option>
            {seasons.map((s) => <option key={s} value={s}>{s || '(chưa ghi mùa)'}</option>)}
          </select>
        )}
        <ul className="list">
          {teams.map((t) => (
            <li key={t.id} className={t.id === sel ? 'item active' : 'item'} onClick={() => { setSel(t.id); setTab('teams') }}>
              <span className="grow"><b>{t.name}</b><br /><span className="muted small-note">{t.season ? `${t.season} · ` : ''}{t.coach ? `HLV ${t.coach} · ` : ''}{count(t.id)} VĐV</span></span>
            </li>
          ))}
          {teams.length === 0 && <li className="empty">Chưa có đội {league}. Bấm “Nhập file CSV của JET” hoặc “+ Đội”.</li>}
        </ul>
        {canEdit && (
          <div className="stack">
            <button className="btn" onClick={() => setModal('import')}>⬆ Nhập file CSV của JET</button>
            <button className="btn primary" disabled={jet.length < 2} onClick={() => setModal('match')} title="Chọn đội A, đội B: danh sách hai đội tự nạp vào trận">🏀 Tạo trận JET</button>
          </div>
        )}
        <div className="muted small-note">Chỉ lưu <b>tên đội, HLV, họ tên VĐV</b>. Không lưu số áo: số áo nhập riêng cho từng trận ở Live Stats.</div>
      </div>

      <div className="jt-main">
        {err && <div className="card err" onClick={() => setErr('')}>{err}</div>}
        <div className="seg-toggle">
          <button className={tab === 'games' ? 'on' : ''} onClick={() => setTab('games')}>Trận JET ({jetGames.length})</button>
          <button className={tab === 'teams' ? 'on' : ''} onClick={() => setTab('teams')}>Đội &amp; VĐV</button>
        </div>
        {tab === 'games' ? (
          <div className="card stack">
            <div className="muted small-note">Các trận có chữ “JET” trong tên trận hoặc nằm trong tuyến/đội có chữ “JET” (PRO.JET, JR.JET, WJET…). Bấm một trận để mở Live Stats và bấm stats.</div>
            <ul className="list">
              {jetGames.map((g) => (
                <li key={g.id} className="item" onClick={() => openGame(g)}>
                  <span className="grow"><b>{g.title}</b><br /><span className="muted small-note">{g.date || 'chưa có ngày'} · {orgSquads.get(g.squadId)?.name}{orgSquads.get(g.squadId)?.league ? '' : ' (tuyến)'}</span></span>
                  <button className="btn sm primary">Bấm stats</button>
                  {canDelete && <button className="icon-btn" title="Xoá trận (chỉ Admin)" onClick={async (e) => {
                    e.stopPropagation()
                    if (!(await confirmDialog({ title: `Xoá trận “${g.title}”?`, message: 'Toàn bộ video, mark, bình luận, thống kê và danh sách của trận này sẽ bị xoá. Không khôi phục được (trừ bản lưu nhanh nếu có).', okText: 'Xoá trận', danger: true }))) return
                    useData.getState().removeGame(g.id)
                    if (useUi.getState().gameId === g.id) selectGame(null)
                  }}>×</button>}
                </li>
              ))}
              {jetGames.length === 0 && <li className="empty">Chưa có trận nào có chữ “JET” trong tên. Tạo trận mới bằng “Tạo trận JET”.</li>}
            </ul>
          </div>
        ) : team ? <TeamEditor key={team.id} id={team.id} canEdit={canEdit} onError={setErr} onDeleted={() => { setSel(''); void reload() }} /> : <div className="card muted">Chọn một đội ở bên trái để xem và sửa danh sách VĐV.</div>}
      </div>

      {modal === 'import' && <ImportModal orgId={orgId} defaultLeague={league} onClose={() => setModal('')} onDone={(l) => { setLeague(l); setSeason(''); setModal('') }} />}
      {modal === 'new' && <NewTeamModal orgId={orgId} league={league} onClose={() => setModal('')} onCreated={(id) => { setSel(id); setTab('teams'); setModal('') }} onError={setErr} />}
      {modal === 'match' && <MatchModal league={league} onClose={() => setModal('')} onCreated={() => { setModal(''); set({}); onOpenStats() }} />}
      <span hidden>{games.length}</span>
    </div>
  )
}

/* ---------- Sửa một đội: tên, HLV, danh sách VĐV ---------- */
function TeamEditor({ id, canEdit, onError, onDeleted }: { id: string; canEdit: boolean; onError: (m: string) => void; onDeleted: () => void }) {
  const { squads, players, games, addPlayers, updatePlayer, removePlayer } = useData()
  const t = squads.find((s) => s.id === id)!
  const list = players.filter((p) => p.squadId === id).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const [f, setF] = useState({ name: t.name, coach: t.coach ?? '' })
  const [draft, setDraft] = useState('')
  const hasGames = games.some((g) => g.squadId === id)

  const saveTeam = async () => {
    if (f.name.trim() === t.name && f.coach.trim() === (t.coach ?? '')) return
    const { error } = await supabase.rpc('jet_team_update', { p_squad: id, p_name: f.name, p_coach: f.coach })
    if (error) { onError(error.message); setF({ name: t.name, coach: t.coach ?? '' }); return }
    void useData.getState().loadBase()
  }
  const add = () => {
    const nm = draft.trim()
    if (!nm) return toast('Nhập họ tên')
    if (list.some((p) => fold(p.name) === fold(nm))) return toast(`${nm} đã có trong đội`)
    addPlayers(id, [{ number: null, name: nm }])
    setDraft('')
  }
  const del = async () => {
    if (!(await confirmDialog({ title: `Xoá đội ${t.name}?`, message: `Xoá cả ${list.length} VĐV trong danh sách đội. Chỉ xoá được khi đội chưa có trận nào.`, okText: 'Xoá đội', danger: true }))) return
    const { error } = await supabase.rpc('jet_team_delete', { p_squad: id })
    if (error) return onError(error.message)
    onDeleted()
  }

  return (
    <div className="card stack">
      <div className="jt-head">
        <label>Tên đội<input value={f.name} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={saveTeam} /></label>
        <label>HLV<input value={f.coach} disabled={!canEdit} onChange={(e) => setF({ ...f, coach: e.target.value })} onBlur={saveTeam} /></label>
        <span className="tag">{t.league}{t.season ? ` · ${t.season}` : ''}</span>
        {canEdit && <button className="btn sm danger" disabled={hasGames} title={hasGames ? 'Đội đã có trận nên không xoá được' : 'Xoá đội'} onClick={del}>Xoá đội</button>}
      </div>
      <div className="muted small-note">{list.length} VĐV · số áo nhập theo từng trận (Live Stats → Danh sách trận / số áo)</div>
      <div className="jt-players">
        {list.map((p) => (
          <div key={p.id} className="jt-prow">
            <input className="grow" defaultValue={p.name} disabled={!canEdit} key={'m' + p.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) updatePlayer(p.id, { name: v }); else e.target.value = p.name }} />
            {canEdit && <button className="icon-btn" title="Xoá VĐV" onClick={async () => { if (await confirmDialog({ title: `Xoá ${p.name}?`, message: 'VĐV bị gỡ khỏi danh sách đội (các trận đã đấu vẫn giữ tên).', okText: 'Xoá', danger: true })) removePlayer(p.id) }}>×</button>}
          </div>
        ))}
        {canEdit && (
          <div className="jt-prow add">
            <input className="grow" placeholder="Họ tên VĐV mới" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn sm" onClick={add}>+ Thêm</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Tạo đội trống ---------- */
function NewTeamModal({ orgId, league, onClose, onCreated, onError }: { orgId: string; league: string; onClose: () => void; onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ league, season: '', name: '', coach: '' })
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!f.name.trim()) return onError('Nhập tên đội')
    setBusy(true)
    const { data, error } = await supabase.rpc('jet_team_create', { p_org: orgId, p_league: f.league, p_season: f.season.trim(), p_name: f.name, p_coach: f.coach })
    setBusy(false)
    if (error) return onError(error.message)
    await useData.getState().loadBase(); onCreated(data as string)
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <b>Đội JET mới</b>
        <div className="org-form">
          <select value={f.league} onChange={(e) => setF({ ...f, league: e.target.value })}>{JET_LEAGUES.map((l) => <option key={l}>{l}</option>)}</select>
          <input placeholder="Mùa giải (vd: JET5)" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} />
          <input placeholder="Tên đội" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="HLV (tuỳ chọn)" value={f.coach} onChange={(e) => setF({ ...f, coach: e.target.value })} />
        </div>
        <div className="row"><button className="btn" onClick={onClose}>Huỷ</button><button className="btn primary grow-btn" disabled={busy} onClick={go}>Tạo đội</button></div>
      </div>
    </div>
  )
}

/* ---------- Nhập file CSV của JET ---------- */
function ImportModal({ orgId, defaultLeague, onClose, onDone }: { orgId: string; defaultLeague: (typeof JET_LEAGUES)[number]; onClose: () => void; onDone: (l: (typeof JET_LEAGUES)[number]) => void }) {
  const { squads, players, addPlayers } = useData()
  const [parsed, setParsed] = useState<JetParse | null>(null)
  const [file, setFile] = useState('')
  const [league, setLeague] = useState<(typeof JET_LEAGUES)[number]>(defaultLeague)
  const [season, setSeason] = useState('')
  const [off, setOff] = useState<Set<string>>(new Set()) // đội bỏ chọn
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const pick = async (f: File | undefined) => {
    if (!f) return
    const txt = await f.text()
    const r = parseJetCsv(txt)
    setFile(f.name); setParsed(r); setOff(new Set()); setMsg(r.teams.length ? '' : 'Không đọc được đội nào. Kiểm tra file có cột "HỌ & TÊN" và dòng tên đội dạng "SATURN - COACH …".')
    // Đoán mùa và giải từ tên file, ví dụ "JET5_PROJET-BHL".
    const m = f.name.match(/JET\s?(\d+)/i); if (m) setSeason(`JET${m[1]}`)
    const n = f.name.toUpperCase().replace(/[\s_.-]/g, '')
    setLeague(n.includes('PROJET') ? 'PRO.JET' : n.includes('JRJET') ? 'JR.JET' : n.includes('WJET') ? 'WJET' : defaultLeague)
  }
  const chosen = parsed?.teams.filter((t) => !off.has(t.name)) ?? []
  const total = chosen.reduce((n, t) => n + t.players.length, 0)

  const run = async () => {
    setBusy(true); setMsg('')
    let teamsMade = 0, added = 0, dup = 0
    try {
      for (const t of chosen) {
        const { data, error } = await supabase.rpc('jet_team_create', { p_org: orgId, p_league: league, p_season: season.trim(), p_name: t.name, p_coach: t.coach })
        if (error) throw new Error(`${t.name}: ${error.message}`)
        const sid = data as string
        const existing = players.filter((p) => p.squadId === sid)
        const have = new Set(existing.map((p) => fold(p.name)))
        const fresh = t.players.filter((p) => !have.has(fold(p.name)))
        dup += t.players.length - fresh.length
        if (fresh.length) addPlayers(sid, fresh.map((p) => ({ number: null, name: p.name })))
        added += fresh.length
        if (!squads.some((s) => s.id === sid)) teamsMade++
      }
      await new Promise((r) => setTimeout(r, 600))
      await useData.getState().loadBase()
      toast(`Đã nhập ${chosen.length} đội, ${added} VĐV${dup ? ` (bỏ ${dup} VĐV đã có)` : ''}`)
      onDone(league)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
    void teamsMade
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack jt-import" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Nhập danh sách đội từ file CSV của JET</b><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="muted small-note">Chọn file bảng tính JET (xuất ra .csv). App chỉ đọc <b>tên đội, HLV, họ tên VĐV</b> (không lấy số áo: mỗi trận một số). Số điện thoại, ngày sinh, chiều cao, cân nặng, học phí… bị bỏ qua ngay khi đọc và không lưu.</div>
        <div className="row"><button className="btn" onClick={() => input.current?.click()}>Chọn file…</button><span className="muted small-note">{file || 'Chưa chọn file'}</span>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} /></div>
        {parsed && (
          <>
            <div className="org-form">
              <select value={league} onChange={(e) => setLeague(e.target.value as (typeof JET_LEAGUES)[number])}>{JET_LEAGUES.map((l) => <option key={l}>{l}</option>)}</select>
              <input placeholder="Mùa giải (vd: JET5)" value={season} onChange={(e) => setSeason(e.target.value)} />
            </div>
            <div className="jt-prev">
              {parsed.teams.map((t) => {
                const warn = t.players.filter((p) => p.note)
                return (
                  <label key={t.name} className={`jt-team ${off.has(t.name) ? 'off' : ''}`}>
                    <div className="row"><input type="checkbox" checked={!off.has(t.name)} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(t.name); else n.add(t.name); return n })} />
                      <b className="grow">{t.name}</b><span className="muted small-note">{t.coach ? `HLV ${t.coach} · ` : ''}{t.players.length} VĐV</span></div>
                    <div className="jt-names">{t.players.map((p) => <span key={p.name} title={p.note}>{p.name}</span>)}</div>
                    {warn.length > 0 && <div className="jt-warn">⚠ {warn.map((p) => `${p.name}: ${p.note}`).join(' · ')}</div>}
                  </label>
                )
              })}
              {parsed.skipped.length > 0 && <div className="jt-warn">Không nhập: {parsed.skipped.map((s) => `${s.name} (${s.team}, ${s.why})`).join(' · ')}</div>}
            </div>
            <div className="muted small-note">Chạy lại file không tạo đội hay VĐV trùng. Số áo nhập theo từng trận khi tạo trận.</div>
          </>
        )}
        {msg && <div className="err">{msg}</div>}
        <div className="row"><span className="muted small-note grow">{parsed ? `${chosen.length} đội · ${total} VĐV` : ''}</span>
          <button className="btn" onClick={onClose}>Huỷ</button>
          <button className="btn primary" disabled={!parsed || !chosen.length || busy} onClick={run}>{busy ? 'Đang nhập…' : `Nhập ${total} VĐV`}</button></div>
      </div>
    </div>
  )
}

/* ---------- Tạo trận giữa hai đội JET ---------- */
function MatchModal({ league, onClose, onCreated }: { league: string; onClose: () => void; onCreated: () => void }) {
  const { orgId, set } = useUi(useShallow((s) => ({ orgId: s.orgId, set: s.set })))
  const { squads, players, addGame, setTeamNames, setGameAwaySquad, setClock } = useData()
  const jet = useMemo(() => squads.filter((s) => s.orgId === orgId && s.league).sort((a, b) => (a.league ?? '').localeCompare(b.league ?? '') || a.name.localeCompare(b.name, 'vi')), [squads, orgId])
  const inLeague = jet.filter((s) => s.league === league)
  const [home, setHome] = useState(inLeague[0]?.id ?? jet[0]?.id ?? '')
  const [away, setAway] = useState(inLeague[1]?.id ?? jet[1]?.id ?? '')
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), len: 600, title: '' })
  const H = jet.find((s) => s.id === home), A = jet.find((s) => s.id === away)
  const title = f.title.trim() || (H && A ? `${H.league} · ${H.name} vs ${A.name}` : '')
  const create = () => {
    if (!H || !A || H.id === A.id) return
    const { gameId } = addGame({ squadId: H.id, title, date: f.date }, [])
    setTeamNames(gameId, H.name, A.name)
    // Chờ trận được lưu lên máy chủ rồi mới ghi đội khách và đồng hồ. Danh sách VĐV + số áo nhập ở "Danh sách trận".
    setTimeout(() => {
      setClock(gameId, { periodLen: f.len, clockPeriod: 1, clockRemaining: f.len, clockRunning: false, clockStartedAt: null })
      setGameAwaySquad(gameId, A.id)
    }, 700)
    set({ squadId: H.id }); selectGame(gameId)
    toast(`Đã tạo trận ${H.name} vs ${A.name}. Mở Live Stats…`)
    onCreated()
  }
  const opts = (excl?: string) => jet.filter((s) => s.id !== excl).map((s) => <option key={s.id} value={s.id}>{s.league}{s.season ? ` ${s.season}` : ''} · {s.name} ({players.filter((p) => p.squadId === s.id).length})</option>)
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <b>Tạo trận JET</b>
        <div className="muted small-note">Tên VĐV hai đội có sẵn khi mở “Danh sách trận”; bạn chỉ cần nhập số áo từng người cho trận này (Live Stats → Danh sách trận / số áo).</div>
        <div className="org-form">
          <label className="field-label">Đội nhà (HOME)</label>
          <select value={home} onChange={(e) => setHome(e.target.value)}>{opts()}</select>
          <label className="field-label">Đội khách (AWAY)</label>
          <select value={away} onChange={(e) => setAway(e.target.value)}>{opts(home)}</select>
          <input placeholder={title || 'Tên trận'} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <select value={f.len} onChange={(e) => setF({ ...f, len: +e.target.value })}>{[10, 8, 12, 6].map((m) => <option key={m} value={m * 60}>Mỗi hiệp {m} phút</option>)}</select>
        </div>
        <div className="row"><button className="btn" onClick={onClose}>Huỷ</button><button className="btn primary grow-btn" disabled={!H || !A || H.id === A.id} onClick={create}>Tạo trận và mở Live Stats</button></div>
      </div>
    </div>
  )
}
