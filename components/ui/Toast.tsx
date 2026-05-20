'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import clsx from 'clsx'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id:      number
  message: string
  type:    ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counter.current
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const icons = { success: <CheckCircle size={14} />, error: <AlertCircle size={14} />, info: <Info size={14} /> }
  const colors = {
    success: 'bg-status-ok text-white',
    error:   'bg-status-error text-white',
    info:    'bg-status-info text-white',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-[9999] items-center pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-menu font-mono text-xs font-medium whitespace-nowrap pointer-events-auto',
              colors[t.type]
            )}
          >
            {icons[t.type]}
            {t.message}
            <button
              onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}
              className="ml-1 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx.toast
}
