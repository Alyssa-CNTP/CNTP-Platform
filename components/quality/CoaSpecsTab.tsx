'use client'

// components/quality/CoaSpecsTab.tsx
//
// Per-customer COA specification matrix (qms.coa_specs), imported from
// Client_Specs.xlsx. Shows, per customer product spec (doc_no), which analyses
// its COA requires and the exact spec value for each. A field left blank means
// that analysis is NOT REQUIRED on that customer's COA; a filled field means it
// is required with that spec. Fully editable and saved back to the database.
//
// Drives the COA Generator: which optional blocks appear for a batch, and the
// spec column values.

import { useState, useEffect, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'

interface CoaSpec {
  id: number; doc_no: string; type: string | null; customer: string | null
  product_description: string | null; grade: string | null; variant: string | null
  moisture_max: string | null; bd_min: string | null; bd_max: string | null
  specs: any; source_file: string | null
}

const MESH_LABELS = ['>6', '>8', '>10', '>12', '>16', '>18', '>20', '>40', '>60', 'Dust', 'Dust -40', 'Dust -60']
const MICRO_FIELDS: [string, string][] = [
  ['tpc', 'TPC (Total Plate Count)'], ['ecoli', 'E. coli'], ['salmonella', 'Salmonella'],
  ['yeast', 'Yeast'], ['mould', 'Mould'], ['listeria', 'Listeria'], ['coliforms', 'Coliforms'],
  ['staph_aureus', 'Staphylococcus aureus'], ['bacillus_cereus', 'Bacillus cereus'],
  ['enterobacteriaceae', 'Enterobacteriaceae'], ['clostridium', 'Clostridium spp'],
  ['bile_tolerant_gram_neg', 'Bile-tolerant Gram-neg'], ['ecoli_o157', 'E. coli O157'],
]
const CONTAM_FIELDS: [string, string][] = [
  ['lead', 'Lead'], ['cadmium', 'Cadmium'], ['mercury', 'Mercury'], ['arsenic', 'Arsenic'], ['copper', 'Copper'],
  ['pyrrolizidine_alkaloids', 'Pyrrolizidine Alkaloids'], ['aflatoxins', 'Aflatoxins'],
  ['tropane_alkaloids', 'Tropane Alkaloids'], ['mycotoxins', 'Mycotoxins'], ['glyphosate', 'Glyphosate'],
  ['mosh_moah', 'MOSH/MOAH'], ['chlorate_perchlorate', 'Chlorate/Perchlorate'],
  ['acid_insoluble_ash', 'Acid Insoluble Ash'], ['ferromagnetic', 'Ferromagnetic Contamination'],
]
const OTHER_FIELDS: [string, string][] = [
  ['residue_reg', 'Pesticide / Residue Reg.'], ['foreign_material', 'Foreign Material'], ['sensorial', 'Sensorial'],
]

// Count of required analyses (any filled field in micro + contaminants + mesh).
function requiredCount(s: CoaSpec): number {
  const sp = s.specs || {}
  let n = 0
  n += Object.keys(sp.mesh || {}).length
  n += Object.values(sp.micro || {}).filter(Boolean).length
  n += Object.values(sp.contaminants || {}).filter(Boolean).length
  return n
}
// Which top-level COA blocks this customer requires (for the at-a-glance badges).
function blocks(s: CoaSpec) {
  const sp = s.specs || {}
  return {
    micro: Object.values(sp.micro || {}).some(Boolean),
    sieving: Object.keys(sp.mesh || {}).length > 0,
    heavyMetals: ['lead', 'cadmium', 'mercury', 'arsenic', 'copper'].some(k => sp.contaminants?.[k]),
    pa: !!sp.contaminants?.pyrrolizidine_alkaloids,
    residue: !!sp.other?.residue_reg,
  }
}

const lbl: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 2, textTransform: 'uppercase' }
const inp: React.CSSProperties = { width: '100%', padding: '5px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, boxSizing: 'border-box' }

export default function CoaSpecsTab({ canWrite }: { canWrite: boolean }) {
  const db = getDb()
  const [rows, setRows] = useState<CoaSpec[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CoaSpec | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await db.schema('qms').from('coa_specs').select('*').order('customer').order('doc_no')
    if (error) { setErr(error.message); setLoading(false); return }
    setRows((data as CoaSpec[]) ?? []); setLoading(false)
  }, [db])
  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter(r => [r.doc_no, r.customer, r.product_description, r.grade, r.variant].some(v => (v || '').toLowerCase().includes(q)))
    : rows

  async function saveRow(updated: CoaSpec) {
    const { data, error } = await db.schema('qms').from('coa_specs').update({
      type: updated.type, customer: updated.customer, product_description: updated.product_description,
      grade: updated.grade, variant: updated.variant, moisture_max: updated.moisture_max,
      bd_min: updated.bd_min, bd_max: updated.bd_max, specs: updated.specs, source_file: updated.source_file,
    }).eq('id', updated.id).select().single()
    if (error) { alert('Save failed: ' + error.message); return }
    setRows(p => p.map(r => r.id === updated.id ? (data as CoaSpec) : r))
    setEditing(null)
  }

  async function addNew() {
    const doc = prompt('New COA spec — enter a unique Doc No (e.g. IPS-XXX-001):')?.trim()
    if (!doc) return
    const { data, error } = await db.schema('qms').from('coa_specs').insert({ doc_no: doc, type: 'Customer (IPS)', specs: {} }).select().single()
    if (error) { alert('Add failed: ' + error.message); return }
    setRows(p => [data as CoaSpec, ...p]); setEditing(data as CoaSpec)
  }

  async function del(id: number) {
    if (!confirm('Delete this COA spec row? This cannot be undone.')) return
    const { error } = await db.schema('qms').from('coa_specs').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
    setRows(p => p.filter(r => r.id !== id))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{rows.length} customer COA specs</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search doc no, customer, product, grade…"
          style={{ flex: 1, minWidth: 220, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12 }} />
        <button onClick={load} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 11, cursor: 'pointer' }}>↻</button>
        {canWrite && <button onClick={addNew} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#1f4e79', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ Add COA Spec</button>}
      </div>

      <div style={{ marginBottom: 10, padding: '7px 11px', background: '#eff6ff', borderRadius: 7, border: '1px solid #bfdbfe', fontSize: 10, color: '#1e40af' }}>
        Each row is one customer product spec. The badges show which COA blocks that customer requires. Click <b>Edit</b> to set exactly which analyses are required and their spec values — a blank field means <b>NOT REQUIRED</b>. This drives the COA Generator.
      </div>

      {err && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, fontSize: 11, color: '#991b1b', marginBottom: 10 }}>⚠ {err}</div>}
      {loading && <div style={{ textAlign: 'center', color: '#9ca3af', padding: 20, fontSize: 12 }}>Loading…</div>}

      {!loading && (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#1f4e79', color: '#fff' }}>
                {['Doc No', 'Customer', 'Product Description', 'Grade', 'Variant', 'Moist.', 'Required Analyses', 'COA Blocks', ''].map(h =>
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const b = blocks(r)
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.doc_no}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.customer || '—'}</td>
                    <td style={{ padding: '5px 8px' }}>{r.product_description || '—'}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.grade || '—'}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{r.variant || '—'}</td>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{r.moisture_max || '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700 }}>{requiredCount(r)}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                      {([['Micro', b.micro], ['Sieve', b.sieving], ['Metals', b.heavyMetals], ['PA', b.pa], ['Residue', b.residue]] as const).map(([l, on]) => (
                        <span key={l} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 8, marginRight: 3, fontWeight: 700, background: on ? '#dcfce7' : '#f3f4f6', color: on ? '#166534' : '#9ca3af' }}>{l}</span>
                      ))}
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(r)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>✏️ Edit</button>
                      {canWrite && <button onClick={() => del(r.id)} style={{ marginLeft: 4, padding: '2px 6px', borderRadius: 4, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: 10 }}>🗑</button>}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>No COA specs match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && <CoaSpecEditor spec={editing} canWrite={canWrite} onClose={() => setEditing(null)} onSave={saveRow} />}
    </div>
  )
}

