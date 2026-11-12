export const uid = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  Math.random().toString(36).slice(2) + Date.now().toString(36)

export function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v.slice(0, 11)
      const m = u.pathname.match(/\/(embed|live|shorts)\/([\w-]{11})/)
      if (m) return m[2]
    }
  } catch {
    /* not a URL */
  }
  return null
}

/** Nhãn mặc định cho video thứ n của trận: Hiệp 1..4, rồi OT1, OT2… */
export function defaultLabel(n: number): string {
  return n <= 4 ? `Hiệp ${n}` : `OT${n - 4}`
}

/** Tên đăng nhập (không có @) được đổi thành email nội bộ để dùng với Supabase Auth. */
export const USERNAME_DOMAIN = (import.meta.env.VITE_USERNAME_DOMAIN as string | undefined) || 'vercel.app'
export function toLoginEmail(input: string): string {
  const s = input.trim()
  return s.includes('@') ? s : `${s.toLowerCase()}@${USERNAME_DOMAIN}`
}
