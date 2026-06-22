'use client'

import { useEffect, useState, useMemo } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO, subDays } from 'date-fns'
import {
  ClipboardCheck, CheckCircle2, Loader2, ChevronDown,
  ChevronRight, AlertCircle, Printer, Search, X, Calendar,
} from 'lucide-react'
import { AcumaticaSummary } from '@/components/production/AcumaticaSummary'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProdSession {
  id:                    string
  section_id:            string
  section_name:          string | null
  date:                  string
  shift:                 string
  status:                string
  submitted_at:          string | null
  notes:                 any
  acumatica_captured:    boolean | null
  acumatica_captured_at: string | null
  acumatica_order_ref:   string | null
}

interface SectionDay {
  date:      string
  sectionId: string
  label:     string
  day:       ProdSession | null
  night:     ProdSession | null
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
function num(v: any): number { return parseFloat(v) || 0 }

function parseNotes(s: ProdSession | null): any {
  if (!s) return {}
  try { return typeof s.notes === 'string' ? JSON.parse(s.notes) : (s.notes ?? {}) }
  catch { return {} }
}

function fmtKgRaw(v: number): string {
  if (v <= 0) return '—'
  return v >= 1000 ? `${(v / 1000).toFixed(2)}t` : `${Math.round(v).toLocaleString()} kg`
}

function isDay(shift: string) { return shift === 'morning' || shift === 'day' }

function getOutputKg(sectionId: string, d: any): number {
  if (!d || !Object.keys(d).length) return 0
  switch (sectionId) {
    case 'sieving':
      return ['flBags','clBags','rbEntries','dustEntries','rolsievEntries','indentEntries']
        .reduce((s, k) => s + (d[k] ?? []).reduce((ss: number, b: any) => ss + num(b.kg), 0), 0)
    case 'refining1':
      return ['out1','out2','out3'].reduce((s, k) => s + (d[k] ?? []).reduce((ss: number, r: any) => ss + num(r.qty), 0), 0)
    case 'refining2':
      return ['rowsA','rowsB','rowsC','rowsD'].reduce((s, k) => s + (d[k] ?? []).reduce((ss: number, r: any) => ss + num(r.qty), 0), 0)
    case 'granule':
      return (d.summary ?? []).reduce((s: number, r: any) => s + num(r.total_output_kg), 0)
    case 'blender':
      return (d.bagRows ?? []).reduce((s: number, r: any) => s + num(r.kg), 0)
    default: return 0
  }
}

function getInputKg(sectionId: string, d: any): number {
  if (!d || !Object.keys(d).length) return 0
  switch (sectionId) {
    case 'sieving':   return num(d.totalA)
    case 'refining1': return (d.debag ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    case 'refining2': return (d.debag ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    case 'granule':   return num(d.totalMixed) || num(d.totalRawH)
    case 'blender':
      return ['rowsA','rowsB','rowsC','rowsD','rowsE','rowsF']
        .reduce((s, k) => s + (d[k] ?? []).reduce((ss: number, r: any) => ss + num(r.kg), 0), 0)
    default: return 0
  }
}

function mergeFormData(sectionId: string, sessions: (ProdSession | null)[]): any {
  const valid = sessions.filter(Boolean) as ProdSession[]
  if (!valid.length) return {}
  const datas = valid.map(parseNotes)
  if (datas.length === 1) return datas[0]
  const concat = (key: string) => datas.flatMap(d => d[key] ?? [])
  const sumNum  = (key: string) => datas.reduce((s, d) => s + num(d[key]), 0)
  switch (sectionId) {
    case 'sieving':
      return { ...datas[0], flBags: concat('flBags'), clBags: concat('clBags'), rbEntries: concat('rbEntries'),
        dustEntries: concat('dustEntries'), rolsievEntries: concat('rolsievEntries'), indentEntries: concat('indentEntries'),
        totalA: sumNum('totalA'), bucketOutKg: sumNum('bucketOutKg'), shiftOps: datas.map(d => d.shiftOps).filter(Boolean).join(' / ') }
    case 'refining1':
      return { ...datas[0], debag: concat('debag'), out1: concat('out1'), out2: concat('out2'), out3: concat('out3'),
        op1: datas.map(d => d.op1).filter(Boolean).join(' / '), op2: datas.map(d => d.op2).filter(Boolean).join(' / ') }
    case 'refining2':
      return { ...datas[0], debag: concat('debag'), rowsA: concat('rowsA'), rowsB: concat('rowsB'),
        rowsC: concat('rowsC'), rowsD: concat('rowsD'), op1: datas.map(d => d.op1).filter(Boolean).join(' / ') }
    case 'granule': {
      const totalRawH = sumNum('totalRawH') || sumNum('totalMixed')
      const totalProducedG = sumNum('totalProducedG')
      return { ...datas[0], summary: concat('summary'), dustRows: concat('dustRows'), blendRows: concat('blendRows'),
        totalMixed: totalRawH, totalRawH, totalProducedG, balanceFG: totalRawH - totalProducedG,
        yieldPct: totalRawH > 0 ? `${((totalProducedG / totalRawH) * 100).toFixed(1)}%` : '—',
        operators: datas.map(d => d.operators).filter(Boolean).join(' / ') }
    }
    case 'blender':
      return { ...datas[0], rowsA: concat('rowsA'), rowsB: concat('rowsB'), rowsC: concat('rowsC'),
        rowsD: concat('rowsD'), rowsE: concat('rowsE'), rowsF: concat('rowsF'), bagRows: concat('bagRows'),
        supervisor: datas.map(d => d.supervisor).filter(Boolean).join(' / ') }
    default: return datas[0]
  }
}

// ── UI primitives ─────────────────────────────────────────────────────────────
const SECTION_DOT: Record<string, string> = {
  sieving: '#0d9488', refining1: '#2563eb', refining2: '#3b82f6',
  granule: '#d97706', blender: '#7c3aed', smallblender: '#8b5cf6', pasteuriser: '#dc2626',
}

function ShiftBadge({ shift }: { shift: string }) {
  const day = isDay(shift)
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, display: 'inline-block',
      background: day ? '#FEF9EC' : '#EEF2FF', color: day ? '#92400E' : '#3730A3',
      border: `1px solid ${day ? '#FDE68A' : '#C7D2FE'}`,
    }}>
      {day ? 'Day' : 'Night'}
    </span>
  )
}

