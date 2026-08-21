'use client'

// components/notebooks/NoteFields.tsx
// The capture side of a note — a short sequence of sections (Weighbridge →
// Supplier & Goods → Traceability → Certification → Comments), picked from a
// dropdown rather than a row of tabs so the form reads as one thing to work
// through top to bottom, not five competing buttons. NotePaper is what makes
// it look like the physical book, and it only comes into view once there's
// something worth previewing, printing or signing.
//
// The form state is a flat object mirroring the columns, which is exactly what
// the API expects as `header` — no mapping layer in between.
//
// Every field the physical book captures is required — see validateNote() in
// note-draft.ts. A field that still needs filling in gets an amber outline the
// moment it's empty, before the user has even tried to save, so there is no
// surprise at submit time about what's left. Attempting to save with gaps
// still open turns the outstanding ones red and lists them in the banner
// above the Save button (see the [id] and new pages) — "N/A" is a perfectly
// good, deliberate answer for a field that doesn't apply to a given load.

import { useState } from 'react'
import { ChevronDown, Plus, Trash2, Scale, Package, Sprout, ShieldCheck, MessageSquare } from 'lucide-react'
import {
  type DocType, type LineDraft, type NoteHeaderDraft, type HeaderErrors, type LineErrors,
  PARTY_LABEL, CERT_ROWS, emptyLine,
} from './note-draft'
import {
  FIELD_NAME_LABEL, PLANT_YEAR_LABEL, SIGN_BLOCK_LABELS,
  type NoteTab, type RequiredHeaderKey,
} from '@/lib/notebooks/types'

interface Props {
  docType: DocType
  header:  NoteHeaderDraft
  lines:   LineDraft[]
  onHeader: (patch: Partial<NoteHeaderDraft>) => void
  onLines:  (lines: LineDraft[]) => void
  disabled?: boolean
  // Absent until the first save attempt — before that, fields show the
  // "still needs filling in" amber state but never the red error state.
  headerErrors?: HeaderErrors
  lineErrors?:   LineErrors[]
  tabErrorCount?: Record<NoteTab, number>
}

const TABS: { key: NoteTab; label: string; icon: typeof Scale }[] = [
  { key: 'weighbridge',  label: 'Weighbridge',      icon: Scale },
  { key: 'goods',        label: 'Supplier & Goods', icon: Package },
  { key: 'traceability', label: 'Traceability',     icon: Sprout },
  { key: 'cert',         label: 'Certification',    icon: ShieldCheck },
  { key: 'comments',     label: 'Comments',         icon: MessageSquare },
]

