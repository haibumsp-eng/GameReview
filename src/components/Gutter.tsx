import { useRef, type ReactNode } from 'react'

/** Thanh kéo thả giữa hai module. dir="col": kéo ngang. dir="row": kéo dọc. */
export function Gutter<T>(props: {
  dir: 'col' | 'row'
  begin: () => T
  move: (start: T, dx: number, dy: number) => void
  onDouble?: () => void
}) {
  const st = useRef<{ x: number; y: number; s: T } | null>(null)
  return (
    <div
      className={`gutter ${props.dir}`}
      onDoubleClick={props.onDouble}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        st.current = { x: e.clientX, y: e.clientY, s: props.begin() }
        document.body.classList.add('dragging')
      }}
      onPointerMove={(e) => {
        if (st.current) props.move(st.current.s, e.clientX - st.current.x, e.clientY - st.current.y)
      }}
      onPointerUp={() => { st.current = null; document.body.classList.remove('dragging') }}
      onPointerCancel={() => { st.current = null; document.body.classList.remove('dragging') }}
    />
  )
}

/** Hai module xếp dọc, kéo thanh giữa để đổi tỉ lệ chiều cao. */
export function SplitV(props: {
  frac: number
  setFrac: (f: number) => void
  top: ReactNode
  bottom: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div className="split" ref={box}>
      <div className="slot" style={{ flex: `${props.frac} 1 0` }}>{props.top}</div>
      <Gutter
        dir="row"
        begin={() => ({ f: props.frac, h: box.current?.getBoundingClientRect().height || 1 })}
        move={(s, _dx, dy) => props.setFrac(Math.min(0.85, Math.max(0.15, s.f + dy / s.h)))}
      />
      <div className="slot" style={{ flex: `${1 - props.frac} 1 0` }}>{props.bottom}</div>
    </div>
  )
}
