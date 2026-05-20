'use client'

/**
 * ConfirmSheet
 * ─────────────────────────────────────────────────────────────────────────────
 * A bottom-sheet confirmation dialog. Replaces window.confirm() which is
 * unreliable on tablets (some Android browsers block it entirely).
 *
 * Usage:
 *   const [showConfirm, setShowConfirm] = useState(false)
 *
 *   <ConfirmSheet
 *     open={showConfirm}
 *     title="Submit count?"
 *     message="Once submitted you cannot edit this count."
 *     confirmLabel="Yes, submit"
 *     danger={false}
 *     onConfirm={() => { setShowConfirm(false); doSubmit() }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */

import BottomSheet from '@/components/ui/BottomSheet'
import { AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

interface ConfirmSheetProps {
  open:         boolean
  title:        string
  message?:     string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:       boolean   // red confirm button for destructive actions
  onConfirm:    () => void
  onCancel:     () => void
}

export default function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  danger       = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <BottomSheet open={open} onClose={onCancel}>
      <div className="bg-surface-card rounded-2xl rounded-b-none lg:rounded-2xl p-6 w-full max-w-[420px] space-y-4">
        {/* Icon + title */}
        <div className="flex items-start gap-3">
          {danger && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-err-bg border border-err/20 flex items-center justify-center">
              <AlertTriangle size={20} className="text-status-error" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display font-extrabold text-[18px] text-text leading-snug">{title}</p>
            {message && (
              <p className="text-sm text-text-muted mt-1 leading-relaxed">{message}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onConfirm}
            className={clsx(
              'w-full py-3.5 rounded-xl font-display font-bold text-base transition-all',
              danger
                ? 'bg-status-error text-white hover:opacity-90'
                : 'bg-brand text-white hover:opacity-90'
            )}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-display font-bold text-base text-text-muted border border-surface-rule hover:bg-surface transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
