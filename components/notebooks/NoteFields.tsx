'use client'

// components/notebooks/NoteFields.tsx
// The capture side of a note: header fields, the ruled QTY/WEIGHT/DESCRIPTION
// table, and the certification stamp. Shared by "New note" and by editing a
// note that is still a draft, so the two can never drift apart.
//
// The form state is a flat object mirroring the columns, which is exactly what
// the API expects as `header` — no mapping layer in between.

import { Plus, Trash2 } from 'lucide-react'
import {
  type DocType, type LineDraft, type NoteHeaderDraft,
  PARTY_LABEL, CERT_ROWS,
} from './note-draft'

interface Props {
  docType: DocType
  header:  NoteHeaderDraft
  lines:   LineDraft[]
  onHeader: (patch: Partial<NoteHeaderDraft>) => void
  onLines:  (lines: LineDraft[]) => void
  disabled?: boolean
}

export default function NoteFields({ docType, header, lines, onHeader, onLines, disabled }: Props) {
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    onLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const totalKg  = lines.reduce((s, l) => s + (Number(l.weight_kg) || 0), 0)

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <Section title="The note">
        <Grid>
          <Text label={PARTY_LABEL[docType]} value={header.party_name}
            onChange={v => onHeader({ party_name: v })} disabled={disabled} autoFocus />
          <Text label="Name of store goods delivered at" value={header.delivered_at_store}
            onChange={v => onHeader({ delivered_at_store: v })} disabled={disabled}
            placeholder="e.g. CNTP GFW" />
          <Text label="Our purchase order no." value={header.purchase_order_no}
            onChange={v => onHeader({ purchase_order_no: v })} disabled={disabled}
            placeholder="e.g. GS-0397" mono />
          <Text label="Weighbridge no." value={header.weighbridge_no}
            onChange={v => onHeader({ weighbridge_no: v })} disabled={disabled}
            placeholder="e.g. 103117" mono
            hint="The weighbridge slip this load was weighed on." />
          <Text label="Date" type="date" value={header.doc_date}
            onChange={v => onHeader({ doc_date: v })} disabled={disabled} />
          <Text label="Vehicle registration" value={header.vehicle_reg}
            onChange={v => onHeader({ vehicle_reg: v })} disabled={disabled} placeholder="e.g. CCP 1676" />
        </Grid>
      </Section>

      {/* ── Traceability ── */}
      <Section
        title="Traceability"
        hint="Where this tea came from. Lot and batch numbers tie the load back to the farmer; leave blank if the number isn't known yet."
      >
        <Grid>
          <Text label="Lot no." value={header.lot_no} onChange={v => onHeader({ lot_no: v })} disabled={disabled} mono placeholder="e.g. GS-0397" />
          <Text label="Batch no." value={header.batch_no} onChange={v => onHeader({ batch_no: v })} disabled={disabled} mono />
          <Text label="Producer lot no." value={header.producer_lot_no} onChange={v => onHeader({ producer_lot_no: v })} disabled={disabled} mono />
          <Text label="Farmer / tea court" value={header.farmer_name} onChange={v => onHeader({ farmer_name: v })} disabled={disabled} placeholder="e.g. CJ Coetzee" />
          <Text label="Season" type="number" value={header.season_year} onChange={v => onHeader({ season_year: v })} disabled={disabled} placeholder="e.g. 2026" />
          <Text label="Transporter company" value={header.transporter_company} onChange={v => onHeader({ transporter_company: v })} disabled={disabled} />
        </Grid>
      </Section>

      {/* ── Lines ── */}
      <Section title="Goods" hint="One line per item, exactly as it goes in the book.">
        <div className="overflow-x-auto rounded-lg border border-surface-rule">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="text-left px-3 py-2 w-[90px]">Qty</th>
                <th className="text-left px-3 py-2 w-[130px]">Weight (kg)</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2 w-[130px]">Lot no.</th>
                <th className="text-left px-3 py-2 w-[130px]">Batch no.</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-surface-rule">
                  <Cell><CellInput type="number" value={l.qty} onChange={v => setLine(i, { qty: v })} disabled={disabled} /></Cell>
                  <Cell><CellInput type="number" value={l.weight_kg} onChange={v => setLine(i, { weight_kg: v })} disabled={disabled} /></Cell>
                  <Cell><CellInput value={l.description} onChange={v => setLine(i, { description: v })} disabled={disabled} placeholder="e.g. Conv. bulk bags" /></Cell>
                  <Cell><CellInput value={l.lot_no} onChange={v => setLine(i, { lot_no: v })} disabled={disabled} mono /></Cell>
                  <Cell><CellInput value={l.batch_no} onChange={v => setLine(i, { batch_no: v })} disabled={disabled} mono /></Cell>
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
              ))}
              <tr className="border-t border-surface-rule bg-surface/60 font-medium">
                <td className="px-3 py-2 tabular-nums">{totalQty || ''}</td>
                <td className="px-3 py-2 tabular-nums">{totalKg ? `${totalKg.toLocaleString('en-ZA')} kg` : ''}</td>
                <td className="px-3 py-2 text-text-muted text-[12px]" colSpan={4}>Total</td>
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
      </Section>

      {/* ── Certification stamp ── */}
      <Section
        title="Certification stamp"
        hint="Tick what this load is certified as. Ticking anything prints the stamp on the note; leave all clear for conventional tea and no stamp appears."
      >
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
            onChange={v => onHeader({ cert_control_union_no: v })} disabled={disabled} mono placeholder="e.g. CU 89240B" />
          <Text label="EU organic code" value={header.cert_eu_org_code}
            onChange={v => onHeader({ cert_eu_org_code: v })} disabled={disabled} mono placeholder="e.g. ZA-BIO-149" />
        </Grid>
      </Section>

      {/* ── Acknowledgement names ── */}
      <Section
        title="Acknowledgement"
        hint="The names that print on the note. The binding signature is captured separately once the note is issued."
      >
        <Grid>
          <Text label={docType === 'GRN' ? 'Received by' : 'Delivered by'} value={header.received_by_name}
            onChange={v => onHeader({ received_by_name: v })} disabled={disabled} />
          <Text label={docType === 'GRN' ? 'Transporter' : 'Received by (recipient)'} value={header.transporter_name}
            onChange={v => onHeader({ transporter_name: v })} disabled={disabled} />
          <Text label="Driver" value={header.driver_name} onChange={v => onHeader({ driver_name: v })} disabled={disabled} />
        </Grid>
        <label className="block mt-3">
          <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">Notes</span>
          <textarea
            value={header.notes}
            onChange={e => onHeader({ notes: e.target.value })}
            disabled={disabled}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-surface-rule bg-white text-sm text-text outline-none focus:border-brand disabled:bg-surface"
          />
        </label>
      </Section>
    </div>
  )
}

export function emptyLine(): LineDraft {
  return { qty: '', weight_kg: '', description: '', lot_no: '', batch_no: '' }
}

// ─── Small form pieces ───────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-rule bg-white p-4">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      {hint && <p className="text-[11px] text-text-muted mt-0.5 mb-3">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function Grid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>{children}</div>
}

function Text({ label, value, onChange, disabled, placeholder, type = 'text', mono, hint, autoFocus }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  type?: string
  mono?: boolean
  hint?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg border border-surface-rule bg-white text-sm text-text
          placeholder:text-text-faint outline-none focus:border-brand disabled:bg-surface ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="block text-[10px] text-text-faint mt-1">{hint}</span>}
    </label>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-1.5 py-1">{children}</td>
}

function CellInput({ value, onChange, disabled, placeholder, type = 'text', mono }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  type?: string
  mono?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={`w-full px-2 py-1.5 rounded-md border border-transparent bg-transparent text-sm text-text
        placeholder:text-text-faint outline-none focus:border-brand focus:bg-white disabled:text-text-muted ${mono ? 'font-mono' : ''}`}
    />
  )
}
