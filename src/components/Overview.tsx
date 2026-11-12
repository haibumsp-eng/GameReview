import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useData, useUi, selectGame } from '../store'

interface Row { game_id: string; squad_id: string; squad_name: string; org_id: string; org_name: string | null; title: string; played_on: string | null; videos: number; clips: number }

/** Màn hình tổng quan: toàn bộ trận bạn được xem, có tìm kiếm theo từ khoá và lọc theo tuyến đội. */
export function Overview() {
  const { isSuper, session, squads: mySquads } = useData()
  const who = session?.user.email ?? ''
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [squad, setSquad] = useState('')
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.rpc('game_overview').then(({ data, error }) => {
      if (error) setErr(error.message)
      else setRows((data ?? []) as Row[])
    })
    input.current?.focus()
  }, [])

  const squads = useMemo(() => {
    const m = new Map<string, string>()
    rows?.forEach((r) => m.set(r.squad_id, isSuper && r.org_name ? `${r.org_name} · ${r.squad_name}` : r.squad_name))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows ?? []).filter((r) => {
      if (squad && r.squad_id !== squad) return false
      const hay = `${r.title} ${r.squad_name} ${r.org_name ?? ''} ${r.played_on ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [rows, q, squad])

  const close = () => useUi.getState().set({ overview: false })
  const open = (r: Row) => {
    useUi.getState().set({ orgId: r.org_id, squadId: r.squad_id })
    selectGame(r.game_id)
    close()
  }

  return (
    <div className="modal-back" onClick={close}>
      <div className="overview card stack" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b className="grow">Tất cả trận đấu {isSuper && <span className="pill live">ADMIN: xem toàn bộ</span>}</b>
          <button className="icon-btn" onClick={close}>×</button>
        </div>
        <div className="row">
          <input ref={input} placeholder="Tìm theo tên trận, tuyến đội, ngày (vd: hà nội 2026-11)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select style={{ width: 200 }} value={squad} onChange={(e) => setSquad(e.target.value)}>
            <option value="">Mọi tuyến đội</option>
            {squads.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="muted">Đang đăng nhập: <b>{who}</b> · {isSuper ? 'quyền ADMIN (xem tất cả)' : `coach, thuộc ${mySquads.length} tuyến đội`}</div>
        {err && <div className="err">{err}</div>}
        {rows && rows.length === 0 && (
          <div className="card stack">
            <b>Tài khoản này chưa xem được trận nào.</b>
            {isSuper
              ? <span>Hệ thống chưa có trận nào. Coach cần thêm trận trước.</span>
              : <span>
                  Coach chỉ thấy trận của tuyến đội mình tạo hoặc được mời vào.
                  Nếu đây là tài khoản admin, hãy chạy file <b>supabase/make-admin.sql</b> trong Supabase (email trong file phải đúng là <b>{who}</b>),
                  rồi đăng xuất và đăng nhập lại.
                </span>}
          </div>
        )}
        {!rows && !err && <div className="muted">Đang tải…</div>}
        {rows && (
          <>
            <div className="muted">{shown.length} / {rows.length} trận</div>
            <div className="ov-table">
              <div className="ov-row ov-head"><span>Ngày</span><span>Trận</span><span>Tuyến đội</span><span>Hiệp</span><span>Mark</span><span /></div>
              {shown.length === 0 && <div className="empty">Không có trận nào khớp.</div>}
              {shown.map((r) => (
                <div key={r.game_id} className="ov-row ov-item" onClick={() => open(r)}>
                  <span className="muted">{r.played_on ?? ''}</span>
                  <span className="item-title">{r.title}</span>
                  <span>{isSuper && r.org_name ? <><span className="muted">{r.org_name} · </span>{r.squad_name}</> : r.squad_name}</span>
                  <span>{r.videos}</span>
                  <span>{r.clips}</span>
                  <span className="btn sm">Mở</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
