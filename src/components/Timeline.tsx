import { useRef } from 'react'
import { useData, useUi, matches } from '../store'
import { yt } from '../youtube'
import { fmt } from '../util'
import { Panel } from './Panel'

export function Timeline() {
  const { gameId, clipId, filter, time, duration, set } = useUi()
  const clips = useData((s) => s.clips).filter((c) => c.gameId === gameId)
  const bar = useRef<HTMLDivElement>(null)
  const filtering = !!(filter.side || filter.playType || filter.playerIds.length)

  const seekFromEvent = (e: React.MouseEvent) => {
    if (!bar.current || !duration) return
    const r = bar.current.getBoundingClientRect()
    yt.seek(((e.clientX - r.left) / r.width) * duration)
  }
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%')

  return (
    <Panel title="Timeline">
      <div className="tl">
        <div className="tl-labels"><span>ATK</span><span>DEF</span></div>
        <div className="tl-bar" ref={bar} onClick={seekFromEvent}>
          {(['ATK', 'DEF'] as const).map((side) => (
            <div key={side} className="tl-lane">
              {clips.filter((c) => c.side === side).map((c) => (
                <div
                  key={c.id}
                  className={[
                    'seg', side,
                    c.id === clipId ? 'sel' : '',
                    filtering && !matches(c, filter) ? 'dim' : '',
                  ].join(' ')}
                  style={{ left: pct(c.start), width: `max(4px, calc(${pct(c.end - c.start)}))` }}
                  title={`${fmt(c.start)} – ${fmt(c.end)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    set({ clipId: c.id, playlist: false })
                    yt.seek(c.start)
                  }}
                />
              ))}
            </div>
          ))}
          <div className="playhead" style={{ left: pct(time) }} />
        </div>
      </div>
    </Panel>
  )
}
