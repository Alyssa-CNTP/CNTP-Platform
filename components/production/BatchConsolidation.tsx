'use client'

// components/production/BatchConsolidation.tsx
// The consolidated "batch 360" surface: one physical batch, every new KPI in one
// place — yield, per-product output share, machine settings (sieving config, VSD,
// indent speed/angle), quality (bulk density / leaf shade / PA / residue / QC),
// the input/output bag chain, and a three-way accuracy check (paperwork · system ·
// Acumatica). Fed by /api/production/batch/[key] + /api/production/reconciliation.
// Reusable: mount it on /traceability, or drop it into /tags and /production/orders.

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Percent, Scale, Boxes, FlaskConical, Cpu, CheckCircle2, AlertTriangle,
  Save, Loader2, ChevronDown, ChevronRight, Layers,
} from 'lucide-react'
import { sectionMeta } from '@/lib/production/capture-config'

const C = { brand: '#1A3A0E', accent: '#5A8A2A', azure: '#2A7CB8', warn: '#B85C0A', err: '#B81C1C', ok: '#1A7A3C', gray: '#96A88A' }
const TOL_KG = 15
const secName = (id: string) => sectionMeta(id).name
const kg = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString()} kg`)

interface BatchResp {
  batch: { batchKey: string; displayLot: string; variant: string | null; sections: string[]; firstSection: string; sessionCount: number; totalInputKg: number | null; totalOutputKg: number | null; yieldPct: number | null; firstDate: string; lastDate: string }
  quality: { hasQuality: boolean; bulkDensity: number | null; leafShade: string | null; paLevel: number | null; residueGrade: string | null; allPassed: boolean | null; sdRunCount: number }
  sessions: Array<{ sessionId: string; sectionId: string; date: string; shift: string; status: string; variant: string | null; inputKg: number | null; outputKg: number | null; balanceKg: number | null; toleranceKg: number | null; yieldPct: number | null; withinTol: boolean | null }>
  streams: Array<{ sessionId: string; sectionId: string; date: string; productType: string; kg: number | null; bagCount: number; sessionOutputKg: number | null; sharePct: number | null }>
  machineParams: Array<{ sessionId: string; sectionId: string; date: string; shift: string; indentSpeedRpm: number | null; indentAngleDeg: number | null; vsdHzAvg: number | null; vsdHzMin: number | null; vsdHzMax: number | null; sievingConfig: string | null; scaleVerificationKg: number | null }>
  bags: { inputs: Array<any>; outputs: Array<any> }
}
interface ReconLine { lineKey: string; lineLabel: string; unit: string; systemValue: number | null; paperworkValue: number | null; acumaticaValue: number | null; note?: string | null }

function KpiTile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Scale; tone: 'ok' | 'warn' | 'err' | 'info' }) {
  const accent = { ok: C.ok, warn: C.warn, err: C.err, info: C.azure }[tone]
  return (
    <div className="rounded-xl border border-surface-rule p-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-center justify-between"><Icon size={13} style={{ color: accent }} /></div>
      <div className="text-[19px] leading-none font-semibold mt-1.5" style={{ color: accent }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted mt-1">{label}</div>
    </div>
  )
}

function Section({ title, icon: Icon, children, right }: { title: string; icon: typeof Scale; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text flex items-center gap-1.5"><Icon size={14} style={{ color: C.brand }} /> {title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function BatchConsolidation({ batchKey }: { batchKey: string }) {
  const [data, setData] = useState<BatchResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recon, setRecon] = useState<Record<string, { paperwork: string; acumatica: string }>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBags, setShowBags] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [bRes, rRes] = await Promise.all([
        fetch(`/api/production/batch/${encodeURIComponent(batchKey)}`),
        fetch(`/api/production/reconciliation?batch=${encodeURIComponent(batchKey)}`),
      ])
      const bJson = await bRes.json()
      if (!bRes.ok) throw new Error(bJson.error || 'Failed to load batch')
      setData(bJson)
      const rJson = await rRes.json().catch(() => ({ lines: [] }))
      const seed: Record<string, { paperwork: string; acumatica: string }> = {}
      for (const l of (rJson.lines || [])) {
        seed[l.line_key] = {
          paperwork: l.paperwork_value != null ? String(l.paperwork_value) : '',
          acumatica: l.acumatica_value != null ? String(l.acumatica_value) : '',
        }
      }
      setRecon(seed)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load')
    } finally { setLoading(false) }
  }, [batchKey])

  useEffect(() => { load() }, [load])

  // Aggregate output streams across sessions → per-product kg + share of batch output.
  const mix = useMemo(() => {
    if (!data) return [] as Array<{ productType: string; kg: number; bags: number; share: number | null }>
    const m: Record<string, { productType: string; kg: number; bags: number }> = {}
    let total = 0
    for (const s of data.streams) {
      if (!m[s.productType]) m[s.productType] = { productType: s.productType, kg: 0, bags: 0 }
      m[s.productType].kg += s.kg || 0
      m[s.productType].bags += s.bagCount || 0
      total += s.kg || 0
    }
    return Object.values(m)
      .map(x => ({ ...x, share: total > 0 ? Math.round((x.kg / total) * 1000) / 10 : null }))
      .sort((a, b) => b.kg - a.kg)
  }, [data])

  // Reconciliation lines: each product stream + total input/output.
  const reconLines: ReconLine[] = useMemo(() => {
    if (!data) return []
    const lines: ReconLine[] = mix.map(x => ({ lineKey: x.productType, lineLabel: x.productType, unit: 'kg', systemValue: Math.round(x.kg), paperworkValue: null, acumaticaValue: null }))
    lines.push({ lineKey: 'total_output', lineLabel: 'Total output', unit: 'kg', systemValue: data.batch.totalOutputKg, paperworkValue: null, acumaticaValue: null })
    lines.push({ lineKey: 'total_input', lineLabel: 'Total input', unit: 'kg', systemValue: data.batch.totalInputKg, paperworkValue: null, acumaticaValue: null })
    return lines
  }, [data, mix])

  const save = async () => {
    if (!data) return
    setSaving(true); setSaved(false)
    try {
      const lines = reconLines.map(l => ({
        lineKey: l.lineKey, lineLabel: l.lineLabel, unit: l.unit,
        systemValue: l.systemValue,
        paperworkValue: recon[l.lineKey]?.paperwork ?? null,
        acumaticaValue: recon[l.lineKey]?.acumatica ?? null,
      }))
      const res = await fetch('/api/production/reconciliation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchKey, lines }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e: any) { setError(e.message ?? 'Save failed') }
    finally { setSaving(false) }
  }

  const setField = (key: string, side: 'paperwork' | 'acumatica', v: string) =>
    setRecon(r => ({ ...r, [key]: { paperwork: side === 'paperwork' ? v : (r[key]?.paperwork ?? ''), acumatica: side === 'acumatica' ? v : (r[key]?.acumatica ?? '') } }))

  if (loading) return <div className="h-40 flex items-center justify-center text-text-faint text-[13px]"><Loader2 className="animate-spin mr-2" size={16} /> Loading batch…</div>
  if (error) return <div className="rounded-xl border border-err/30 bg-err/5 p-4 text-[13px] text-err flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>
  if (!data) return null

  const b = data.batch, q = data.quality
  const varianceCell = (sys: number | null, other: string | undefined) => {
    const o = other && other !== '' ? Number(other) : null
    if (sys == null || o == null || !Number.isFinite(o)) return <span className="text-text-faint">—</span>
    const d = o - sys
    const ok = Math.abs(d) <= TOL_KG
    return <span className={`font-mono font-semibold ${ok ? 'text-ok' : 'text-warn'}`}>{d > 0 ? '+' : ''}{Math.round(d)}</span>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-text">{b.displayLot || b.batchKey}</h2>
        <span className="font-mono text-[11px] text-brand bg-brand/5 border border-brand/20 px-1.5 py-0.5 rounded">{b.batchKey}</span>
        {b.variant && <span className="text-[12px] text-text-muted">{b.variant}</span>}
        <span className="text-[12px] text-text-muted">{(b.sections || []).map(secName).join(' → ') || '—'}</span>
        <span className="text-[11px] text-text-faint ml-auto">{b.firstDate === b.lastDate ? b.firstDate : `${b.firstDate} – ${b.lastDate}`} · {b.sessionCount} session{b.sessionCount === 1 ? '' : 's'}</span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiTile label="Yield" tone={(b.yieldPct ?? 0) >= 70 ? 'ok' : 'warn'} value={b.yieldPct != null ? `${b.yieldPct}%` : '—'} icon={Percent} />
        <KpiTile label="Output" tone="info" value={kg(b.totalOutputKg)} icon={Boxes} />
        <KpiTile label="Input" tone="info" value={kg(b.totalInputKg)} icon={Scale} />
        <KpiTile label="Bulk density" tone="info" value={q.bulkDensity != null ? String(q.bulkDensity) : '—'} icon={FlaskConical} />
        <KpiTile label="Leaf shade" tone="info" value={q.leafShade || '—'} icon={FlaskConical} />
        <KpiTile label="QC" tone={q.hasQuality ? (q.allPassed === false ? 'err' : 'ok') : 'warn'}
          value={q.hasQuality ? (q.allPassed === false ? 'Fail' : 'Pass') : 'No data'} icon={CheckCircle2} />
      </div>

      {/* Output mix + Quality/Machine */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Output mix" icon={Layers}>
          {mix.length ? (
            <div className="space-y-1.5">
              {mix.map(x => (
                <div key={x.productType} className="flex items-center gap-2 text-[12px]">
                  <span className="w-40 truncate text-text">{x.productType}</span>
                  <div className="flex-1 h-4 bg-surface-dim rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${x.share ?? 0}%`, background: C.accent }} />
                  </div>
                  <span className="w-24 text-right font-mono text-text-muted">{Math.round(x.kg).toLocaleString()} kg</span>
                  <span className="w-12 text-right font-mono font-semibold text-text">{x.share ?? '—'}%</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[12px] text-text-faint">No output captured.</p>}
        </Section>

        <Section title="Quality & machine settings" icon={Cpu}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
            <Field label="Bulk density" value={q.bulkDensity != null ? String(q.bulkDensity) : '—'} />
            <Field label="Leaf shade" value={q.leafShade || '—'} />
            <Field label="PA level" value={q.paLevel != null ? String(q.paLevel) : '—'} />
            <Field label="Residue grade" value={q.residueGrade || '—'} />
            <Field label="Sieving config" value={data.machineParams.find(m => m.sievingConfig)?.sievingConfig || '—'} />
            <Field label="Indent speed" value={fmtParam(data.machineParams, 'indentSpeedRpm', 'rpm')} />
            <Field label="Indent angle" value={fmtParam(data.machineParams, 'indentAngleDeg', '°')} />
            <Field label="Infeed VSD (avg)" value={fmtParam(data.machineParams, 'vsdHzAvg', 'Hz')} />
          </div>
          {!q.hasQuality && <p className="mt-3 text-[11px] text-warn">No linked quality record for this batch — check lot spelling or a missing lab entry.</p>}
        </Section>
      </div>

      {/* Three-way reconciliation */}
      <Section title="Order reconciliation — paperwork · system · Acumatica" icon={Scale}
        right={
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-white px-3 py-1.5 text-[12px] font-medium disabled:opacity-60">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saved ? 'Saved' : 'Save'}
          </button>
        }>
        <p className="text-[11px] text-text-muted mb-2">Type the paperwork and Acumatica figures; variance vs the system figure flags anything beyond ±{TOL_KG} kg. Acumatica auto-fills once the production-order GI sync is built.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-text-muted border-b border-surface-rule text-left">
                <th className="py-2 pr-3 font-medium">Line</th>
                <th className="py-2 px-2 font-medium text-right">Paperwork</th>
                <th className="py-2 px-2 font-medium text-right">System</th>
                <th className="py-2 px-2 font-medium text-right">Acumatica</th>
                <th className="py-2 px-2 font-medium text-right">Δ paper</th>
                <th className="py-2 px-2 font-medium text-right">Δ acu</th>
              </tr>
            </thead>
            <tbody>
              {reconLines.map(l => (
                <tr key={l.lineKey} className={`border-b border-surface-rule/60 ${l.lineKey.startsWith('total_') ? 'font-medium' : ''}`}>
                  <td className="py-1.5 pr-3 text-text">{l.lineLabel}</td>
                  <td className="py-1.5 px-2 text-right">
                    <input inputMode="decimal" value={recon[l.lineKey]?.paperwork ?? ''} onChange={e => setField(l.lineKey, 'paperwork', e.target.value)}
                      className="w-20 text-right rounded border border-surface-rule bg-surface px-1.5 py-1 font-mono" placeholder="—" />
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-text">{l.systemValue != null ? Math.round(l.systemValue).toLocaleString() : '—'}</td>
                  <td className="py-1.5 px-2 text-right">
                    <input inputMode="decimal" value={recon[l.lineKey]?.acumatica ?? ''} onChange={e => setField(l.lineKey, 'acumatica', e.target.value)}
                      className="w-20 text-right rounded border border-surface-rule bg-surface px-1.5 py-1 font-mono" placeholder="—" />
                  </td>
                  <td className="py-1.5 px-2 text-right">{varianceCell(l.systemValue, recon[l.lineKey]?.paperwork)}</td>
                  <td className="py-1.5 px-2 text-right">{varianceCell(l.systemValue, recon[l.lineKey]?.acumatica)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Bags */}
      <Section title={`Bags — ${data.bags.inputs.length} in · ${data.bags.outputs.length} out`} icon={Boxes}
        right={<button onClick={() => setShowBags(s => !s)} className="text-[12px] text-text-muted hover:text-text inline-flex items-center gap-1">{showBags ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {showBags ? 'Hide' : 'Show'}</button>}>
        {showBags ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BagList title="Inputs (debagging)" rows={data.bags.inputs} />
            <BagList title="Outputs (bagging)" rows={data.bags.outputs} />
          </div>
        ) : <p className="text-[12px] text-text-faint">Collapsed — {data.bags.inputs.length + data.bags.outputs.length} bag rows.</p>}
      </Section>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between border-b border-surface-rule/40 py-0.5"><span className="text-text-muted">{label}</span><span className="font-mono text-text">{value}</span></div>
}
function fmtParam(rows: BatchResp['machineParams'], key: keyof BatchResp['machineParams'][number], unit: string): string {
  const vals = rows.map(r => r[key] as number | null).filter((v): v is number => v != null)
  if (!vals.length) return '—'
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return `${Math.round(avg * 10) / 10} ${unit}`
}
function BagList({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-text-faint mb-1">{title}</div>
      {rows.length ? (
        <div className="max-h-56 overflow-y-auto space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] border-b border-surface-rule/40 py-1">
              <span className="text-text truncate">{r.productType || '—'}{r.serial ? <span className="font-mono text-text-faint ml-1">{r.serial}</span> : null}</span>
              <span className="font-mono text-text-muted">{r.kg != null ? `${Math.round(r.kg)} kg` : '—'}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-[11px] text-text-faint">None.</p>}
    </div>
  )
}
