'use client'

// components/notebooks/NoteFields.tsx
// The capture side of a note — a tabbed form, not a page that already looks
// like the paper document. Filling in a GRN happens as a short sequence of
// steps (Weighbridge → Supplier & Goods → Traceability → Certification →
// Comments); NotePaper is what makes it look like the physical book, and it
// only comes into view once there's something worth previewing, printing or
// signing. Shared by "New note" and by editing a note that is still a draft,
// so the two can never drift apart.
//
// The form state is a flat object mirroring the columns, which is exactly what
// the API expects as `header` — no mapping layer in between.

import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Plus, Trash2, Scale, Package, Sprout, ShieldCheck, MessageSquare } from 'lucide-react'
import {
  type DocType, type LineDraft, type NoteHeaderDraft,
  PARTY_LABEL, CERT_ROWS,
} from './note-draft'
import { FIELD_NAME_LABEL, PLANT_YEAR_LABEL, SIGN_BLOCK_LABELS } from '@/lib/notebooks/types'

interface Props {
  docType: DocType
  header:  NoteHeaderDraft
  lines:   LineDraft[]
  onHeader: (patch: Partial<NoteHeaderDraft>) => void
  onLines:  (lines: LineDraft[]) => void
  disabled?: boolean
}

const TABS = [
  { key: 'weighbridge',  label: 'Weighbridge',      icon: Scale },
  { key: 'goods',        label: 'Supplier & Goods', icon: Package },
  { key: 'traceability', label: 'Traceability',     icon: Sprout },
  { key: 'cert',         label: 'Certification',    icon: ShieldCheck },
  { key: 'comments',     label: 'Comments',         icon: MessageSquare },
] as const

export default function NoteFields({ docType, header, lines, onHeader, onLines, disabled }: Props) {
  const [tab, setTab] = useState<string>('weighbridge')

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    onLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const totalKg  = lines.reduce((s, l) => s + (Number(l.weight_kg) || 0), 0)

  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="rounded-xl border border-surface-rule bg-white overflow-hidden">
      <Tabs.List className="flex flex-wrap gap-1 bg-surface border-b border-surface-rule p-1.5" aria-label="Note sections">
        {TABS.map(t => (
          <Tabs.Trigger
            key={t.key}
            value={t.key}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition
              text-text-muted hover:text-text
              data-[state=active]:bg-brand data-[state=active]:text-white data-[state=active]:shadow-sm`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="p-4">
        <Tabs.Content value="weighbridge" className="focus:outline-none">
          <Hint>The load crosses the weighbridge first — its number and weight are what the rest of the note is built around.</Hint>
          <Grid>
            <ReadOnly label="Date received" value={formatDisplayDate(header.doc_date)} hint="Set automatically to today when the note is created — not editable." />
            <Text label="Weighbridge no." value={header.weighbridge_no}
              onChange={v => onHeader({ weighbridge_no: v })} disabled={disabled}
              placeholder="e.g. 103117" mono autoFocus />
            <Text label="Weight (from weighbridge)" type="number" value={header.weighbridge_weight_kg}
              onChange={v => onHeader({ weighbridge_weight_kg: v })} disabled={disabled}
              placeholder="e.g. 9660" suffix="kg"
              hint="The nett weight off the weighbridge slip. Entered by hand for now — this is the field a weighbridge system feed would write to once that integration exists." />
            <Text label="Vehicle registration" value={header.vehicle_reg}
              onChange={v => onHeader({ vehicle_reg: v })} disabled={disabled} placeholder="e.g. CCP 1676" />
          </Grid>
        </Tabs.Content>

        <Tabs.Content value="goods" className="focus:outline-none">
          <Grid>
            <Text label={PARTY_LABEL[docType]} value={header.party_name}
              onChange={v => onHeader({ party_name: v })} disabled={disabled} />
            <Text label="Name of store goods delivered at" value={header.delivered_at_store}
              onChange={v => onHeader({ delivered_at_store: v })} disabled={disabled}
              placeholder="e.g. CNTP GFW" />
            <Text label="Our purchase order no." value={header.purchase_order_no}
              onChange={v => onHeader({ purchase_order_no: v })} disabled={disabled}
              placeholder="e.g. GS-0397" mono />
          </Grid>

          <SubHeading>Description of goods</SubHeading>
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
        </Tabs.Content>

        <Tabs.Content value="traceability" className="focus:outline-none">
          <Hint>Where this tea came from. Lot and batch numbers tie the load back to the farmer; leave blank if the number isn&apos;t known yet.</Hint>
          <Grid>
            <Text label="Lot no." value={header.lot_no} onChange={v => onHeader({ lot_no: v })} disabled={disabled} mono placeholder="e.g. GS-0397" />
            <Text label="Batch no." value={header.batch_no} onChange={v => onHeader({ batch_no: v })} disabled={disabled} mono />
            <Text label="Producer lot no." value={header.producer_lot_no} onChange={v => onHeader({ producer_lot_no: v })} disabled={disabled} mono />
            <Text label={FIELD_NAME_LABEL} value={header.farmer_name} onChange={v => onHeader({ farmer_name: v })} disabled={disabled} placeholder="e.g. CJ Coetzee" />
            <Text label={PLANT_YEAR_LABEL} type="number" value={header.season_year} onChange={v => onHeader({ season_year: v })} disabled={disabled} placeholder="e.g. 2026" />
            <Text label="Transporter company" value={header.transporter_company} onChange={v => onHeader({ transporter_company: v })} disabled={disabled} />
          </Grid>
        </Tabs.Content>

        <Tabs.Content value="cert" className="focus:outline-none">
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
              onChange={v => onHeader({ cert_control_union_no: v })} disabled={disabled} mono placeholder="e.g. CU 89240B" />
            <Text label="EU organic code" value={header.cert_eu_org_code}
              onChange={v => onHeader({ cert_eu_org_code: v })} disabled={disabled} mono placeholder="e.g. ZA-BIO-149" />
          </Grid>
        </Tabs.Content>

        <Tabs.Content value="comments" className="focus:outline-none">
          <Hint>The names that print on the note. The binding signature is captured separately once the note is issued.</Hint>
          <Grid>
            <Text label={SIGN_BLOCK_LABELS[docType].received} value={header.received_by_name}
              onChange={v => onHeader({ received_by_name: v })} disabled={disabled} />
            <Text label={SIGN_BLOCK_LABELS[docType].transporter} value={header.transporter_name}
              onChange={v => onHeader({ transporter_name: v })} disabled={disabled} />
            <Text label="Driver" value={header.driver_name} onChange={v => onHeader({ driver_name: v })} disabled={disabled} />
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
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}

export function emptyLine(): LineDraft {
  return { qty: '', weight_kg: '', description: '', lot_no: '', batch_no: '' }
}

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

function Text({ label, value, onChange, disabled, placeholder, type = 'text', mono, hint, suffix, autoFocus }: {
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
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</span>
      <div className="relative">
        <input
          type={type}
          value={value}
          autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full px-3 py-2 rounded-lg border border-surface-rule bg-white text-sm text-text
            placeholder:text-text-faint outline-none focus:border-brand disabled:bg-surface ${mono ? 'font-mono' : ''} ${suffix ? 'pr-10' : ''}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-faint">{suffix}</span>
        )}
      </div>
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
