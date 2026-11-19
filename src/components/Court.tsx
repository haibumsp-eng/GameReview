import { COURT } from '../lib/analytics'

/** Nửa sân FIBA (đường biên cuối ở trên, 10 px = 1 m). Toạ độ trả về chuẩn hoá 0..1. */
export interface CourtShot { id: string; x: number; y: number; made: boolean; color?: string; title?: string }

const W = COURT.w * 10, H = COURT.h * 10
const rim = { x: COURT.rim.x * 10, y: COURT.rim.y * 10 }
const cx = COURT.corner * 10
const cy = rim.y + Math.sqrt((COURT.three * 10) ** 2 - (rim.x - cx) ** 2)

export function Court(props: { shots?: CourtShot[]; pick?: { x: number; y: number } | null; onPick?: (x: number, y: number) => void; className?: string }) {
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!props.onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    props.onPick(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))
  }
  const pw = COURT.paintW * 10, ph = COURT.paintH * 10
  return (
    <svg className={`court ${props.onPick ? 'pickable' : ''} ${props.className ?? ''}`} viewBox={`0 0 ${W} ${H}`} onClick={click}>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} className="court-line court-floor" />
      <rect x={rim.x - pw / 2} y={0.5} width={pw} height={ph} className="court-line court-paint" />
      <circle cx={rim.x} cy={ph} r={18} className="court-line" />
      <path d={`M ${cx} 0.5 L ${cx} ${cy} A ${COURT.three * 10} ${COURT.three * 10} 0 0 0 ${W - cx} ${cy} L ${W - cx} 0.5`} className="court-line" />
      <line x1={rim.x - 9} y1={12} x2={rim.x + 9} y2={12} className="court-line" />
      <circle cx={rim.x} cy={rim.y} r={2.4} className="court-line" />
      {props.shots?.map((s) => s.made
        ? <circle key={s.id} cx={s.x * W} cy={s.y * H} r={3.4} fill={s.color ?? 'var(--accent)'} stroke="#000" strokeWidth={0.6}><title>{s.title}</title></circle>
        : <g key={s.id} stroke={s.color ?? 'var(--accent)'} strokeWidth={1.4}><title>{s.title}</title>
            <line x1={s.x * W - 3} y1={s.y * H - 3} x2={s.x * W + 3} y2={s.y * H + 3} /><line x1={s.x * W + 3} y1={s.y * H - 3} x2={s.x * W - 3} y2={s.y * H + 3} /></g>)}
      {props.pick && <circle cx={props.pick.x * W} cy={props.pick.y * H} r={4.5} className="court-pick" />}
    </svg>
  )
}
