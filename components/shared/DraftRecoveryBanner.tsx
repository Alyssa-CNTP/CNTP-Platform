'use client'

// components/shared/DraftRecoveryBanner.tsx
//
// Shown when a quality capture page finds a localStorage draft on load (see
// lib/hooks/useDraftAutosave.ts) — the last autosave of an in-progress entry
// that never made it into the database, e.g. the tab closed or the network
// dropped mid-save. Restoring re-opens the form pre-filled; discarding just
// drops the stale draft. Never auto-applies itself — the person capturing
// the data decides, since a silently-reopened form could otherwise surprise
// someone who deliberately abandoned that entry.

export default function DraftRecoveryBanner({ savedAt, onRestore, onDiscard }: {
  savedAt: string
  onRestore: () => void
  onDiscard: () => void
}) {
  const when = (() => {
    try { return new Date(savedAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }
    catch { return savedAt }
  })()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8,
      padding: '10px 14px', marginBottom: 14, fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, color: '#92400e' }}>⚠ Unsaved entry recovered</span>
      <span style={{ color: '#78350f' }}>
        A capture from {when} never made it to the database — likely a lost connection or a closed tab.
      </span>
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        <button onClick={onDiscard}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
          Discard
        </button>
        <button onClick={onRestore}
          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#92400e', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          Restore it
        </button>
      </div>
    </div>
  )
}
