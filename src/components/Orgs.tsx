import { useState } from 'react'
import { useData, useUi, myOrgRole, orgExpired } from '../store'
import type { Org } from '../types'

const ROLE_LABEL: Record<string, string> = { owner: 'Chủ trung tâm', coach: 'HLV', viewer: 'Chỉ xem' }
const PLAN_LABEL: Record<string, string> = { trial: 'Dùng thử', team: 'Đội', club: 'CLB / Học viện', custom: 'Riêng' }

/** Chủ trung tâm: xem và quản lý thành viên của trung tâm mình. */
export function OrgMembersModal(props: { onClose: () => void }) {
  const orgId = useUi((s) => s.orgId)
  const { orgs, orgMembers, profiles, session, addOrgMember, setOrgRole, removeOrgMember, regenCode } = useData()
  const [copied, setCopied] = useState(false)
  const org = orgs.find((o) => o.id === orgId)
  const isOwner = myOrgRole(orgId) === 'owner' || useData.getState().isSuper
  const members = orgMembers.filter((m) => m.orgId === orgId)
    .sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || (profiles[a.userId] ?? '').localeCompare(profiles[b.userId] ?? ''))
  const [login, setLogin] = useState('')
  const [role, setRole] = useState('coach')
  const [msg, setMsg] = useState('')

  const add = async () => {
    if (!login.trim()) return
    const err = await addOrgMember(orgId, login, role)
    setMsg(err ?? 'Đã thêm. Hãy mời họ vào tuyến đội bằng nút 👤 ở module Thư viện.')
    if (!err) setLogin('')
  }

  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Thành viên · {org?.name}</b><button className="icon-btn" onClick={props.onClose}>×</button></div>
        <div className="muted">Mỗi tài khoản chỉ thuộc một trung tâm. Chủ trung tâm thấy mọi tuyến đội; HLV chỉ thấy tuyến được mời vào.</div>
        {isOwner && org && (
          <div className="card join-code-card">
            <div className="stack" style={{ gap: 2 }}>
              <span className="field-label">Mã tham gia trung tâm</span>
              <span className="join-code">{org.joinCode || '——'}</span>
              <span className="muted small-note">Gửi mã này cho HLV mới: khi đăng ký nhập mã là vào thẳng {org.name}. Họ chưa thấy tuyến nào cho tới khi bạn mời vào tuyến bằng nút 👤.</span>
            </div>
            <div className="stack">
              <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(org.joinCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? '✓ Đã copy' : 'Copy mã'}</button>
              <button className="btn sm ghost" onClick={async () => { if (confirm('Đổi mã mới? Mã cũ sẽ không dùng được nữa.')) { const e = await regenCode(org.id); if (e) alert(e) } }}>Đổi mã</button>
            </div>
          </div>
        )}
        <ul className="list">
          {members.map((m) => (
            <li key={m.userId} className="item" style={{ cursor: 'default' }}>
              <span className="grow"><b>{profiles[m.userId] || 'Thành viên'}</b>{m.userId === session?.user.id && <span className="muted"> (bạn)</span>}</span>
              {isOwner && m.userId !== session?.user.id ? (
                <>
                  <select style={{ width: 140 }} value={m.role} onChange={(e) => setOrgRole(orgId, m.userId, e.target.value)}>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button className="icon-btn" title="Gỡ khỏi trung tâm" onClick={() => confirm(`Gỡ ${profiles[m.userId] || 'người này'} khỏi trung tâm?`) && removeOrgMember(orgId, m.userId)}>×</button>
                </>
              ) : <span className="tag">{ROLE_LABEL[m.role]}</span>}
            </li>
          ))}
        </ul>
        {isOwner && (
          <div className="card stack">
            <label className="field-label">Thêm người vào trung tâm (họ phải đăng ký tài khoản trước)</label>
            <div className="row">
              <input placeholder="Tên đăng nhập hoặc email" value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
              <select style={{ width: 150 }} value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn primary" onClick={add}>Thêm</button>
            </div>
            {msg && <div className="muted">{msg}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Quản trị hệ thống: tạo trung tâm, đặt gói cước, ngày hết hạn. */
export function OrgAdminModal(props: { onClose: () => void }) {
  const { orgs, squads, createOrg } = useData()
  const [form, setForm] = useState({ name: '', owner: '', plan: 'trial', max: '1', expires: '' })
  const [msg, setMsg] = useState('')

  const create = async () => {
    if (!form.name.trim() || !form.owner.trim()) return setMsg('Nhập tên trung tâm và tài khoản chủ trung tâm.')
    const err = await createOrg(form.name.trim(), form.owner, form.plan, form.max ? +form.max : null, form.expires || null)
    setMsg(err ?? `Đã tạo trung tâm “${form.name}”.`)
    if (!err) setForm({ name: '', owner: '', plan: 'trial', max: '1', expires: '' })
  }

  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="overview card stack" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">Quản lý trung tâm <span className="pill live">ADMIN HỆ THỐNG</span></b><button className="icon-btn" onClick={props.onClose}>×</button></div>
        <div className="ov-table">
          <div className="ov-row org-row ov-head"><span>Trung tâm · mã</span><span>Gói</span><span>Tuyến tối đa</span><span>Hết hạn</span><span>Tuyến</span><span /></div>
          {orgs.map((o) => <OrgRow key={o.id} org={o} squads={squads.filter((s) => s.orgId === o.id).length} />)}
        </div>
        <div className="card stack">
          <b>Tạo trung tâm mới</b>
          <div className="org-form">
            <input placeholder="Tên trung tâm / CLB" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Tài khoản chủ trung tâm (đã đăng ký)" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="number" min={1} placeholder="Số tuyến tối đa (trống = không giới hạn)" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
            <input type="date" title="Ngày hết hạn (trống = không hết hạn)" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
            <button className="btn primary" onClick={create}>Tạo trung tâm</button>
          </div>
          {msg && <div className="muted">{msg}</div>}
        </div>
      </div>
    </div>
  )
}

function OrgRow({ org, squads }: { org: Org; squads: number }) {
  const { updateOrg } = useData()
  const [v, setV] = useState({ plan: org.plan, max: org.maxSquads?.toString() ?? '', expires: org.expiresOn ?? '' })
  const [saved, setSaved] = useState('')
  const dirty = v.plan !== org.plan || v.max !== (org.maxSquads?.toString() ?? '') || v.expires !== (org.expiresOn ?? '')
  const save = async () => {
    const err = await updateOrg(org.id, { plan: v.plan, maxSquads: v.max ? +v.max : null, expiresOn: v.expires || null })
    setSaved(err ?? 'Đã lưu')
  }
  return (
    <div className="ov-row org-row">
      <span className="item-title">{org.name} <span className="tag">{org.joinCode}</span> {orgExpired(org) && <span className="badge DEF">Hết hạn</span>}</span>
      <select value={v.plan} onChange={(e) => setV({ ...v, plan: e.target.value })}>
        {Object.entries(PLAN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input type="number" min={1} placeholder="∞" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
      <input type="date" value={v.expires} onChange={(e) => setV({ ...v, expires: e.target.value })} />
      <span>{squads}</span>
      <button className="btn sm primary" disabled={!dirty} onClick={save} title={saved}>{saved && !dirty ? '✓' : 'Lưu'}</button>
    </div>
  )
}
