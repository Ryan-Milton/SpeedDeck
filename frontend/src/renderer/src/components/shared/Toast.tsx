import { useEffect, useState, useCallback, useRef } from 'react'
import { cn } from '../../lib/utils'

export interface ToastMessage {
  id: number
  text: string
  variant: 'info' | 'warning' | 'danger' | 'success'
  duration?: number
}

let nextId = 0
const listeners: Set<(msg: ToastMessage) => void> = new Set()

export function showToast(text: string, variant: ToastMessage['variant'] = 'info', duration = 4000): void {
  const msg: ToastMessage = { id: nextId++, text, variant, duration }
  listeners.forEach((fn) => fn(msg))
}

export function ToastContainer(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  useEffect(() => {
    const handler = (msg: ToastMessage): void => {
      setToasts((prev) => [...prev.slice(-4), msg]) // keep max 5
      if (msg.duration && msg.duration > 0) {
        const timer = setTimeout(() => dismiss(msg.id), msg.duration)
        timersRef.current.set(msg.id, timer)
      }
    }
    listeners.add(handler)
    return (): void => {
      listeners.delete(handler)
      timersRef.current.forEach((timer) => clearTimeout(timer))
    }
  }, [dismiss])

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className={cn(
            'pointer-events-auto px-6 py-3 rounded-2xl backdrop-blur-xl shadow-lg',
            'text-sm font-semibold animate-slide-in-down cursor-pointer',
            'min-w-[240px] text-center',
            toast.variant === 'danger' && 'bg-danger/90 text-white',
            toast.variant === 'warning' && 'bg-warning/90 text-black',
            toast.variant === 'success' && 'bg-success/90 text-white',
            toast.variant === 'info' && 'bg-surface-card/95 text-text-primary'
          )}
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}