function CaptureStatus({ captured, status }: { captured: boolean | null; status: string }) {
  if (captured) return (
    <span style={{ fontSize: 10, fontWeight: 600, color: '#1A7A3C', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <CheckCircle2 size={10} /> Captured
    </span>
  )
  const cfg: Record<string, { color: string; label: string }> = {
    approved:  { color: '#1A7A3C', label: 'Approved'  },
    submitted: { color: '#2A7CB8', label: 'Submitted' },
    draft:     { color: '#B85C0A', label: 'Draft'     },
  }
  const c = cfg[status] ?? { color: '#9CA3AF', label: status }
  return <span style={{ fontSize: 10, fontWeight: 600, color: c.color }}>{c.label}</span>
}

// ── Order ref capture widget ──────────────────────────────────────────────────
function OrderRefCapture({ session, onMarkCaptured }: {
  session: ProdSession; onMarkCaptured: (id: string, ref: string) => Promise<void>
}) {
  const [ref,    setRef]    = useState(session.acumatica_order_ref ?? '')
  const [saving, setSaving] = useState(false)
  const [done,   setDone]   = useState(!!session.acumatica_captured)
  const canCapture = !session.acumatica_captured && (session.status === 'submitted' || session.status === 'approved')

  if (session.acumatica_captured) return (
    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#1A7A3C' }}>
      {session.acumatica_order_ref}
    </span>
  )
  if (!canCapture) return <span style={{ color: '#D1D5DB', fontSize: 11 }}>—</span>

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
      <input
        type="text" value={ref} onChange={e => setRef(e.target.value.toUpperCase())}
        placeholder="WO-XXXXXX"
        style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #D1D5DB', fontSize: 11, fontFamily: 'monospace', width: 120, outline: 'none' }}
      />
      <button
        disabled={saving || !ref.trim()}
        onClick={async () => { setSaving(true); await onMarkCaptured(session.id, ref.trim()); setDone(true); setSaving(false) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5,
          border: 'none', background: '#166534', color: '#fff', fontSize: 10, fontWeight: 700,
          cursor: 'pointer', opacity: (saving || !ref.trim()) ? 0.5 : 1,
        }}
      >
        {saving ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : done ? <CheckCircle2 size={10} /> : <ClipboardCheck size={10} />}
        {saving ? '…' : 'Log'}
      </button>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Shift detail panel (inside dropdown) ──────────────────────────────────────
function ShiftPanel({ session, data, sectionId, inKg, outKg }: {
  session: ProdSession; data: any; sectionId: string; inKg: number; outKg: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          { label: 'Input',  val: fmtKgRaw(inKg) },
          { label: 'Output', val: fmtKgRaw(outKg) },
          { label: 'Yield',  val: inKg > 0 ? `${((outKg / inKg) * 100).toFixed(1)}%` : '—' },
        ].map(({ label, val }) => (
          <div key={label} style={{ textAlign: 'center', padding: '8px 12px', background: '#fff', border: '1px solid #E4E7EC', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2415' }}>{val}</div>
          </div>
        ))}
      </div>
      {Object.keys(data).length > 0
        ? <AcumaticaSummary sectionId={sectionId} sessionData={data} date={session.date} shift={session.shift} />
        : <p style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 12, padding: 20 }}>No data captured for this shift yet.</p>
      }
    </div>
  )
}

// ── Expandable section-day row ────────────────────────────────────────────────
function SectionDayRow({ g, onMarkCaptured, highlight, isYesterday, indented }: {
  g:               SectionDay
  onMarkCaptured: (id: string, ref: string) => Promise<void>
  highlight?:      boolean
  isYesterday?:    boolean
  indented?:       boolean   // true inside history table — prepends empty Date cell
}) {
  const [open,    setOpen]    = useState(isYesterday ?? false)
  const [panel,   setPanel]   = useState<'day' | 'night' | 'combined'>('combined')

  const dayData   = parseNotes(g.day)
  const nightData = parseNotes(g.night)
  const combined  = mergeFormData(g.sectionId, [g.day, g.night])

  const dayIn    = getInputKg(g.sectionId, dayData)
  const dayOut   = getOutputKg(g.sectionId, dayData)
  const nightIn  = getInputKg(g.sectionId, nightData)
  const nightOut = getOutputKg(g.sectionId, nightData)
  const totalIn  = dayIn + nightIn
  const totalOut = dayOut + nightOut

  const allCaptured = [g.day, g.night].filter(Boolean).every(s => s!.acumatica_captured)
  const pendingAny  = [g.day, g.night].filter(Boolean).some(s => !s!.acumatica_captured && (s!.status === 'submitted' || s!.status === 'approved'))

  const refs = [g.day, g.night].filter(Boolean).map(s => s!.acumatica_order_ref).filter(Boolean)

  const rowBg = highlight
    ? '#FFFBEB'
    : open
    ? '#F9FAFB'
    : '#FFFFFF'

  const rowBorder = highlight ? '2px solid #F59E0B' : undefined

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', background: rowBg, outline: rowBorder, transition: 'background 120ms' }}
        onMouseEnter={e => { if (!open && !highlight) (e.currentTarget as HTMLElement).style.background = '#F9FAFB' }}
        onMouseLeave={e => { if (!open && !highlight) (e.currentTarget as HTMLElement).style.background = rowBg }}
      >
        {/* Empty date cell when inside history table */}
        {indented && <td style={{ padding: '10px 8px', borderBottom: '1px solid #F0F2F5', width: 140 }} />}

        {/* Section */}
        <td style={{ padding: '10px 16px', borderBottom: '1px solid #F0F2F5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {highlight && <div style={{ width: 3, height: 28, borderRadius: 2, background: '#F59E0B', flexShrink: 0 }} />}
            <div style={{ width: 8, height: 8, borderRadius: 2, background: SECTION_DOT[g.sectionId] ?? '#9CA3AF', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1A2415' }}>{g.label}</span>
          </div>
        </td>

        {/* Day shift */}
        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F0F2F5', textAlign: 'right' }}>
          {g.day ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(dayOut)}</span>
              <CaptureStatus captured={g.day.acumatica_captured} status={g.day.status} />
            </div>
          ) : <span style={{ color: '#E5E7EB', fontSize: 12 }}>—</span>}
        </td>

        {/* Night shift */}
        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F0F2F5', textAlign: 'right' }}>
          {g.night ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(nightOut)}</span>
              <CaptureStatus captured={g.night.acumatica_captured} status={g.night.status} />
            </div>
          ) : <span style={{ color: '#E5E7EB', fontSize: 12 }}>—</span>}
        </td>

        {/* Full day total */}
        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F0F2F5', textAlign: 'right' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#1A2415', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(totalOut)}</span>
            {totalIn > 0 && <span style={{ fontSize: 10, color: '#9CA3AF' }}>{((totalOut / totalIn) * 100).toFixed(1)}% yield</span>}
          </div>
        </td>

        {/* Acumatica refs */}
        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F0F2F5' }}>
          {refs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {refs.map(r => (
                <span key={r} style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A7A3C' }}>{r}</span>
              ))}
            </div>
          ) : pendingAny ? (
            <span style={{ fontSize: 10, fontWeight: 600, color: '#B85C0A', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={10} /> Pending
            </span>
          ) : <span style={{ color: '#E5E7EB', fontSize: 11 }}>—</span>}
        </td>

        {/* Expand */}
        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F0F2F5', textAlign: 'center', width: 36 }}>
          {open
            ? <ChevronDown  size={14} style={{ color: '#9CA3AF' }} />
            : <ChevronRight size={14} style={{ color: '#9CA3AF' }} />
          }
        </td>
      </tr>

      {/* ── Dropdown ── */}
      {open && (
        <tr>
          <td colSpan={indented ? 7 : 6} style={{ padding: 0, borderBottom: '2px solid #E4E7EC', background: '#F9FAFB' }}>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Panel switcher + print */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', gap: 2, padding: 3, background: '#E4E7EC', borderRadius: 8 }}>
                  {([
                    { key: 'day'      as const, label: `Day Shift · ${fmtKgRaw(dayOut)}`,    disabled: !g.day   },
                    { key: 'night'    as const, label: `Night Shift · ${fmtKgRaw(nightOut)}`, disabled: !g.night },
                    { key: 'combined' as const, label: `Full Day · ${fmtKgRaw(totalOut)}`,    disabled: false    },
                  ]).map(p => (
                    <button key={p.key}
                      disabled={p.disabled}
                      onClick={e => { e.stopPropagation(); setPanel(p.key) }}
                      style={{
                        padding: '6px 14px', borderRadius: 6, border: 'none',
                        cursor: p.disabled ? 'not-allowed' : 'pointer',
                        fontSize: 12, fontWeight: panel === p.key ? 700 : 400,
                        background: panel === p.key ? '#fff' : 'transparent',
                        color: p.disabled ? '#D1D5DB' : panel === p.key ? '#1A2415' : '#637056',
                        boxShadow: panel === p.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
                        transition: 'all 120ms',
                      }}
                    >{p.label}</button>
                  ))}
                </div>
                <button onClick={e => { e.stopPropagation(); window.print() }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#fff', border: '1px solid #E4E7EC', borderRadius: 8, fontSize: 11, color: '#637056', cursor: 'pointer' }}>
                  <Printer size={12} /> Print
                </button>
              </div>

              {/* Order ref capture row — one per shift */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[g.day, g.night].filter(Boolean).map(s => (
                  <div key={s!.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#fff', border: '1px solid #E4E7EC', borderRadius: 8 }}>
                    <ShiftBadge shift={s!.shift} />
                    <OrderRefCapture session={s!} onMarkCaptured={onMarkCaptured} />
                  </div>
                ))}
              </div>

              {/* Detail panels */}
              {panel === 'day' && g.day && (
                <ShiftPanel session={g.day} data={dayData} sectionId={g.sectionId} inKg={dayIn} outKg={dayOut} />
              )}
              {panel === 'night' && g.night && (
                <ShiftPanel session={g.night} data={nightData} sectionId={g.sectionId} inKg={nightIn} outKg={nightOut} />
              )}
              {panel === 'combined' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* 4-cell summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                    {[
                      { label: 'Day Output',   v: dayOut   },
                      { label: 'Night Output', v: nightOut },
                      { label: 'Total Output', v: totalOut, bold: true },
                      { label: 'Overall Yield',v: totalIn > 0 ? `${((totalOut/totalIn)*100).toFixed(1)}%` : '—', raw: true },
                    ].map(({ label, v, bold, raw }) => (
                      <div key={label} style={{ textAlign: 'center', padding: '10px', background: bold ? '#F0FDF4' : '#fff', border: `1px solid ${bold ? '#BBF7D0' : '#E4E7EC'}`, borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: bold ? 18 : 15, fontWeight: bold ? 800 : 700, color: bold ? '#166534' : '#1A2415' }}>
                          {raw ? v : fmtKgRaw(v as number)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <AcumaticaSummary sectionId={g.sectionId} sessionData={combined} date={g.date} shift="Day + Night" />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Section-day table (reused for yesterday panel and history) ─────────────────
function SectionTable({ groups, onMarkCaptured, highlightQuery, isYesterday }: {
  groups:          SectionDay[]
  onMarkCaptured: (id: string, ref: string) => Promise<void>
  highlightQuery?: string
  isYesterday?:    boolean
}) {
  const q = (highlightQuery ?? '').toLowerCase().trim()

  function matches(g: SectionDay): boolean {
    if (!q) return false
    if (g.date.includes(q)) return true
    const refs = [g.day?.acumatica_order_ref, g.night?.acumatica_order_ref].filter(Boolean)
    return refs.some(r => r!.toLowerCase().includes(q))
  }

  const dayTotal   = groups.reduce((s, g) => s + getOutputKg(g.sectionId, parseNotes(g.day)),   0)
  const nightTotal = groups.reduce((s, g) => s + getOutputKg(g.sectionId, parseNotes(g.night)), 0)
  const grandTotal = dayTotal + nightTotal

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E4E7EC' }}>
          {[
            { label: 'Section',        align: 'left',   w: undefined },
            { label: 'Day Shift',      align: 'right',  w: 120 },
            { label: 'Night Shift',    align: 'right',  w: 120 },
            { label: 'Full Day Total', align: 'right',  w: 130 },
            { label: 'Order Refs',     align: 'left',   w: 160 },
            { label: '',               align: 'center', w: 36  },
          ].map((h, i) => (
            <th key={i} style={{
              padding: '8px 14px', textAlign: h.align as any, width: h.w,
              fontSize: 10, fontWeight: 600, color: '#9CA3AF',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map(g => (
          <SectionDayRow
            key={`${g.date}-${g.sectionId}`}
            g={g}
            onMarkCaptured={onMarkCaptured}
            highlight={q ? matches(g) : false}
            isYesterday={isYesterday && !q}
          />
        ))}
      </tbody>
      {groups.length > 1 && (
        <tfoot>
          <tr style={{ background: '#F0FDF4', borderTop: '2px solid #BBF7D0' }}>
            <td style={{ padding: '9px 16px', fontSize: 12, fontWeight: 700, color: '#166534' }}>Total</td>
            <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(dayTotal)}</td>
            <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(nightTotal)}</td>
            <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 15, fontWeight: 800, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(grandTotal)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
    </table>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
export default function ProductionOrderMaintenance() {
  const db = getDb()
  const [sessions,  setSessions] = useState<ProdSession[]>([])
  const [loading,   setLoading]  = useState(true)
  const [dateFrom,  setDateFrom] = useState(format(subDays(new Date(), 60), 'yyyy-MM-dd'))
  const [dateTo,    setDateTo]   = useState(format(new Date(), 'yyyy-MM-dd'))
  const [query,     setQuery]    = useState('')

  useEffect(() => { load() }, [dateFrom, dateTo])

  async function load() {
    setLoading(true)
    const { data } = await db
      .schema('production')
      .from('prod_sessions')
      .select('id,section_id,section_name,date,shift,status,submitted_at,notes,acumatica_captured,acumatica_captured_at,acumatica_order_ref')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: false })
      .order('section_id')
    setSessions(data ?? [])
    setLoading(false)
  }

  async function markCaptured(sessionId: string, orderRef: string) {
    await db.schema('production').from('prod_sessions').update({
      acumatica_captured:    true,
      acumatica_captured_at: new Date().toISOString(),
      acumatica_order_ref:   orderRef,
      updated_at:            new Date().toISOString(),
    }).eq('id', sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, acumatica_captured: true, acumatica_order_ref: orderRef, acumatica_captured_at: new Date().toISOString() }
        : s
    ))
  }

  // ── Build section-day groups ──────────────────────────────────────────────
  const byDate = useMemo(() => {
    const map: Record<string, SectionDay[]> = {}
    for (const s of sessions) {
      if (!map[s.date]) map[s.date] = []
      let g = map[s.date].find(x => x.sectionId === s.section_id)
      if (!g) {
        g = { date: s.date, sectionId: s.section_id, label: s.section_name || s.section_id, day: null, night: null }
        map[s.date].push(g)
      }
      if (isDay(s.shift)) g.day = s; else g.night = s
    }
    return map
  }, [sessions])

  const yesterday     = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const yesterdayGroups = byDate[yesterday] ?? []
  const historyDates  = Object.keys(byDate).filter(d => d !== yesterday).sort((a, b) => b.localeCompare(a))

  const allGroups = Object.values(byDate).flat()
  const pendingCount  = allGroups.filter(g =>
    [g.day, g.night].filter(Boolean).some(s => !s!.acumatica_captured && (s!.status === 'submitted' || s!.status === 'approved'))
  ).length
  const capturedCount = allGroups.filter(g =>
    [g.day, g.night].filter(Boolean).every(s => s!.acumatica_captured)
  ).length

  // Search: filter groups that match query
  const q = query.toLowerCase().trim()
  const searchResults = useMemo(() => {
    if (!q) return []
    return allGroups.filter(g => {
      if (g.date.includes(q)) return true
      const dateFormatted = format(new Date(g.date + 'T12:00:00'), 'dd MMM yyyy').toLowerCase()
      if (dateFormatted.includes(q)) return true
      const refs = [g.day?.acumatica_order_ref, g.night?.acumatica_order_ref].filter(Boolean)
      return refs.some(r => r!.toLowerCase().includes(q))
    })
  }, [q, allGroups])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Top bar: search + date range ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#fff', border: `1.5px solid ${q ? '#F59E0B' : '#E4E7EC'}`, borderRadius: 10, flex: 1, minWidth: 220, maxWidth: 380, transition: 'border-color 120ms' }}>
          <Search size={14} style={{ color: q ? '#F59E0B' : '#9CA3AF', flexShrink: 0 }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by date (e.g. 2026-06-04) or order ref (e.g. WO-001234)…"
            style={{ border: 'none', outline: 'none', fontSize: 12, color: '#1A2415', background: 'transparent', width: '100%' }}
          />
          {q && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={13} style={{ color: '#9CA3AF' }} />
            </button>
          )}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} style={{ color: '#9CA3AF' }} />
          {[{ lbl: 'From', val: dateFrom, set: setDateFrom }, { lbl: 'To', val: dateTo, set: setDateTo }].map(({ lbl, val, set }, i) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: '#fff', border: '1px solid #E4E7EC', borderRadius: 8 }}>
              <span style={{ fontSize: 9, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lbl}</span>
              <input type="date" value={val} onChange={e => set(e.target.value)}
                style={{ fontSize: 11, color: '#1A2415', background: 'transparent', border: 'none', outline: 'none' }} />
            </div>
          ))}
        </div>

        {loading && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Loading…</span>}
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {[
          { label: 'Section-days',    value: allGroups.length, color: '#1A2415' },
          { label: 'Pending capture', value: pendingCount,     color: pendingCount > 0 ? '#B85C0A' : '#1A2415' },
          { label: 'Fully captured',  value: capturedCount,    color: '#1A7A3C' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Pending alert ── */}
      {pendingCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#FEF5ED', border: '1px solid #FCD9A4', borderRadius: 10 }}>
          <ClipboardCheck size={14} style={{ color: '#B85C0A', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#B85C0A', fontWeight: 500 }}>
            {pendingCount} section{pendingCount !== 1 ? 's' : ''} pending Acumatica capture — expand a row below to enter the order reference
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>Loading sessions…</div>
      ) : allGroups.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>No production sessions in this date range.</div>
      ) : q ? (
        /* ── SEARCH RESULTS ── */
        <div style={{ background: '#fff', border: '1.5px solid #F59E0B', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(245,158,11,0.10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
            <Search size={13} style={{ color: '#D97706' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for <em>"{query}"</em>
            </span>
            <button onClick={() => setQuery('')} style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}>Clear search</button>
          </div>
          {searchResults.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>No sessions match that date or order reference.</div>
          ) : (
            <SectionTable groups={searchResults} onMarkCaptured={markCaptured} highlightQuery={query} />
          )}
        </div>
      ) : (
        <>
          {/* ── YESTERDAY — prominent panel ── */}
          {yesterdayGroups.length > 0 && (
            <div style={{ background: '#fff', border: '2px solid #1A3A0E', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 16px rgba(26,58,14,0.10)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: '#1A3A0E' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#86EFAC', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Previous Day</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 1 }}>
                    {format(new Date(yesterday + 'T12:00:00'), 'EEEE, d MMMM yyyy')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, textAlign: 'right' }}>
                  {[
                    { label: 'Sections', value: yesterdayGroups.length },
                    { label: 'Total output', value: fmtKgRaw(yesterdayGroups.reduce((s, g) => s + getOutputKg(g.sectionId, parseNotes(g.day)) + getOutputKg(g.sectionId, parseNotes(g.night)), 0)) },
                    { label: 'Captured', value: `${yesterdayGroups.filter(g => [g.day,g.night].filter(Boolean).every(s=>s!.acumatica_captured)).length}/${yesterdayGroups.length}` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: '#86EFAC', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <SectionTable groups={yesterdayGroups} onMarkCaptured={markCaptured} isYesterday />
            </div>
          )}

          {/* ── HISTORY TABLE — all other dates ── */}
          {historyDates.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #E4E7EC', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ padding: '12px 20px', background: '#F9FAFB', borderBottom: '1px solid #E4E7EC' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2415' }}>Production History</span>
                <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 10 }}>{historyDates.length} day{historyDates.length !== 1 ? 's' : ''} · use the search bar to jump to a date or order ref</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E4E7EC' }}>
                    {[
                      { label: 'Date',           align: 'left',   w: 140 },
                      { label: 'Section',        align: 'left',   w: undefined },
                      { label: 'Day Shift',      align: 'right',  w: 110 },
                      { label: 'Night Shift',    align: 'right',  w: 110 },
                      { label: 'Full Day Total', align: 'right',  w: 120 },
                      { label: 'Order Refs',     align: 'left',   w: 150 },
                      { label: '',               align: 'center', w: 36  },
                    ].map((h, i) => (
                      <th key={i} style={{ padding: '8px 14px', textAlign: h.align as any, width: h.w, fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyDates.map(date => {
                    const groups = byDate[date]
                    const dayTotal   = groups.reduce((s, g) => s + getOutputKg(g.sectionId, parseNotes(g.day)),   0)
                    const nightTotal = groups.reduce((s, g) => s + getOutputKg(g.sectionId, parseNotes(g.night)), 0)
                    return (
                      <HistoryDateBlock key={date} date={date} groups={groups} onMarkCaptured={markCaptured}
                        dayTotal={dayTotal} nightTotal={nightTotal} />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── History date block — date label + section rows inside one <tbody> ──────────
function HistoryDateBlock({ date, groups, onMarkCaptured, dayTotal, nightTotal }: {
  date:            string
  groups:          SectionDay[]
  onMarkCaptured: (id: string, ref: string) => Promise<void>
  dayTotal:        number
  nightTotal:      number
}) {
  const [collapsed, setCollapsed] = useState(true)
  const grandTotal = dayTotal + nightTotal
  const capturedAll = groups.every(g => [g.day,g.night].filter(Boolean).every(s => s!.acumatica_captured))
  const pendingAny  = groups.some(g => [g.day,g.night].filter(Boolean).some(s => !s!.acumatica_captured && (s!.status==='submitted'||s!.status==='approved')))

  return (
    <>
      {/* Date header row */}
      <tr
        onClick={() => setCollapsed(c => !c)}
        style={{ cursor: 'pointer', background: '#F9FAFB', borderTop: '1px solid #E4E7EC' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F2F5'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#F9FAFB'}
      >
        {/* Date */}
        <td style={{ padding: '9px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {collapsed
              ? <ChevronRight size={13} style={{ color: '#9CA3AF' }} />
              : <ChevronDown  size={13} style={{ color: '#9CA3AF' }} />
            }
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2415' }}>
              {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}
            </span>
            <span style={{ fontSize: 10, color: '#9CA3AF' }}>
              · {format(new Date(date + 'T12:00:00'), 'EEE')}
            </span>
          </div>
        </td>
        {/* Section count placeholder */}
        <td style={{ padding: '9px 14px' }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>{groups.length} section{groups.length !== 1 ? 's' : ''}</span>
        </td>
        {/* Day total */}
        <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#637056', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(dayTotal)}</td>
        {/* Night total */}
        <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#637056', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(nightTotal)}</td>
        {/* Grand total */}
        <td style={{ padding: '9px 14px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#1A2415', fontVariantNumeric: 'tabular-nums' }}>{fmtKgRaw(grandTotal)}</td>
        {/* Status */}
        <td style={{ padding: '9px 14px' }}>
          {capturedAll
            ? <span style={{ fontSize: 10, fontWeight: 600, color: '#1A7A3C', display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={10}/>All captured</span>
            : pendingAny
            ? <span style={{ fontSize: 10, fontWeight: 600, color: '#B85C0A', display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertCircle size={10}/>Pending</span>
            : <span style={{ fontSize: 10, color: '#9CA3AF' }}>—</span>
          }
        </td>
        <td />
      </tr>

      {/* Section rows — shown when expanded */}
      {!collapsed && groups.map(g => (
        <SectionDayRow key={`${g.date}-${g.sectionId}`} g={g} onMarkCaptured={onMarkCaptured} indented />
      ))}
    </>
  )
}
