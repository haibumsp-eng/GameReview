import { useEffect, useState } from 'react'
import type { GamePlayer, LineupEvent, TeamSide } from '../types'
import { periodLabel } from '../lib/boxscore'
import { courtAt, mmss } from '../lib/minutes'
import type { LineupPatch } from '../store'

const parseClock = (v: string) => { const m = v.trim().match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null }
const periods = (n: number) => Array.from({ length: Math.max(8, n) }, (_, i) => i + 1)

/** Sửa một lần vào / ra sân ngay trong Play-by-play: đổi cầu thủ, vào ↔ ra, hiệp, giờ. */
export function SubEditor(props: {
  e: LineupEvent
  players: GamePlayer[]
  update: (patch: LineupPatch) => void
  remove: () => void
  close: () => void
  say: (msg: string) => void
}) {
  const { e } = props
  const [clock, setClock] = useState(mmss(e.clockS))
  useEffect(() => { setClock(mmss(e.clockS)) }, [e.id, e.clockS])
  const list = props.players.filter((p) => p.side === e.side).sort((a, b) => a.number - b.number)
  const save = () => {
    const v = parseClock(clock)
    if (v == null) { setClock(mmss(e.clockS)); return props.say('Giờ nhập dạng 7:32') }
    if (v !== Math.round(e.clockS)) props.update({ clockS: v })
  }
  return (
    <div className="se" onClick={(ev) => ev.stopPropagation()}>
      <div className="se-row">
        <span className="se-lbl">Vào / ra sân</span>
        <div className="se-chips">
          <button className={`se-chip type ${e.kind === 'in' ? 'on' : ''}`} onClick={() => props.update({ kind: 'in' })}>SUB IN (vào sân)</button>
          <button className={`se-chip type ${e.kind === 'out' ? 'on' : ''}`} onClick={() => props.update({ kind: 'out' })}>SUB OUT (ra sân)</button>
        </div>
      </div>
      <div className="se-row">
        <span className="se-lbl">Cầu thủ</span>
        <div className="se-chips">
          {list.map((p) => <button key={p.id} className={`se-chip ${e.gamePlayerId === p.id ? 'on' : ''}`} title={p.name} onClick={() => props.update({ gamePlayerId: p.id })}>{p.number}</button>)}
        </div>
      </div>
      <div className="se-row se-foot">
        <label className="se-time">Hiệp
          <select value={e.period} onChange={(ev) => props.update({ period: +ev.target.value })}>{periods(e.period).map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}</select>
        </label>
        <label className="se-time">Giờ
          <input value={clock} placeholder="7:32" inputMode="numeric" onChange={(ev) => setClock(ev.target.value)} onBlur={save} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }} />
        </label>
        <span className="grow" />
        <button className="btn sm danger" onClick={props.remove}>Xoá</button>
        <button className="btn sm primary" onClick={props.close}>Xong</button>
      </div>
    </div>
  )
}

/**
 * Bổ sung một lần thay người đã quên ghi, ở GIỜ TUỲ CHỌN (mặc định là giờ hiện tại).
 * Danh sách "ra sân / vào sân" tính theo ai đang trên sân vào đúng giờ đó.
 */
export function SubForm(props: {
  players: GamePlayer[]
  lineups: LineupEvent[]
  homeName: string
  awayName: string
  period: number
  clockS: number
  add: (side: TeamSide, kind: 'in' | 'out', playerId: string, period: number, clockS: number) => void
  close: () => void
  say: (msg: string) => void
}) {
  const [side, setSide] = useState<TeamSide>('home')
  const [period, setPeriod] = useState(props.period)
  const [clock, setClock] = useState(mmss(props.clockS))
  const [outs, setOuts] = useState<Set<string>>(new Set())
  const [ins, setIns] = useState<Set<string>>(new Set())
  const t = parseClock(clock)
  const on = t == null ? new Set<string>() : courtAt(props.lineups, side, period, t)
  const roster = props.players.filter((p) => p.side === side).sort((a, b) => a.number - b.number)
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n) }
  const after = on.size - outs.size + ins.size
  const reset = (s: TeamSide) => { setSide(s); setOuts(new Set()); setIns(new Set()) }

  const submit = () => {
    if (t == null) return props.say('Giờ nhập dạng 7:32')
    if (!outs.size && !ins.size) return props.say('Chọn ít nhất một cầu thủ ra hoặc vào sân')
    for (const id of outs) props.add(side, 'out', id, period, t)
    for (const id of ins) props.add(side, 'in', id, period, t)
    props.say(`Đã ghi thay người ${periodLabel(period)} ${mmss(t)}: ${outs.size} ra, ${ins.size} vào`)
    props.close()
  }
  const name = (s: TeamSide) => (s === 'home' ? props.homeName : props.awayName)
  return (
    <div className="se sf" onClick={(ev) => ev.stopPropagation()}>
      <b className="sf-title">Bổ sung thay người</b>
      <div className="muted small-note">Thay người quên ghi? Chọn đúng hiệp và giờ lúc đó (giờ trên đồng hồ, ví dụ 7:12). Các thống kê, phút và +/- sẽ tính lại theo giờ này. Giờ hiện tại là {periodLabel(props.period)} {mmss(props.clockS)}.</div>
      <div className="se-row se-foot">
        <div className="se-chips">
          {(['home', 'away'] as TeamSide[]).map((s) => <button key={s} className={`se-chip type ${side === s ? 'on' : ''}`} onClick={() => reset(s)}>{name(s)}</button>)}
        </div>
        <label className="se-time">Hiệp
          <select value={period} onChange={(ev) => { setPeriod(+ev.target.value); setOuts(new Set()); setIns(new Set()) }}>{periods(props.period).map((n) => <option key={n} value={n}>{periodLabel(n)}</option>)}</select>
        </label>
        <label className="se-time">Giờ
          <input value={clock} placeholder="7:12" inputMode="numeric" onChange={(ev) => { setClock(ev.target.value); setOuts(new Set()); setIns(new Set()) }} />
        </label>
      </div>
      <div className="se-row">
        <span className="se-lbl">Ra sân (đang trên sân lúc đó)</span>
        <div className="se-chips">
          {roster.filter((p) => on.has(p.id)).map((p) => <button key={p.id} className={`se-chip ${outs.has(p.id) ? 'on' : ''}`} title={p.name} onClick={() => toggle(outs, p.id, setOuts)}>{p.number}</button>)}
          {on.size === 0 && <span className="muted small-note">Chưa có ai trên sân vào giờ này</span>}
        </div>
      </div>
      <div className="se-row">
        <span className="se-lbl">Vào sân (chưa trên sân lúc đó)</span>
        <div className="se-chips">
          {roster.filter((p) => !on.has(p.id)).map((p) => <button key={p.id} className={`se-chip ${ins.has(p.id) ? 'on' : ''}`} title={p.name} onClick={() => toggle(ins, p.id, setIns)}>{p.number}</button>)}
        </div>
      </div>
      <div className="se-row se-foot">
        <span className={`small-note ${after === 5 ? 'muted' : 'sf-warn'}`}>Sau thay người: {after} người trên sân{after !== 5 && ' (nên đủ 5)'}</span>
        <span className="grow" />
        <button className="btn sm" onClick={props.close}>Huỷ</button>
        <button className="btn sm primary" onClick={submit}>Ghi thay người</button>
      </div>
    </div>
  )
}
