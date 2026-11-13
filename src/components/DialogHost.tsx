import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../lib/dialog'

/** Hộp thoại ở giữa màn hình, theo giao diện app. Đặt một lần ở gốc ứng dụng. */
export function DialogHost() {
  const open = useDialog((s) => s.open)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const okRef = useRef<HTMLButtonElement>(null)
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  useEffect(() => {
    if (!open) return
    const init: Record<string, string> = {}
    for (const f of open.opts.fields ?? []) init[f.key] = f.value ?? f.options?.[0]?.value ?? ''
    setVals(init); setErr('')
    setTimeout(() => {
      const el = firstRef.current
      if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select() } else okRef.current?.focus()
    }, 30)
  }, [open])

  if (!open) return null
  const o = open.opts
  const submit = () => {
    const e = o.validate?.(vals) ?? null
    if (e) return setErr(e)
    open.resolve(vals)
  }
  const cancel = () => open.resolve(null)

  return (
    <div className="modal-back dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget && o.cancelText !== null) cancel() }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (o.cancelText !== null) cancel() }
        else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); e.stopPropagation(); submit() }
      }}>
      <div className="dialog card stack" role="dialog" aria-modal="true">
        <div className="dialog-title">{o.title}</div>
        {o.message && <div className="dialog-msg">{o.message}</div>}
        {(o.fields ?? []).map((f, i) => (
          <label key={f.key} className="stack dialog-field">
            {f.label && <span className="field-label">{f.label}</span>}
            {f.options ? (
              <select ref={i === 0 ? (el) => { firstRef.current = el } : undefined} value={vals[f.key] ?? ''} onChange={(e) => { setVals({ ...vals, [f.key]: e.target.value }); setErr('') }}>
                {f.options.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
            ) : (
              <input ref={i === 0 ? (el) => { firstRef.current = el } : undefined} inputMode={f.inputMode} placeholder={f.placeholder} value={vals[f.key] ?? ''}
                onChange={(e) => { setVals({ ...vals, [f.key]: e.target.value }); setErr('') }} />
            )}
          </label>
        ))}
        {err && <div className="err">{err}</div>}
        <div className="row dialog-actions">
          {o.cancelText !== null && <button className="btn ghost" onClick={cancel}>{o.cancelText ?? 'Huỷ'}</button>}
          <button ref={okRef} className={`btn ${o.danger ? 'dialog-danger' : 'primary'}`} onClick={submit}>{o.okText ?? 'OK'}</button>
        </div>
      </div>
    </div>
  )
}
