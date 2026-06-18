'use client'

// components/dashboard/editable/WidgetPicker.tsx
// "Add widget" panel shown in edit mode. Lists every widget the user is allowed
// to add (registry + permission filter), grouped by category. Clicking one adds
// an instance to the layout.

import { useEffect } from 'react'
import { X, Plus, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { listAddableWidgets, type WidgetCategory } from '@/lib/dashboard/registry'

const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  kpi:        'KPI tiles',
  production: 'Production',
  personal:   'Personal',
}
const CATEGORY_ORDER: WidgetCategory[] = ['kpi', 'production', 'personal']

interface Props {
  open:          boolean
  onClose:       () => void
  onAdd:         (type: string) => void
  presentTypes:  Set<string>
}

export default function WidgetPicker({ open, onClose, onAdd, presentTypes }: Props) {
  const { p } = useAuth()

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widgets = listAddableWidgets(p)
  const byCategory = CATEGORY_ORDER
    .map(cat => ({ cat, items: widgets.filter(w => w.category === cat) }))
    .filter(g => g.items.length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(17,24,39,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-surface-card border border-surface-rule shadow-menu"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-surface-rule bg-surface-card">
          <div>
            <h2 className="font-display font-bold text-[16px] text-text">Add a widget</h2>
            <p className="font-mono text-[11px] text-text-muted mt-0.5">Pick a widget to add to your dashboard</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {byCategory.map(({ cat, items }) => (
            <div key={cat}>
              <div className="font-mono text-[10px] uppercase tracking-wide text-text-faint mb-2">
                {CATEGORY_LABEL[cat]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map(w => {
                  const present = presentTypes.has(w.type)
                  return (
                    <button
                      key={w.type}
                      onClick={() => onAdd(w.type)}
                      className="flex items-start gap-3 p-3 rounded-xl border border-surface-rule bg-surface hover:border-brand/40 hover:bg-brand/5 transition-colors text-left group"
                    >
                      <span className="shrink-0 mt-0.5 text-text-muted group-hover:text-brand transition-colors">
                        {w.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="font-body font-semibold text-[12px] text-text">{w.label}</span>
                          {present && (
                            <span className="inline-flex items-center gap-0.5 font-mono text-[9px] text-ok">
                              <Check size={9} /> added
                            </span>
                          )}
                        </span>
                        <span className="block font-mono text-[10px] text-text-muted mt-0.5 leading-snug">
                          {w.description}
                        </span>
                      </span>
                      <Plus size={14} className="shrink-0 mt-0.5 text-text-faint group-hover:text-brand transition-colors" />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