export default function NoteFields({
  docType, header, lines, onHeader, onLines, disabled, headerErrors, lineErrors, tabErrorCount,
}: Props) {
  const [tab, setTab] = useState<NoteTab>('weighbridge')
  const current = TABS.find(t => t.key === tab) ?? TABS[0]

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    onLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
  const totalKg  = lines.reduce((sum, l) => sum + (Number(l.weight_kg) || 0), 0)

  const err = (key: RequiredHeaderKey) => headerErrors?.[key]
  const req = (key: RequiredHeaderKey) => !header[key].trim()

  return (
    <div className="rounded-xl border border-surface-rule bg-white overflow-hidden">
      <div className="flex items-center gap-2 bg-surface border-b border-surface-rule p-2.5">
        <current.icon className="w-4 h-4 text-text-muted shrink-0" />
        <div className="relative flex-1 sm:flex-none sm:w-72">
          <select
            value={tab}
            onChange={e => setTab(e.target.value as NoteTab)}
            aria-label="Note section"
            className="w-full appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-surface-rule bg-white text-[13px] font-medium text-text outline-none focus:border-brand"
          >
            {TABS.map(t => {
              const n = tabErrorCount?.[t.key] ?? 0
              return (
                <option key={t.key} value={t.key}>
                  {t.label}{n > 0 ? `  —  ${n} to fix` : ''}
                </option>
              )
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        </div>
        {tabErrorCount && Object.values(tabErrorCount).some(n => n > 0) && (
          <span className="text-[11px] text-err ml-1">
            {Object.values(tabErrorCount).reduce((a, b) => a + b, 0)} field{Object.values(tabErrorCount).reduce((a, b) => a + b, 0) === 1 ? '' : 's'} still need filling in
          </span>
        )}
      </div>

      <div className="p-4">
        {tab === 'weighbridge' && (
          <div>
            <Hint>The load crosses the weighbridge first — its number and weight are what the rest of the note is built around.</Hint>
            <Grid>
              <ReadOnly label="Date received" value={formatDisplayDate(header.doc_date)} hint="Set automatically to today when the note is created — not editable." />
              <Text label="Weighbridge no." value={header.weighbridge_no}
                onChange={v => onHeader({ weighbridge_no: v })} disabled={disabled}
                placeholder="e.g. 103117" mono autoFocus
                required={req('weighbridge_no')} error={err('weighbridge_no')} />
              <Text label="Weight (from weighbridge)" type="number" value={header.weighbridge_weight_kg}
                onChange={v => onHeader({ weighbridge_weight_kg: v })} disabled={disabled}
                placeholder="e.g. 9660" suffix="kg"
                hint="The nett weight off the weighbridge slip. Entered by hand for now — this is the field a weighbridge system feed would write to once that integration exists."
                required={req('weighbridge_weight_kg')} error={err('weighbridge_weight_kg')} />
              <Text label="Vehicle registration" value={header.vehicle_reg}
                onChange={v => onHeader({ vehicle_reg: v })} disabled={disabled} placeholder="e.g. CCP 1676"
                required={req('vehicle_reg')} error={err('vehicle_reg')} />
            </Grid>
          </div>
        )}

        {tab === 'goods' && (
          <div>
            <Grid>
              <Text label={PARTY_LABEL[docType]} value={header.party_name}
                onChange={v => onHeader({ party_name: v })} disabled={disabled}
                required={req('party_name')} error={err('party_name')} />
              <Text label="Name of store goods delivered at" value={header.delivered_at_store}
                onChange={v => onHeader({ delivered_at_store: v })} disabled={disabled}
                placeholder="e.g. CNTP GFW"
                required={req('delivered_at_store')} error={err('delivered_at_store')} />
              <Text label="Our purchase order no." value={header.purchase_order_no}
                onChange={v => onHeader({ purchase_order_no: v })} disabled={disabled}
                placeholder="e.g. GS-0397" mono
                required={req('purchase_order_no')} error={err('purchase_order_no')} />
            </Grid>

            <SubHeading>Description of goods</SubHeading>
            <div className="overflow-x-auto rounded-lg border border-surface-rule">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="text-left px-3 py-2 w-[90px]">Qty</th>
                    <th className="text-left px-3 py-2 w-[130px]">Weight (kg)</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2 w-[150px]">Batch no.</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const rowRequired = i === 0 || l.qty.trim() !== '' || l.weight_kg.trim() !== '' || l.description.trim() !== '' || l.batch_no.trim() !== ''
                    const e = lineErrors?.[i]
                    return (
                      <tr key={i} className="border-t border-surface-rule">
                        <Cell><CellInput type="number" value={l.qty} onChange={v => setLine(i, { qty: v })} disabled={disabled}
                          required={rowRequired && !l.qty.trim()} error={!!e?.qty} /></Cell>
                        <Cell><CellInput type="number" value={l.weight_kg} onChange={v => setLine(i, { weight_kg: v })} disabled={disabled}
                          required={rowRequired && !l.weight_kg.trim()} error={!!e?.weight_kg} /></Cell>
                        <Cell><CellInput value={l.description} onChange={v => setLine(i, { description: v })} disabled={disabled} placeholder="e.g. Conv. bulk bags"
                          required={rowRequired && !l.description.trim()} error={!!e?.description} /></Cell>
                        <Cell><CellInput value={l.batch_no} onChange={v => setLine(i, { batch_no: v })} disabled={disabled} mono
                          required={rowRequired && !l.batch_no.trim()} error={!!e?.batch_no} /></Cell>
                        <td className="px-2 py-1 text-center">
                          {!disabled && lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onLines(lines.filter((_, idx) => idx !== i))}
                              className="p-1 rounded text-text-faint hover:text-err hover:bg-err-bg transition"
                              aria-label={`Remove line ${i + 1}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="border-t border-surface-rule bg-surface/60 font-medium">
                    <td className="px-3 py-2 tabular-nums">{totalQty || ''}</td>
                    <td className="px-3 py-2 tabular-nums">{totalKg ? `${totalKg.toLocaleString('en-ZA')} kg` : ''}</td>
                    <td className="px-3 py-2 text-text-muted text-[12px]" colSpan={3}>Total</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={() => onLines([...lines, emptyLine()])}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-surface-rule bg-white text-[12px] text-text-muted hover:text-text transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
            )}
          </div>
        )}

        {tab === 'traceability' && (
          <div>
            <Hint>Where this tea came from. Batch and producer lot tie the load back to the farmer; type N/A where the number isn&apos;t known yet.</Hint>
            <Grid>
              <Text label="Batch no." value={header.batch_no} onChange={v => onHeader({ batch_no: v })} disabled={disabled} mono
                required={req('batch_no')} error={err('batch_no')} />
              <Text label="Producer lot no." value={header.producer_lot_no} onChange={v => onHeader({ producer_lot_no: v })} disabled={disabled} mono
                required={req('producer_lot_no')} error={err('producer_lot_no')} />
              <Text label={FIELD_NAME_LABEL} value={header.farmer_name} onChange={v => onHeader({ farmer_name: v })} disabled={disabled} placeholder="e.g. CJ Coetzee"
                required={req('farmer_name')} error={err('farmer_name')} />
              <Text label={PLANT_YEAR_LABEL} type="number" value={header.season_year} onChange={v => onHeader({ season_year: v })} disabled={disabled} placeholder="e.g. 2026"
                required={req('season_year')} error={err('season_year')} />
              <Text label="Transporter company" value={header.transporter_company} onChange={v => onHeader({ transporter_company: v })} disabled={disabled}
                required={req('transporter_company')} error={err('transporter_company')} />
            </Grid>
          </div>
        )}

        {tab === 'cert' && (
          <div>
            <Hint>Tick what this load is certified as. Ticking anything prints the stamp on the note; leave all clear for conventional tea and no stamp appears.</Hint>
            <div className="flex flex-wrap gap-2">
              {CERT_ROWS.map(row => (
                <button
                  key={row.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onHeader({ [row.key]: !header[row.key] } as Partial<NoteHeaderDraft>)}
                  className={`px-3 py-2 rounded-lg border text-left transition disabled:opacity-60
                    ${header[row.key]
                      ? 'bg-ok-bg border-ok/40 text-status-ok'
                      : 'bg-white border-surface-rule text-text-muted hover:border-text-faint'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold
                      ${header[row.key] ? 'bg-ok border-ok text-white' : 'border-surface-rule'}`}>
                      {header[row.key] ? '✓' : ''}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium">{row.label}</span>
                      {row.sub && <span className="block text-[10px] opacity-70">{row.sub}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <Grid className="mt-3">
              <Text label="Control Union no." value={header.cert_control_union_no}
                onChange={v => onHeader({ cert_control_union_no: v })} disabled={disabled} mono placeholder="e.g. CU 89240B"
                required={req('cert_control_union_no')} error={err('cert_control_union_no')} />
              <Text label="EU organic code" value={header.cert_eu_org_code}
                onChange={v => onHeader({ cert_eu_org_code: v })} disabled={disabled} mono placeholder="e.g. ZA-BIO-149"
                required={req('cert_eu_org_code')} error={err('cert_eu_org_code')} />
            </Grid>
          </div>
        )}

        {tab === 'comments' && (
          <div>
            <Hint>The names that print on the note. The binding signature is captured separately once the note is issued.</Hint>
            <Grid>
              <Text label={SIGN_BLOCK_LABELS[docType].received} value={header.received_by_name}
                onChange={v => onHeader({ received_by_name: v })} disabled={disabled}
                required={req('received_by_name')} error={err('received_by_name')} />
              <Text label={SIGN_BLOCK_LABELS[docType].transporter} value={header.transporter_name}
                onChange={v => onHeader({ transporter_name: v })} disabled={disabled}
                required={req('transporter_name')} error={err('transporter_name')} />
              <Text label="Driver" value={header.driver_name} onChange={v => onHeader({ driver_name: v })} disabled={disabled}
                required={req('driver_name')} error={err('driver_name')} />
            </Grid>
            <label className="block mt-3">
              <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">Comments</span>
              <textarea
                value={header.notes}
                onChange={e => onHeader({ notes: e.target.value })}
                disabled={disabled}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-surface-rule bg-white text-sm text-text outline-none focus:border-brand disabled:bg-surface"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

export { emptyLine } from './note-draft'

function formatDisplayDate(isoDate: string): string {
  if (!isoDate) return '—'
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Small form pieces ───────────────────────────────────────────────────────

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-text-muted mb-3">{children}</p>
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[12px] font-semibold text-text mt-4 mb-2">{children}</h3>
}

function Grid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>{children}</div>
}

function ReadOnly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="block">
      <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</span>
      <div className="w-full px-3 py-2 rounded-lg border border-surface-rule bg-surface text-sm text-text-muted">
        {value}
      </div>
      {hint && <span className="block text-[10px] text-text-faint mt-1">{hint}</span>}
    </div>
  )
}

// A required field that is still empty gets a rounded amber outline the
// moment it's blank — before any save attempt, so there's a running picture
// of what's left, not just a wall of red after a rejected save. Once a save
// has actually been tried and this field is one of the ones that blocked it,
// the outline turns red and shows the reason underneath.
function Text({ label, value, onChange, disabled, placeholder, type = 'text', mono, hint, suffix, autoFocus, required, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  type?: string
  mono?: boolean
  hint?: string
  suffix?: string
  autoFocus?: boolean
  required?: boolean
  error?: string
}) {
  const stateClass = error
    ? 'border-err focus:border-err bg-err-bg/40'
    : required
      ? 'border-warn/60 focus:border-brand bg-warn-bg/30'
      : 'border-surface-rule focus:border-brand'
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">
        {label}{required && <span className="text-warn ml-0.5">*</span>}
      </span>
      <div className="relative">
        <input
          type={type}
          value={value}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full px-3 py-2 rounded-lg border-2 bg-white text-sm text-text
            placeholder:text-text-faint outline-none disabled:bg-surface transition-colors
            ${stateClass} ${mono ? 'font-mono' : ''} ${suffix ? 'pr-10' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-faint">{suffix}</span>
        )}
      </div>
      {error
        ? <span className="block text-[10px] text-err mt-1">{error}</span>
        : hint && <span className="block text-[10px] text-text-faint mt-1">{hint}</span>}
    </label>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-1.5 py-1">{children}</td>
}

function CellInput({ value, onChange, disabled, placeholder, type = 'text', mono, required, error }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  type?: string
  mono?: boolean
  required?: boolean
  error?: boolean
}) {
  const stateClass = error
    ? 'border-err bg-err-bg/40'
    : required
      ? 'border-warn/60 bg-warn-bg/30'
      : 'border-transparent'
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={`w-full px-2 py-1.5 rounded-md border-2 bg-transparent text-sm text-text
        placeholder:text-text-faint outline-none focus:border-brand focus:bg-white disabled:text-text-muted transition-colors
        ${stateClass} ${mono ? 'font-mono' : ''}`}
    />
  )
}
