'use client'

// ── Scan-first debagging — shared across all capture sections ─────────────────
// The primary way to debag: one field, scan a bag, a popup shows that bag's
// record from bag_tags (via validateBagScan) and whether it's a valid input
// here, then confirm to consume it into this section. Each section supplies its
// own onConsume (which maps the tag → that section's input row) and onManual.

import { useRef, useEffect } from 'react'
import { Package, X, Check, AlertTriangle, PackageCheck } from 'lucide-react'
import { sanitizeSerial } from '@/lib/production/scan-utils'
import type { ScanValidationResult } from '@/lib/production/validate-scan'

const INP = 'w-full px-3 py-2.5 min-h-[42px] rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand'

export function ScanBox({ serial, busy, color, onChange, onScan }: {
  serial: string; busy: boolean; color: string
  onChange: (v: string) => void; onScan: (s: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // Auto-fire once the scanned serial settles — a hardware scanner types the
  // whole serial in one burst and usually doesn't send Enter, so we don't make
  // the operator tap anything: scan and the record pops up.
  useEffect(() => {
    const s = serial.trim()
    if (!s) return
    const t = setTimeout(() => onScan(s), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])
  return (
    <div className="rounded-2xl border-2 p-4" style={{ borderColor: color + '40', background: color + '08' }}>
      <label className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color }}>
        <Package size={14} /> Scan a bag to debag
      </label>
      <div className="flex gap-2 mt-2">
        <input ref={ref} data-serial="true" autoFocus value={serial}
          onChange={e => onChange(sanitizeSerial(e.target.value))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onScan(serial) } }}
          placeholder="Scan barcode or type serial…" autoCapitalize="characters" spellCheck={false}
          className={INP + ' flex-1 text-[15px]'} />
        <button onClick={() => onScan(serial)} disabled={!serial.trim() || busy}
          className="px-4 rounded-xl text-white text-[13px] font-semibold disabled:opacity-40 shrink-0" style={{ background: color }}>
          {busy ? '…' : 'Look up'}
        </button>
      </div>
      <p className="text-[11px] text-stone-400 mt-1.5">Scan a bag — its record opens so you can confirm and consume it here.</p>
    </div>
  )
}

export function BagScanModal({ serial, result, sectionLabel, onConsume, onManual, onClose }: {
  serial: string; result: ScanValidationResult; sectionLabel: string
  onConsume: () => void; onManual: () => void; onClose: () => void
}) {
  const tag     = result.tag
  const status  = result.status
  const found   = status !== 'not_found'
  const blocked = status === 'already_consumed'     // hard stop — used elsewhere
  const isWarn  = status === 'wrong_variant' || status === 'wrong_type' || status === 'finished_product'
  const rows: [string, string][] = tag ? [
    ['Product type', tag.product_type || '—'],
    ['Weight',       tag.weight_kg != null ? `${tag.weight_kg} kg` : '—'],
    ['Variant',      tag.variant || '—'],
    ['Lot / Batch',  (tag.lot_number && tag.lot_number !== 'NOT TRACKED') ? tag.lot_number : '—'],
    ['Made at',      tag.section_name || tag.section_id || '—'],
    ['Tagged',       tag.tag_date ? tag.tag_date.slice(0, 10) : '—'],
  ] : []
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-stone-100">
          <div>
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest mb-1">Scanned bag</p>
            <h2 className="font-mono font-bold text-[18px] text-stone-900 tracking-wide break-all">{serial}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 shrink-0"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {found && tag ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {rows.map(([l, v]) => (
                  <div key={l} className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                    <div className="text-[9px] font-semibold text-stone-400 uppercase tracking-wide mb-1">{l}</div>
                    <div className="font-mono text-[12px] font-bold text-stone-800 break-all">{v}</div>
                  </div>
                ))}
              </div>
              <div className={`rounded-xl px-3 py-2.5 text-[12px] font-medium flex items-start gap-2 ${
                status === 'ok'  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : blocked        ? 'bg-red-50 text-red-700 border border-red-200'
                :                  'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                {status === 'ok' ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <span>{status === 'ok' ? `Valid input for ${sectionLabel} — ready to consume.` : result.message}</span>
              </div>
              {blocked
                ? <button onClick={onClose} className="w-full py-3 rounded-xl bg-stone-100 text-stone-600 text-[14px] font-medium">Close</button>
                : <button onClick={onConsume} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white text-[14px] font-semibold">
                    <PackageCheck size={16} /> {isWarn ? 'Consume anyway' : `Consume into ${sectionLabel}`}
                  </button>}
            </>
          ) : (
            <>
              <div className="rounded-xl px-3 py-3 text-[12px] bg-amber-50 text-amber-700 border border-amber-200 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{result.message || `Serial "${serial}" isn't registered in the system.`}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 text-[14px] font-medium">Close</button>
                <button onClick={onManual} className="flex-1 py-3 rounded-xl bg-brand text-white text-[14px] font-semibold">Enter manually</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
