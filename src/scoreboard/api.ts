import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

export interface SbState {
  name: string; league: string; home: string; away: string
  score: { home: number; away: number }
  period: number; periodLen: number; clock: number; running: boolean; canControl: boolean
  homeColor: string; awayColor: string; homeLogoV: string; awayLogoV: string
}

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
export const qLabel = (n: number) => (n <= 4 ? `Q${n}` : `OT${n - 4}`)

export async function sbAct(token: string, action: string, arg?: number | null, side?: 'home' | 'away'): Promise<string> {
  const { data, error } = await supabase.rpc('sb_act', { p_token: token, p_action: action, p_arg: arg ?? null, p_side: side ?? null })
  return error ? error.message : (data as string)
}

/** Hỏi trạng thái bảng định kỳ (không cần đăng nhập). Đồng hồ chạy tiếp ở máy giữa các lần hỏi. */
export function useSbState(token: string, everyMs: number) {
  const [st, setSt] = useState<SbState | null>(null)
  const [err, setErr] = useState('')
  const fetchedAt = useRef(Date.now())
  const [, tick] = useState(0)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    if (!token) return
    const { data, error } = await supabase.rpc('sb_state', { p_token: token })
    if (!alive.current) return
    if (error) return setErr('Mất kết nối, đang thử lại…')
    const d = data as { error?: string } & SbState
    if (d?.error) { setSt(null); return setErr(d.error) }
    setErr(''); fetchedAt.current = Date.now(); setSt(d)
  }, [token])

  useEffect(() => {
    alive.current = true
    void reload()
    const iv = setInterval(() => { void reload() }, everyMs)
    const t = setInterval(() => tick((n) => n + 1), 200)
    return () => { alive.current = false; clearInterval(iv); clearInterval(t) }
  }, [reload, everyMs])

  const clock = st ? (st.running ? Math.max(0, st.clock - (Date.now() - fetchedAt.current) / 1000) : st.clock) : 0
  return { st, setSt, err, reload, clock }
}

/** Logo 2 đội: chỉ tải lại khi mã logo (md5) thay đổi. */
export function useSbLogos(token: string, st: SbState | null) {
  const [logos, setLogos] = useState<{ home: string | null; away: string | null }>({ home: null, away: null })
  const key = st ? `${st.homeLogoV}|${st.awayLogoV}` : ''
  useEffect(() => {
    if (!st) return
    if (!st.homeLogoV && !st.awayLogoV) { setLogos({ home: null, away: null }); return }
    let live = true
    void supabase.rpc('sb_logos', { p_token: token }).then(({ data }) => {
      if (live && data) setLogos({ home: (data as any).home ?? null, away: (data as any).away ?? null })
    })
    return () => { live = false }
  }, [token, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return logos
}

/** Màu chữ đọc được trên nền màu đội. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return l > 0.6 ? '#0b0b0c' : '#ffffff'
}
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
