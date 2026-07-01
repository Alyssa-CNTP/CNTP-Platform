'use client'

// components/shared/LmDecisionModal.tsx
//
// Lab Manager pass/fail/concession decision — replaces the old browser
// prompt() with a proper comment box. The comment is written back to the
// run (final_reason) so the QC on duty who allocated it sees exactly why a
// run was passed/failed, not just the verdict.

import { useState } from 'react'

interface LmDecisionModalProps {
  result: 'Pass' | 'Fail' | 'Concession'
  batchLabel: string
  onConfirm: (comment: string) => void
  onClose: () => void
}

const RESULT_COLOR: Record<string, string> = {
  Pass: '#166534',
  Fail: '#dc2626',
  Concession: '#d97706',
}

export default function LmDecisionModal({ result, batchLabel, onConfirm, onClose }: LmDecisionModalProps) {
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  const required = result !== 'Pass'
  const color = RESULT_COLOR[result]

  function confirm() {
    if (required && !comment.trim()) { setTouched(true); return }
    onConfirm(comment.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-surface-rule rounded-2xl w-full max-w-md shadow-menu">
        <div className="px-5 py-4 border-b border-surface-rule">
          <div className="text-[14px] font-bold text-text">Mark <span style={{ color }}>{result}</span> — {batchLabel}</div>
          <div className="text-[11px] text-text-muted mt-0.5">This comment is sent back to the lab for the QC on duty to see.</div>
        </div>
        <div className="p-5 space-y-2">
          <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
            Comment to QC {required ? '(required)' : '(optional)'}
          </label>
          <textarea
            autoFocus rows={4} value={comment} onChange={e => setComment(e.target.value)}
            placeholder={required ? `Explain why this run is "${result}"…` : 'Any notes for the QC on duty…'}
            className={`w-full border rounded-xl px-3 py-2 text-[12px] outline-none ${touched && required && !comment.trim() ? 'border-err/50' : 'border-surface-rule'}`}
          />
          {touched && required && !comment.trim() && (
            <div className="text-[11px] text-err">A comment is required for {result}.</div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-surface-rule">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-surface-rule text-text-muted text-[12px]">Cancel</button>
          <button onClick={confirm} className="px-5 py-2 rounded-xl text-white text-[12px] font-bold" style={{ background: color }}>
            Send {result}
          </button>
        </div>
      </div>
    </div>
  )
}
