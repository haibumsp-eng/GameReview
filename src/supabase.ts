import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configError =
  !url || !key
    ? 'Thiếu cấu hình Supabase: cần biến VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY (Vercel → Settings → Environment Variables), sau đó Redeploy.'
    : ''

export const supabase = createClient(url ?? 'https://missing.invalid', key ?? 'missing')
