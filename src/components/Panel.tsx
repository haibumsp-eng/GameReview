import type { ReactNode } from 'react'

export function Panel(props: {
  title: string
  area: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${props.className ?? ''}`} style={{ gridArea: props.area }}>
      <header className="panel-head">
        <span>{props.title}</span>
        <div className="panel-actions">{props.actions}</div>
      </header>
      <div className="panel-body">{props.children}</div>
    </section>
  )
}
