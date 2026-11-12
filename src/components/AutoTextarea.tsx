import { useEffect, useRef, type TextareaHTMLAttributes } from 'react'

/** Ô nhập nhiều dòng tự cao lên theo nội dung. Không giới hạn số ký tự. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number }) {
  const { minRows = 3, maxHeight = 360, ...rest } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight + 2, maxHeight) + 'px'
  }, [props.value, maxHeight])
  return <textarea {...rest} ref={ref} rows={minRows} style={{ overflowY: 'auto', ...rest.style }} />
}
