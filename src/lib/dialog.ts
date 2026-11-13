import { create } from 'zustand'

/* Hộp thoại theo giao diện app, thay cho confirm / prompt / alert của trình duyệt. */
export interface Field {
  key: string
  label?: string
  placeholder?: string
  value?: string
  options?: { value: string; label: string }[] // có options thì là ô chọn
  inputMode?: 'text' | 'numeric' | 'url'
}
export interface DialogOpts {
  title: string
  message?: string
  fields?: Field[]
  okText?: string
  cancelText?: string | null // null = không có nút huỷ (thông báo)
  danger?: boolean
  /** Trả về câu báo lỗi để giữ hộp thoại mở, hoặc null nếu hợp lệ. */
  validate?: (values: Record<string, string>) => string | null
}
interface Open { opts: DialogOpts; resolve: (v: Record<string, string> | null) => void }
export const useDialog = create<{ open: Open | null }>(() => ({ open: null }))

function show(opts: DialogOpts): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const prev = useDialog.getState().open
    if (prev) prev.resolve(null) // chỉ một hộp thoại một lúc
    useDialog.setState({ open: { opts, resolve: (v) => { useDialog.setState({ open: null }); resolve(v) } } })
  })
}

/** Hỏi lại. true nếu đồng ý. */
export async function confirmDialog(o: { title: string; message?: string; okText?: string; danger?: boolean }): Promise<boolean> {
  return (await show({ ...o, okText: o.okText ?? 'Đồng ý' })) !== null
}
/** Nhập một ô. null nếu huỷ. */
export async function promptDialog(o: { title: string; message?: string; label?: string; value?: string; placeholder?: string; okText?: string; inputMode?: Field['inputMode']; validate?: (v: string) => string | null }): Promise<string | null> {
  const r = await show({
    title: o.title, message: o.message, okText: o.okText ?? 'Lưu',
    fields: [{ key: 'v', label: o.label, value: o.value, placeholder: o.placeholder, inputMode: o.inputMode }],
    validate: o.validate ? (vals) => o.validate!(vals.v ?? '') : undefined,
  })
  return r ? (r.v ?? '').trim() : null
}
/** Biểu mẫu nhiều ô. null nếu huỷ. */
export function formDialog(o: DialogOpts): Promise<Record<string, string> | null> {
  return show({ okText: 'Lưu', ...o })
}
/** Thông báo một nút. */
export async function alertDialog(o: { title: string; message?: string }): Promise<void> {
  await show({ ...o, okText: 'Đã hiểu', cancelText: null })
}
/** Có hộp thoại đang mở (để phím tắt của app tạm nghỉ). */
export const dialogOpen = () => useDialog.getState().open !== null