// ─── Editor modal ─────────────────────────────────────────────────────────────

function CoaSpecEditor({ spec, canWrite, onClose, onSave }: { spec: CoaSpec; canWrite: boolean; onClose: () => void; onSave: (s: CoaSpec) => void }) {
  const [f, setF] = useState<CoaSpec>(() => JSON.parse(JSON.stringify(spec)))
  const [saving, setSaving] = useState(false)

  const set = (k: keyof CoaSpec, v: any) => setF(p => ({ ...p, [k]: v }))
  const getMesh = (label: string, field: 'spec' | 'min' | 'max') => f.specs?.mesh?.[label]?.[field] ?? ''
  const setMesh = (label: string, field: 'spec' | 'min' | 'max', v: string) => setF(p => {
    const specs = { ...(p.specs || {}) }; const mesh = { ...(specs.mesh || {}) }
    const cur = { ...(mesh[label] || { spec: '', min: null, max: null }) }
    if (field === 'spec') cur.spec = v; else (cur as any)[field] = v === '' ? null : (isNaN(Number(v)) ? v : Number(v))
    if (!cur.spec && cur.min == null && cur.max == null) delete mesh[label]; else mesh[label] = cur
    specs.mesh = mesh; return { ...p, specs }
  })
  const getGroup = (group: string, key: string) => f.specs?.[group]?.[key] ?? ''
  const setGroup = (group: string, key: string, v: string) => setF(p => {
    const specs = { ...(p.specs || {}) }; const g = { ...(specs[group] || {}) }
    if (v.trim() === '') delete g[key]; else g[key] = v
    if (Object.keys(g).length === 0) delete specs[group]; else specs[group] = g
    return { ...p, specs }
  })

  const section: React.CSSProperties = { fontWeight: 800, fontSize: 12, margin: '14px 0 6px', color: '#1f4e79', borderBottom: '1px solid #e5e7eb', paddingBottom: 3 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 780, boxShadow: '0 24px 64px rgba(0,0,0,.3)', margin: 'auto' }}>
        <div style={{ background: '#1f4e79', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '12px 12px 0 0', position: 'sticky', top: 0 }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>✏️ COA Spec — {f.doc_no}</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 6, padding: '3px 10px', color: '#fff', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ background: '#eff6ff', borderRadius: 7, padding: '7px 11px', fontSize: 10, color: '#1e40af', marginBottom: 6 }}>
            Leave a field <b>blank</b> to mark it NOT REQUIRED for this customer. A value means it appears on the COA with that spec.
          </div>

          <div style={section}>Identity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {([['customer', 'Customer'], ['product_description', 'Product Description'], ['grade', 'Grade'], ['variant', 'Variant'], ['type', 'Type'], ['source_file', 'Source File']] as const).map(([k, l]) => (
              <div key={k}><label style={lbl}>{l}</label><input value={(f as any)[k] || ''} onChange={e => set(k, e.target.value)} style={inp} disabled={!canWrite} /></div>
            ))}
          </div>

          <div style={section}>Physical</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {([['moisture_max', 'Moisture Max'], ['bd_min', 'BD Min'], ['bd_max', 'BD Max']] as const).map(([k, l]) => (
              <div key={k}><label style={lbl}>{l}</label><input value={(f as any)[k] || ''} onChange={e => set(k, e.target.value)} style={inp} disabled={!canWrite} /></div>
            ))}
          </div>

          <div style={section}>Sieve / Cut Length (mesh)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#f3f4f6' }}>{['Mesh', 'Spec (as shown on COA)', 'Min %', 'Max %'].map(h => <th key={h} style={{ padding: '3px 6px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', color: '#6b7280' }}>{h}</th>)}</tr></thead>
            <tbody>
              {MESH_LABELS.map(m => (
                <tr key={m}>
                  <td style={{ padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>{m}</td>
                  <td style={{ padding: '2px 4px' }}><input value={getMesh(m, 'spec')} onChange={e => setMesh(m, 'spec', e.target.value)} placeholder="NOT REQUIRED" style={inp} disabled={!canWrite} /></td>
                  <td style={{ padding: '2px 4px', width: 90 }}><input value={getMesh(m, 'min')} onChange={e => setMesh(m, 'min', e.target.value)} style={inp} disabled={!canWrite} /></td>
                  <td style={{ padding: '2px 4px', width: 90 }}><input value={getMesh(m, 'max')} onChange={e => setMesh(m, 'max', e.target.value)} style={inp} disabled={!canWrite} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={section}>Microbiology</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MICRO_FIELDS.map(([k, l]) => (
              <div key={k}><label style={lbl}>{l}</label><input value={getGroup('micro', k)} onChange={e => setGroup('micro', k, e.target.value)} placeholder="NOT REQUIRED" style={inp} disabled={!canWrite} /></div>
            ))}
          </div>

          <div style={section}>Contaminants</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CONTAM_FIELDS.map(([k, l]) => (
              <div key={k}><label style={lbl}>{l}</label><input value={getGroup('contaminants', k)} onChange={e => setGroup('contaminants', k, e.target.value)} placeholder="NOT REQUIRED" style={inp} disabled={!canWrite} /></div>
            ))}
          </div>

          <div style={section}>Other</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {OTHER_FIELDS.map(([k, l]) => (
              <div key={k}><label style={lbl}>{l}</label><textarea value={getGroup('other', k)} onChange={e => setGroup('other', k, e.target.value)} placeholder="NOT REQUIRED" rows={2} style={{ ...inp, resize: 'vertical' }} disabled={!canWrite} /></div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            {canWrite && <button onClick={async () => { setSaving(true); await onSave(f); setSaving(false) }} disabled={saving}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#166534', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{saving ? 'Saving…' : '✓ Save'}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
