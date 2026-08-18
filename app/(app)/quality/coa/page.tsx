'use client'

// app/(app)/quality/coa/page.tsx
//
// COA (Certificate of Analysis) Generator.
//
// The lab manager types a BATCH NUMBER — the single join key across every
// source — and the generator pulls the matching data and populates a standard,
// customer-specific COA:
//
//   • Header (grade, production date, customer)  ← pasteuriser batch
//     (invoice, order, destination, quantities, best-before) ← typed on the form
//   • Microbiology  ← Final Product Lab Results (test_type = 'micro')
//   • Cut length / sieving  ← pasteuriser sieve samples, averaged across the batch
//     (the pasteuriser sieve mesh set >6/>10/>12/>16/>20/>60/Dust matches the COA)
//   • Moisture / Bulk Density  ← pasteuriser samples, averaged
//   • Pesticide residue  ← Lab Results (test_type = 'residue')
//   • Pyrrolizidine Alkaloids  ← Lab Results (test_type = 'pa_final')
//   • Heavy metals / MOSH-MOAH  ← Lab Results (optional)
//   • Description of goods + Sensorical properties  ← standard wording
//
// Which optional blocks appear will ultimately be driven by a per-customer
// template under Customer Specs (added later). Until then, every block that
// has data auto-appears and can be toggled; specs are editable inline.
//
// Wording is centralised in COA_WORDING so every generated COA reads identically.

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { isoDateTime } from '@/lib/utils/formatDate'
import { jsPDF } from 'jspdf'
import { loadImage } from '@/lib/pdf/load-image'
import { useDraftAutosave, readDraft, clearDraft } from '@/lib/hooks/useDraftAutosave'
import DraftRecoveryBanner from '@/components/shared/DraftRecoveryBanner'

// ─── Standard wording (identical across every COA) ────────────────────────────

const COA_WORDING = {
  descriptionConventional:
    'A herbal tea, comprising of the needle like leaves of the plant Aspalathus linearis (Rooibos), after it has been cut, bruised, fermented, dried, pasteurised, dried and packaged.',
  descriptionOrganic:
    'An organic herbal tea, comprising of the needle like leaves of the plant Aspalathus linearis (Rooibos), after it has been cut, bruised, fermented, dried, pasteurised, dried and packaged.',
  residueRegulation:
    'As prescribed by EU Commission Regulation (EC) No. 1881/2006 of December 19, 2006, with amendments.',
  sensorical: 'Reddish brown liquid with a characteristic aroma and taste of rooibos',
  company: 'Cape Natural Tea Products (Pty) Ltd',
  signatories: [
    { title: 'Laboratory Supervisor', name: 'Monique Gordon' },
    { title: 'Quality Assurance Manager', name: 'Michelle Brown' },
  ],
  companyFooter: [
    'CAPE NATURAL TEA PRODUCTS (PTY) LTD',
    'P.O. BOX 30',
    'BLACKHEATH, 7581',
    'SOUTH AFRICA',
    'Reg. no: 1996/018192/07',
    'Vat no: 4370164420',
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normalise a batch number for matching across sources — case, whitespace and
// separator variants ("26138-CON-SG" / "26138 CON SG" / "26138/CON/SG") all
// collapse to the same key.
function normBatch(b: string | null | undefined) {
  return (b ?? '').trim().toUpperCase().replace(/[\s_/]+/g, '-').replace(/-+/g, '-')
}

function parseData(r: any) {
  try { return typeof r.data_json === 'string' ? JSON.parse(r.data_json) : (r.data_json || {}) } catch { return {} }
}

function avg(nums: number[]): number | null {
  const v = nums.filter(n => !isNaN(n))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

// Best-before = production date + 3 years, formatted "Month YYYY" like the COA.
function bestBefore(productionDate: string): string {
  if (!productionDate) return ''
  const d = new Date(productionDate + (productionDate.length <= 7 ? '-01' : ''))
  if (isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 3)
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}
function monthYear(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + (dateStr.length <= 7 ? '-01' : ''))
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

// COA-standard result display for a micro organism value.
function microDisplay(key: string, raw: any): string {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim()
  const low = s.toLowerCase()
  if (key === 'salmonella_25g' || key === 'salmonella') return low.includes('absent') || low.includes('not') || s.startsWith('<') ? 'Absent' : s
  if (key === 'listeria' || key === 'ecoli_o157' || key === 'ecoli')
    return low.includes('not') || low.includes('absent') || /^<\s*\d/.test(s) ? 'Not detected' : s
  return s
}

const MICRO_ROWS: { key: string; label: string; specDefault: string }[] = [
  { key: 'tpc',            label: 'Total Plate Count',      specDefault: '<300 000' },
  { key: 'ecoli',          label: 'E.coli',                 specDefault: 'Not Detected' },
  { key: 'salmonella_25g', label: 'Salmonella spp',         specDefault: 'Absent/25g' },
  { key: 'listeria',       label: 'Listeria monocytogenes', specDefault: 'Absent/25g' },
  { key: 'ecoli_o157',     label: 'E.coli O157',            specDefault: 'Not detected' },
  { key: 'yeast',          label: 'Yeast',                  specDefault: '<5000' },
  { key: 'mould',          label: 'Mould',                  specDefault: '<5000' },
]

const CUT_LENGTH_ROWS: { key: string; label: string }[] = [
  { key: 'gt6',  label: '>6 mesh' },
  { key: 'gt10', label: '>10 mesh' },
  { key: 'gt12', label: '>12 mesh' },
  { key: 'gt16', label: '>16 mesh' },
  { key: 'gt20', label: '>20 mesh' },
  { key: 'gt60', label: '>60 mesh' },
  { key: 'dust', label: 'Dust - 60' },
]

interface CoaLine { label: string; spec: string; result: string }
interface CoaModel {
  batch: string
  found: { pasteuriser: boolean; micro: boolean; residue: boolean; pa: boolean; heavyMetals: boolean; moshMoah: boolean; chloratePerchlorate: boolean; waterActivity: boolean; sieving: boolean }
  header: Record<string, string>
  isOrganic: boolean
  micro: CoaLine[]
  cutLength: CoaLine[]
  other: CoaLine[]
  sections: { micro: boolean; cutLength: boolean; residue: boolean; pa: boolean; heavyMetals: boolean; moshMoah: boolean; chloratePerchlorate: boolean }
  matchedDoc: string          // doc_no of the customer spec applied ('' = none)
  candidateDocs: { doc_no: string; label: string }[]  // this customer's specs, for the picker
}

// Map the COA cut-length rows (gt6…dust) to coa_specs mesh keys (">6"…"Dust -60").
const CUT_TO_MESH: Record<string, string[]> = {
  gt6: ['>6'], gt10: ['>10'], gt12: ['>12'], gt16: ['>16'], gt20: ['>20'], gt60: ['>60'], dust: ['Dust -60', 'Dust'],
}
// Map the COA micro rows to coa_specs.micro keys.
const MICRO_TO_SPECKEY: Record<string, string> = {
  tpc: 'tpc', ecoli: 'ecoli', salmonella_25g: 'salmonella', listeria: 'listeria', ecoli_o157: 'ecoli_o157', yeast: 'yeast', mould: 'mould',
}

function normVariant(v: string): string {
  const s = (v || '').toLowerCase()
  const ra = /\bra\b|rainforest/.test(s)
  const org = /org/.test(s)
  if (ra && org) return 'ra-organic'
  if (ra) return 'ra-conventional'
  if (org) return 'organic'
  return 'conventional'
}
function normText(s: string) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

// Score how well a coa_specs row matches a batch's customer / grade / variant.
function scoreSpec(spec: any, customer: string, grade: string, variant: string): number {
  let score = 0
  const c = normText(customer), sc = normText(spec.customer || '')
  if (c && sc && (sc.includes(c) || c.includes(sc))) score += 100
  if (normVariant(variant) === normVariant(spec.variant || '')) score += 30
  const g = new Set(normText(grade).split(' ').filter(Boolean))
  const sg = new Set(normText([spec.grade, spec.product_description].filter(Boolean).join(' ')).split(' ').filter(Boolean))
  let overlap = 0; g.forEach(t => { if (sg.has(t)) overlap++ })
  score += overlap * 8
  return score
}

// Build the Bulk Density spec string from a coa_specs row's bd_min/bd_max.
function bdSpec(min: any, max: any): string {
  const mn = min != null && String(min).trim() !== '' ? String(min) : ''
  const mx = max != null && String(max).trim() !== '' ? String(max) : ''
  if (mn && mx) return `${mn} – ${mx}cc/100g`
  if (mx) return /[a-z%]/i.test(mx) ? mx : `max ${mx}cc/100g`
  if (mn) return `min ${mn}cc/100g`
  return ''
}
function moistSpec(v: any): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return /%/.test(s) ? s : `${s}%`
}

const inp = 'px-2 py-1 border border-gray-300 rounded text-[12px] outline-none focus:border-blue-500'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoaGeneratorPage() {
  const { p, session, isFullAdmin } = useAuth()
  const canUse = p('can_save_lab_results') || p('can_approve_runs')
  const db = getDb()

  const [batchInput, setBatchInput] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [model, setModel]           = useState<CoaModel | null>(null)
  const [sources, setSources]       = useState<any>(null)   // raw inputs, for re-applying a different spec
  const [allSpecs, setAllSpecs]     = useState<any[]>([])

  // Local-storage safety net — see lib/hooks/useDraftAutosave.ts. Once a batch
  // is looked up, the header fields, per-line spec/result overrides and order
  // details are all hand-typed corrections a lab manager can spend real time
  // on — autosave them every 15s so a dropped connection or closed tab before
  // Print/Export doesn't lose that work. Only one COA is edited at a time in
  // this UI, so a single fixed key is enough. Cleared once logGeneration()
  // confirms the coa_generated insert, or when the recovered draft is
  // explicitly discarded.
  const draftKey = 'coa_draft_active'
  const [recoveredDraft, setRecoveredDraft] = useState<{ data: any; savedAt: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]       = useState<any[]>([])
  // Delete-a-generated-COA confirmation popup: holds the history row awaiting
  // confirmation (null = popup closed), plus an in-flight flag.
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [deleting, setDeleting]     = useState(false)
  // Queue of COAs the lab manager has signed that still need the QA sign-off.
  const [showQueue, setShowQueue]   = useState(false)
  const [queue, setQueue]           = useState<any[]>([])
  // Persisted sign-off row for the current batch (loaded from the server) — this
  // is what makes the lab → QA hand-off work across separate logins/sessions.
  const [signoff, setSignoff] = useState<any>(null)
  const [signoffBusy, setSignoffBusy] = useState(false)
  // Who the Lab/QA manager are (read from the Staff Directory) + whether the
  // logged-in caller is one of them and has a signature on file. Server-resolved.
  const [sigInfo, setSigInfo] = useState<{
    lab: { title: string; name: string | null }
    qa:  { title: string; name: string | null }
    me:  { isLab: boolean; isQa: boolean; hasSignature: boolean; employeeId: string | null }
  }>({
    lab: { title: 'Laboratory Supervisor', name: null },
    qa:  { title: 'Quality Assurance Manager', name: null },
    me:  { isLab: false, isQa: false, hasSignature: false, employeeId: null },
  })
  // Per-signatory position/size adjustment (drag to move, handle to resize).
  const [sigAdjust, setSigAdjust]   = useState<Record<number, { dx: number; dy: number; scale: number }>>({})
  const adjustOf = (slot: number) => sigAdjust[slot] || { dx: 0, dy: 0, scale: 1 }
  const printRef = useRef<HTMLDivElement>(null)
  const whoAmI = session?.user?.email?.split('@')[0] || 'unknown'

  // Sign-off state derived from the persisted row.
  const labSigned = !!signoff?.lab_signed_at
  const qaSigned  = !!signoff?.qa_signed_at
  const sentToQa  = signoff?.status === 'sent_to_qa' || qaSigned
  const iAmLab = sigInfo.me.isLab
  const iAmQa  = sigInfo.me.isQa
  const hasSig = sigInfo.me.hasSignature
  const canSignLab = iAmLab && hasSig
  const canSignQa  = iAmQa  && hasSig

  // The two signature blocks for print/preview/PDF: fixed title + the person's
  // name (from the sign-off when signed, else the current Staff Directory holder)
  // + the signature they actually signed with (only shown once signed).
  const outputSigs = [
    { slot: 1, title: sigInfo.lab.title, name: signoff?.lab_name || sigInfo.lab.name || '', signature: labSigned ? (signoff?.lab_signature || '') : '' },
    { slot: 2, title: sigInfo.qa.title,  name: signoff?.qa_name  || sigInfo.qa.name  || '', signature: qaSigned  ? (signoff?.qa_signature  || '') : '' },
  ]

  // Load the persisted sign-off for a batch (drives what the two managers see).
  const loadSignoff = useCallback(async (batch?: string) => {
    if (!batch) { setSignoff(null); return }
    try {
      const res = await fetch(`/api/quality/coa-signoff?batch_no=${encodeURIComponent(batch)}`)
      const d = await res.json(); setSignoff(d.signoff ?? null)
    } catch { setSignoff(null) }
  }, [])

  // Reload sign-off + reset drag adjustments whenever a new batch/COA is looked up.
  useEffect(() => { setSigAdjust({}); loadSignoff(model?.batch) }, [model?.batch, loadSignoff])

  useDraftAutosave(draftKey, model, { enabled: !!model })
  useEffect(() => {
    if (model) return
    setRecoveredDraft(readDraft(draftKey))
  }, [draftKey, model])

  // Persist a sign-off (or the hand-off). The server verifies identity and
  // stamps the caller's own signature — the client never supplies one.
  const postSignoff = async (payload: any) => {
    if (!model?.batch) return
    setSignoffBusy(true)
    try {
      const res = await fetch('/api/quality/coa-signoff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // matchedDoc is just the applied spec's doc_no (a string) — never had
        // a .customer property, so this always sent undefined. The pasteuriser
        // batch's own customer field is the accurate source; header.destination
        // (which can be overridden by a saved logistics order) is the fallback
        // for a reopened historical COA, where sources is null.
        body: JSON.stringify({ batch_no: model.batch, customer: sources?.past?.customer || model.header?.destination || '', grade: model.header?.grade, ...payload }),
      })
      const d = await res.json()
      if (!res.ok) {
        if (d.needSignature) alert(`${d.error}\n\nGo to your Staff Directory profile → "Signature on file" to create one, then sign again.`)
        else alert(d.error || 'Sign-off failed')
        return
      }
      setSignoff(d.signoff ?? null)
    } catch (e: any) { alert('Sign-off failed: ' + e.message) }
    finally { setSignoffBusy(false) }
  }

  // Who the Lab/QA manager are (Staff Directory) + whether I'm one of them.
  useEffect(() => {
    fetch('/api/quality/coa-signatories').then(r => r.ok ? r.json() : null).then(d => { if (d) setSigInfo(d) }).catch(() => {})
  }, [])

  const loadHistory = useCallback(async () => {
    const { data } = await db.schema('qms').from('coa_generated').select('*').order('generated_at', { ascending: false }).limit(200)
    setHistory(data ?? [])
  }, [db])
  useEffect(() => { if (showHistory) loadHistory() }, [showHistory, loadHistory])

  // Delete a generated COA from history (lab manager only) — confirmed via the
  // popup below. Removes the qms.coa_generated row, then refreshes the list.
  const deleteCoa = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await db.schema('qms').from('coa_generated').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) { alert('Delete failed: ' + error.message); return }
    setDeleteTarget(null)
    loadHistory()
  }

  // COAs the lab manager has signed that are still awaiting the QA sign-off.
  const loadQueue = useCallback(async () => {
    const { data } = await db.schema('qms').from('coa_signoffs').select('*')
      .not('lab_signed_at', 'is', null).is('qa_signed_at', null)
      .order('lab_signed_at', { ascending: false }).limit(200)
    setQueue(data ?? [])
  }, [db])
  // Keep the pending count fresh on load and after each sign-off action.
  useEffect(() => { loadQueue() }, [loadQueue, signoff])

  const lookup = useCallback(async (batchRaw: string) => {
    const batch = batchRaw.trim()
    if (!batch) return
    setLoading(true); setError(''); setModel(null)
    const key = normBatch(batch)

    // Pull every source in parallel, then match on the normalised batch number.
    const [pRes, lRes, csRes, oRes] = await Promise.all([
      db.schema('qms').from('quality_records').select('*').eq('workcenter', 'pasteuriser').eq('workflow', 'pasteuriser_run').order('created_at', { ascending: false }).limit(1000),
      db.schema('qms').from('lab_results').select('*').order('created_at', { ascending: false }).limit(2000),
      db.schema('qms').from('coa_specs').select('*'),
      db.schema('qms').from('coa_orders').select('*'),
    ])
    setAllSpecs(csRes.data ?? [])
    // Saved logistics order details for this batch (if any)
    const orderRow = (oRes.data ?? []).find((o: any) => normBatch(o.batch_no) === key)

    // ── Pasteuriser batch (header + moisture/BD + sieve/cut-length averages) ──
    const pastRow = (pRes.data ?? []).map((r: any) => ({ ...r, d: parseData(r) }))
      .find((r: any) => normBatch(r.batch_number || r.d.batch_number) === key)
    const past = pastRow?.d
    const samples: any[] = past?.samples ?? []
    const mbSamples   = samples.filter(s => s.has_mb)
    const sieveSamples = samples.filter(s => s.has_sieve)

    const moistureAvg = avg(mbSamples.map(s => parseFloat(s.moisture)))
    const bdAvg       = avg(mbSamples.map(s => parseFloat(s.untapped_bd)))
    const cutResults: Record<string, string> = {}
    CUT_LENGTH_ROWS.forEach(row => {
      const a = avg(sieveSamples.map(s => parseFloat(s[row.key])))
      cutResults[row.key] = a != null ? `${a.toFixed(1).replace('.', ',')}%` : ''
    })
    const hasSieve = sieveSamples.length > 0 && Object.values(cutResults).some(v => v !== '')

    // ── Lab results for this batch, indexed by test type ──
    const labFor = (t: string) => (lRes.data ?? []).find((r: any) => r.test_type === t && normBatch(r.batch_no) === key)
    const microRec  = labFor('micro')
    const residueRec = labFor('residue')
    const paRec     = labFor('pa_final')
    const hmRec     = labFor('heavy_metals')
    const moshRec   = labFor('mosh_moah')
    const clRec     = labFor('chlorate_perchlorate')
    const waRec     = labFor('water_activity')
    const microData = microRec ? (microRec.results || microRec) : {}

    const customer = past?.customer || ''
    const grade    = past?.type_grade || [past?.grade, past?.variant].filter(Boolean).join(' ') || ''
    const variant  = past?.variant || (past?.is_organic ? 'Organic' : '') || key

    // ── Candidate customer specs + best match ──
    const specs = csRes.data ?? []
    const candidates = specs
      .map((s: any) => ({ s, score: scoreSpec(s, customer, grade, variant) }))
      .filter((x: any) => x.score >= 100)   // must at least match the customer
      .sort((a: any, b: any) => b.score - a.score)
    const bestSpec = candidates.length ? candidates[0].s : null

    const src = {
      batch, past, microData, moistureAvg, bdAvg, cutResults, hasSieve,
      found: { pasteuriser: !!past, micro: !!microRec, residue: !!residueRec, pa: !!paRec, heavyMetals: !!hmRec, moshMoah: !!moshRec, chloratePerchlorate: !!clRec, waterActivity: !!waRec, sieving: hasSieve },
      results: {
        residue: residueRec ? coaComplies(residueRec) : '', pa: paRec ? coaComplies(paRec) : '',
        hm: hmRec ? coaComplies(hmRec) : '', mosh: moshRec ? coaComplies(moshRec) : '',
        chlorate: clRec ? coaComplies(clRec) : '',
        waterActivity: waRec ? waterActivityValue(waRec) : '',
      },
      isOrganic: !!(past?.is_organic) || /org/i.test(past?.variant || '') || /organic|org/i.test(key),
      header: {
        date_of_issue: new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
        batch_number: past?.batch_number || batch,
        grade, destination: orderRow?.destination || customer,
        production_date: monthYear(past?.production_date || ''),
        best_before: bestBefore(past?.production_date || ''),
        // Logistics fields — pulled from a saved coa_orders row if present, else blank for later entry
        invoice_no: orderRow?.invoice_no || '', order_number: orderRow?.order_number || '',
        quantity_kg: orderRow?.quantity_kg || '', quantity_bags: orderRow?.quantity_bags || '',
      },
      candidateDocs: candidates.map((x: any) => ({ doc_no: x.s.doc_no, label: `${x.s.doc_no} — ${x.s.product_description || ''} (${x.s.variant || '—'})` })),
    }
    setSources(src)
    setModel(buildModel(src, bestSpec))
    if (!past && !microRec && !residueRec) setError(`No pasteuriser or lab data found for batch "${batch}".`)
    setLoading(false)
  }, [db])

  // Re-apply a different customer spec (from the picker) to the current sources.
  const applyDoc = (docNo: string) => {
    if (!sources) return
    const spec = allSpecs.find(s => s.doc_no === docNo) || null
    setModel(buildModel(sources, spec))
  }

  // Re-open a COA from History for editing (to correct a mistake). Loads the
  // exact saved snapshot into the editable generator; the header/table fields
  // are then editable and can be re-printed / re-exported. Re-printing logs a
  // fresh history entry.
  const openFromHistory = (h: any) => {
    const s = h.snapshot || {}
    if (!s.header) { alert('This history entry has no saved snapshot to edit. Look up the batch number to regenerate it instead.'); return }
    const sections = { micro: true, cutLength: false, residue: false, pa: false, heavyMetals: false, moshMoah: false, chloratePerchlorate: false, ...(s.sections || {}) }
    setSources(null)
    setBatchInput(h.batch_no || s.header.batch_number || '')
    setModel({
      batch: h.batch_no || s.header.batch_number || '',
      // mirror the included sections so the data-source panel / outstanding
      // banner don't flag a historical COA that was already complete.
      // Water Activity isn't a toggleable section (like Moisture/Bulk
      // Density, it's included whenever the value exists rather than gated
      // by a checkbox) — the saved "other" lines already carry it if it was
      // included, so this is just hardcoded true the same way pasteuriser is.
      found: { pasteuriser: true, micro: !!sections.micro, sieving: !!sections.cutLength, residue: !!sections.residue, pa: !!sections.pa, heavyMetals: !!sections.heavyMetals, moshMoah: !!sections.moshMoah, chloratePerchlorate: !!sections.chloratePerchlorate, waterActivity: true },
      isOrganic: !!s.isOrganic,
      header: s.header,
      micro: s.micro || [],
      cutLength: s.cutLength || [],
      other: s.other || [],
      sections,
      matchedDoc: h.doc_no || '',
      candidateDocs: [],
    })
    setShowHistory(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Log a generated COA to history (on Print / Export).
  const logGeneration = async (m: CoaModel) => {
    try {
      await db.schema('qms').from('coa_generated').insert({
        batch_no: m.header.batch_number || m.batch, customer: m.header.destination || '',
        grade: m.header.grade || '', variant: sources?.past?.variant || '',
        doc_no: m.matchedDoc || null, generated_by: whoAmI,
        snapshot: { header: m.header, micro: m.micro, cutLength: m.cutLength, other: m.other, sections: m.sections, isOrganic: m.isOrganic },
      })
      clearDraft(draftKey)
    } catch { /* non-blocking */ }
  }

  // Save the logistics order fields (invoice, order no, quantities, destination)
  // against the batch so they persist and pull through on future generations.
  const [savingOrder, setSavingOrder] = useState(false)
  const saveOrderDetails = async () => {
    if (!model) return
    setSavingOrder(true)
    const { error } = await db.schema('qms').from('coa_orders').upsert({
      batch_no: model.header.batch_number || model.batch,
      invoice_no: model.header.invoice_no || null, order_number: model.header.order_number || null,
      quantity_kg: model.header.quantity_kg || null, quantity_bags: model.header.quantity_bags || null,
      destination: model.header.destination || null, updated_by: whoAmI, updated_at: new Date().toISOString(),
    }, { onConflict: 'batch_no' })
    setSavingOrder(false)
    if (error) { alert('Save failed: ' + error.message); return }
    alert('Order details saved for ' + (model.header.batch_number || model.batch))
  }

  // ── Field mutators ──
  const setHeader = (k: string, v: string) => setModel(m => m ? { ...m, header: { ...m.header, [k]: v } } : m)
  const setLine = (section: 'micro' | 'cutLength' | 'other', i: number, field: 'spec' | 'result', v: string) =>
    setModel(m => m ? { ...m, [section]: (m as any)[section].map((l: CoaLine, idx: number) => idx === i ? { ...l, [field]: v } : l) } : m)
  const toggleSection = (s: keyof CoaModel['sections']) =>
    setModel(m => m ? { ...m, sections: { ...m.sections, [s]: !m.sections[s] } } : m)

  const description = model?.isOrganic ? COA_WORDING.descriptionOrganic : COA_WORDING.descriptionConventional

  // ── Outstanding data (sections that are on but have no source) ──
  const outstanding: string[] = []
  if (model) {
    if (!model.found.pasteuriser) outstanding.push('Pasteuriser batch (grade, moisture, bulk density)')
    if (model.sections.micro && !model.found.micro) outstanding.push('Microbiology results')
    if (model.sections.cutLength && !model.found.sieving) outstanding.push('Sieving / cut-length (pasteuriser sieve samples)')
    if (model.sections.residue && !model.found.residue) outstanding.push('Pesticide residue')
    if (model.sections.pa && !model.found.pa) outstanding.push('Pyrrolizidine Alkaloids')
    if (model.sections.heavyMetals && !model.found.heavyMetals) outstanding.push('Heavy metals')
    if (model.sections.moshMoah && !model.found.moshMoah) outstanding.push('MOSH/MOAH')
    if (model.sections.chloratePerchlorate && !model.found.chloratePerchlorate) outstanding.push('Chlorate/Perchlorate')
  }

  if (!canUse) return <div className="p-5 text-[13px] text-gray-500">You don't have permission to generate COAs.</div>

  return (
    <div className="p-5 max-w-[900px] mx-auto">
      <style>{`@media print { body * { visibility: hidden; } .coa-print, .coa-print * { visibility: visible; } .coa-print { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } }`}</style>

      <div className="mb-4 no-print">
        <h1 className="font-bold text-[22px]">📋 COA Generator</h1>
        <p className="text-[12px] text-gray-500">Type a batch number — data is pulled from Pasteuriser, its sieve samples, and Final Product Lab Results.</p>
      </div>

      {/* Recovered draft — see lib/hooks/useDraftAutosave.ts. Only surfaces when
          no COA is currently loaded, so it never interrupts an in-progress one. */}
      {recoveredDraft && !model && (
        <DraftRecoveryBanner savedAt={recoveredDraft.savedAt}
          onRestore={() => {
            setSources(null)
            setBatchInput(recoveredDraft.data?.batch || '')
            setModel(recoveredDraft.data)
            setRecoveredDraft(null)
          }}
          onDiscard={() => { clearDraft(draftKey); setRecoveredDraft(null) }} />
      )}

      {/* Batch search */}
      <div className="flex gap-2 mb-4 no-print">
        <input value={batchInput} onChange={e => setBatchInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') lookup(batchInput) }}
          placeholder="e.g. 26138-CON-SG"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-[13px] font-mono outline-none focus:border-blue-500" />
        <button onClick={() => lookup(batchInput)} disabled={loading}
          className="px-5 py-2 rounded-lg text-white text-[13px] font-bold disabled:opacity-50" style={{ background: '#1f4e79' }}>
          {loading ? 'Loading…' : 'Generate'}
        </button>
        <button onClick={() => setShowQueue(q => !q)}
          className="px-4 py-2 rounded-lg border text-[13px] font-semibold whitespace-nowrap" style={{ borderColor: showQueue ? '#7c3aed' : '#e5e7eb', background: showQueue ? '#f3e8ff' : '#fff', color: showQueue ? '#6b21a8' : '#374151' }}>
          🖊️ Awaiting QA sign-off{queue.length ? ` (${queue.length})` : ''}
        </button>
        <button onClick={() => setShowHistory(h => !h)}
          className="px-4 py-2 rounded-lg border text-[13px] font-semibold" style={{ borderColor: showHistory ? '#d97706' : '#e5e7eb', background: showHistory ? '#fef3c7' : '#fff', color: showHistory ? '#92400e' : '#374151' }}>
          🕘 History
        </button>
      </div>

      {/* Awaiting QA sign-off — COAs the lab manager has signed, ready for the Quality manager */}
      {showQueue && (
        <div className="mb-4 no-print border border-purple-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-purple-50 text-[11px] font-bold uppercase text-purple-800 flex items-center justify-between">
            <span>🖊️ COAs awaiting Quality Manager sign-off</span>
            <button onClick={loadQueue} className="text-[10px] font-semibold text-purple-600 hover:underline">↻ Refresh</button>
          </div>
          {queue.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-gray-400">Nothing awaiting sign-off. When the lab manager signs a COA, it appears here.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead><tr className="bg-gray-100">{['Batch','Customer','Grade','Signed by (Lab)','Signed on','Status',''].map(h => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {queue.map((q, i) => (
                    <tr key={q.batch_no} className="border-b border-gray-100" style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
                      <td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{q.batch_no}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{q.customer || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{q.grade || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{q.lab_name || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">{String(q.lab_signed_at || '').slice(0, 10)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{q.status === 'sent_to_qa' ? '📨 Sent to QA' : '🖊️ Lab signed'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <button onClick={() => { setBatchInput(q.batch_no); setShowQueue(false); lookup(q.batch_no) }}
                          className="px-3 py-1 rounded-lg text-white text-[11px] font-bold" style={{ background: '#7c3aed' }}>Open & sign</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Generation history */}
      {showHistory && (
        <div className="mb-4 no-print border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-amber-50 text-[11px] font-bold uppercase text-amber-800">🕘 Generated COAs</div>
          {history.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-gray-400">No COAs generated yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead><tr className="bg-gray-100">{['Generated','Batch','Customer','Grade','Spec used','By',''].map(h => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.id} className="border-b border-gray-100" style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-500">{isoDateTime(h.generated_at)}</td>
                      <td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{h.batch_no}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{h.customer || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{h.grade || '—'}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{h.doc_no || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{h.generated_by || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openFromHistory(h)} title="Open this COA to correct a mistake and re-print/export"
                            className="px-3 py-1 rounded-lg text-white text-[11px] font-bold" style={{ background: '#1f4e79' }}>✏️ Edit</button>
                          {(sigInfo.me.isLab || sigInfo.me.isQa || isFullAdmin) && (
                            <button onClick={() => setDeleteTarget(h)} title="Delete this generated COA"
                              className="px-3 py-1 rounded-lg text-white text-[11px] font-bold" style={{ background: '#b91c1c' }}>🗑 Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete-COA confirmation popup */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center no-print" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { if (!deleting) setDeleteTarget(null) }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-[15px] font-bold text-gray-900">Delete this COA?</div>
            </div>
            <div className="px-5 py-4 text-[13px] text-gray-700">
              <p className="mb-3">This will permanently remove the generated COA for batch{' '}
                <span className="font-mono font-bold">{deleteTarget.batch_no || '—'}</span>
                {deleteTarget.customer ? <> ({deleteTarget.customer})</> : null} from the history. This cannot be undone.</p>
              <div className="text-[11px] text-gray-500">
                Generated {isoDateTime(deleteTarget.generated_at)}{deleteTarget.generated_by ? <> · by {deleteTarget.generated_by}</> : null}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="px-4 py-2 rounded-lg border border-gray-300 text-[12px] font-semibold text-gray-700 bg-white">Cancel</button>
              <button onClick={deleteCoa} disabled={deleting}
                className="px-4 py-2 rounded-lg text-[12px] font-bold text-white" style={{ background: deleting ? '#9ca3af' : '#b91c1c' }}>
                {deleting ? 'Deleting…' : '🗑 Delete COA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 no-print">{error}</div>}

      {model && (
        <>
          {/* Outstanding + section toggles */}
          {/* Customer spec picker — drives the Specification column + which sections apply */}
          <div className="mb-4 no-print border border-gray-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase text-gray-500 mb-1">Customer specification</div>
            {model.candidateDocs.length === 0 ? (
              <div className="text-[12px] text-amber-700">No customer spec found for this batch's customer — specs will be blank. Add one under Customer Specs → COA Requirements.</div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={model.matchedDoc} onChange={e => applyDoc(e.target.value)}
                  className="flex-1 min-w-[280px] px-2 py-1.5 border border-gray-300 rounded-lg text-[12px]">
                  <option value="">— none (blank specs) —</option>
                  {model.candidateDocs.map(c => <option key={c.doc_no} value={c.doc_no}>{c.label}</option>)}
                </select>
                <span className="text-[11px] text-gray-500">Matched by customer + grade + variant — change if needed.</span>
              </div>
            )}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 no-print">
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-[11px] font-bold uppercase text-gray-500 mb-2">Data sources</div>
              {([['pasteuriser','Pasteuriser'],['micro','Microbiology'],['sieving','Sieving / cut-length'],['residue','Residue'],['pa','Pyrrolizidine Alkaloids'],['heavyMetals','Heavy metals'],['moshMoah','MOSH/MOAH'],['chloratePerchlorate','Chlorate/Perchlorate'],['waterActivity','Water Activity']] as const).map(([k,l]) => (
                <div key={k} className="flex items-center justify-between text-[12px] py-0.5">
                  <span>{l}</span>
                  <span className={(model.found as any)[k] ? 'text-green-700 font-semibold' : 'text-gray-400'}>
                    {(model.found as any)[k] ? '✓ found' : '— none'}
                  </span>
                </div>
              ))}
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-[11px] font-bold uppercase text-gray-500 mb-2">Include sections</div>
              {([['micro','Microbiology'],['cutLength','Cut length / sieving'],['residue','Pesticide residue'],['pa','Pyrrolizidine Alkaloids'],['heavyMetals','Heavy metals'],['moshMoah','MOSH/MOAH'],['chloratePerchlorate','Chlorate/Perchlorate']] as const).map(([k,l]) => (
                <label key={k} className="flex items-center gap-2 text-[12px] py-0.5 cursor-pointer">
                  <input type="checkbox" checked={model.sections[k]} onChange={() => toggleSection(k)} />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {outstanding.length > 0 && (
            <div className="mb-4 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 no-print">
              ⚠ Outstanding — included but no data yet: {outstanding.join(' · ')}
            </div>
          )}

          {/* Logistics order details — entered later by logistics, saved per batch */}
          <div className="mb-4 no-print border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold uppercase text-gray-500">🚚 Order details (logistics)</div>
              <button onClick={saveOrderDetails} disabled={savingOrder}
                className="px-3 py-1 rounded-lg text-white text-[11px] font-bold disabled:opacity-50" style={{ background: '#1f4e79' }}>
                {savingOrder ? 'Saving…' : '💾 Save order details'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {([['invoice_no','Invoice No.'],['order_number','Order Number'],['quantity_kg',"Quantity (Kg's)"],['quantity_bags','Quantity of Bags'],['destination','Destination']] as const).map(([k,l]) => (
                <div key={k}>
                  <label className="block text-[9px] font-bold uppercase text-gray-500 mb-0.5">{l}</label>
                  <input value={model.header[k] || ''} onChange={e => setHeader(k, e.target.value)}
                    placeholder="—" className="w-full px-2 py-1 border border-gray-300 rounded text-[12px] outline-none focus:border-blue-500" />
                </div>
              ))}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">These fill in the header and persist against the batch — logistics can enter them later; they'll pull through next time.</div>
          </div>

          {/* COA sign-off — Lab Manager then Quality Manager, identities read from
              the Staff Directory; each signs with their own signature. */}
          <div className="mb-4 no-print border border-gray-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase text-gray-500 mb-2">✔ COA Sign-off</div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Step 1 — Lab manager */}
              {labSigned
                ? <span className="px-3 py-2 rounded-lg bg-ok/10 text-ok text-[12px] font-bold">✔ Lab Manager signed{signoff?.lab_name ? ` — ${signoff.lab_name}` : ''} · {String(signoff?.lab_signed_at || '').slice(0, 10)}</span>
                : <button
                    onClick={() => postSignoff({ slot: 1 })}
                    disabled={!canSignLab || signoffBusy}
                    title={!iAmLab ? 'Only the Lab Manager (per the Staff Directory) may sign this slot' : (iAmLab && !hasSig ? 'Add your signature on your Staff Directory profile first' : '')}
                    className="px-4 py-2 rounded-lg text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#1f4e79' }}>
                    {signoffBusy ? 'Signing…' : '✔ Lab Manager sign-off'}
                  </button>}

              {/* Hand-off — lab manager sends to the QA manager */}
              {labSigned && !qaSigned && iAmLab && !sentToQa && (
                <button onClick={() => postSignoff({ action: 'send_to_qa' })} disabled={signoffBusy}
                  className="px-4 py-2 rounded-lg text-white text-[12px] font-bold disabled:opacity-50" style={{ background: '#b45309' }}>
                  📤 Send to Quality Manager
                </button>
              )}
              {sentToQa && !qaSigned && <span className="text-[11px] text-amber-700 font-semibold">📨 Sent to the Quality Manager — awaiting sign-off</span>}

              {/* Step 2 — QA manager */}
              {qaSigned
                ? <span className="px-3 py-2 rounded-lg bg-ok/10 text-ok text-[12px] font-bold">✔ Quality Manager signed{signoff?.qa_name ? ` — ${signoff.qa_name}` : ''} · {String(signoff?.qa_signed_at || '').slice(0, 10)}</span>
                : <button
                    onClick={() => postSignoff({ slot: 2 })}
                    disabled={!labSigned || !canSignQa || signoffBusy}
                    title={!labSigned ? 'The lab manager must sign off first' : (!iAmQa ? 'Only the Quality Manager (per the Staff Directory) may sign' : (iAmQa && !hasSig ? 'Add your signature on your Staff Directory profile first' : ''))}
                    className="px-4 py-2 rounded-lg text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#7c3aed' }}>
                    {signoffBusy ? 'Signing…' : '✔ Quality Manager sign-off'}
                  </button>}
            </div>
            {!labSigned && <div className="text-[10px] text-gray-400 mt-1">Lab manager signs first — the Quality manager is then notified automatically and the COA appears in her &quot;Awaiting QA sign-off&quot; list.</div>}
            {(iAmLab || iAmQa) && !hasSig && (
              <div className="text-[10px] text-amber-600 mt-1">⚠ You have no signature on file — create one on your{' '}
                <a href={sigInfo.me.employeeId ? `/production/staff/${sigInfo.me.employeeId}` : '/production/staff'} className="underline font-semibold">Staff Directory profile</a>, then sign.
              </div>
            )}
            <div className="text-[10px] text-gray-400 mt-2">The Lab Manager and Quality Manager are read from the Staff Directory. Each signs with their own Staff Directory signature, from their own login — a signature can never be applied by anyone else. Sign-offs are saved to the COA, so the two managers can sign at different times.</div>
          </div>

          <div className="flex gap-2 mb-4 no-print">
            <button onClick={() => { logGeneration(model); window.print() }} className="px-4 py-2 rounded-lg border border-gray-300 text-[12px] font-semibold">🖨 Print</button>
            <button onClick={() => { logGeneration(model); exportPdf(model, description, outputSigs, sigAdjust) }} className="px-4 py-2 rounded-lg text-white text-[12px] font-bold" style={{ background: '#166534' }}>⬇ Export PDF</button>
          </div>

          {/* ── COA preview (editable) ── */}
          <div ref={printRef} className="coa-print bg-white border border-gray-300 rounded-lg p-6 text-[12px]" style={{ color: '#111' }}>
            {/* Logo + title */}
            <div className="flex items-center mb-4 border-b-2 border-gray-800 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Cape Natural Tea Products" style={{ height: 56, width: 'auto', objectFit: 'contain' }} />
              <div className="flex-1 text-center font-bold text-[16px] tracking-wide">CERTIFICATE OF ANALYSIS</div>
              <div style={{ width: 56 }} />
            </div>

            {/* Header grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-4">
              {([
                ['date_of_issue','DATE OF ISSUE'],['batch_number','BATCH NUMBER'],
                ['invoice_no','INVOICE No.'],['grade','GRADE'],
                ['destination','DESTINATION'],['quantity_bags','QUANTITY OF BAGS'],
                ['order_number','ORDER NUMBER'],['production_date','PRODUCTION DATE'],
                ['quantity_kg',"QUANTITY (Kg's)"],['best_before','BEST BEFORE DATE'],
              ] as const).map(([k,l]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="font-bold text-[10px] uppercase text-gray-600 w-[130px] shrink-0">{l}</span>
                  <input value={model.header[k] || ''} onChange={e => setHeader(k, e.target.value)}
                    className="flex-1 px-1.5 py-0.5 border-b border-dashed border-gray-300 text-[12px] outline-none focus:border-blue-500 bg-transparent" />
                </div>
              ))}
            </div>

            {/* Description */}
            <div className="mb-3">
              <div className="font-bold text-[11px] uppercase mb-1">Description of Goods</div>
              <div className="text-[11px] italic">{description}</div>
            </div>

            {/* Microbiology */}
            {model.sections.micro && (
              <CoaTable title="Microbiological Analyses" cols={['Organism', "Specification (cfu's/g)", "Result (cfu's/g)"]}
                lines={model.micro} onEdit={(i, f, v) => setLine('micro', i, f, v)} />
            )}

            {/* Cut length */}
            {model.sections.cutLength && (
              <CoaTable title="Cut Length Guidelines" cols={['Sieve Size', 'Specification', 'Result']}
                lines={model.cutLength} onEdit={(i, f, v) => setLine('cutLength', i, f, v)} />
            )}

            {/* Other analysis — the row list and the edit-index mapping must use
                the SAME predicate, so it's defined once (they were previously
                two copies that had to be kept in step by hand). */}
            <CoaTable title="Other Analysis" cols={['Description', 'Specification', 'Result']}
              lines={model.other.filter(l => otherRowVisible(l, model.sections))}
              onEdit={(i, f, v) => {
                // map filtered index back to full `other` array
                const shown = model.other.filter(l => otherRowVisible(l, model.sections))
                const target = shown[i]
                const realIdx = model.other.indexOf(target)
                if (realIdx >= 0) setLine('other', realIdx, f, v)
              }} />

            {/* Signatures — Staff-Directory names, signed with each person's own signature */}
            <div className="flex justify-between gap-8 mt-10">
              {outputSigs.map((s) => (
                <div key={s.slot} style={{ flex: 1, maxWidth: 260 }}>
                  {s.signature
                    ? <DraggableSignature src={s.signature} adjust={adjustOf(s.slot)} onChange={a => setSigAdjust(p => ({ ...p, [s.slot]: a }))} />
                    : <div style={{ height: 40 }} />}
                  <div style={{ borderTop: '1px solid #111', paddingTop: 3 }} />
                  <div className="text-[11px] font-semibold">{s.title}</div>
                  <div className="text-[11px]">{s.name}</div>
                </div>
              ))}
            </div>

            {/* Company footer */}
            <div className="text-center mt-8">
              {COA_WORDING.companyFooter.map((line, i) => (
                <div key={i} className="text-[9px] font-bold" style={{ color: i === 0 ? '#166534' : '#4b5563', lineHeight: 1.35 }}>{line}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Build the full COA model from raw sources + an optional matched customer spec.
// When a spec is supplied, the Specification columns and which sections appear
// are driven by the customer's requirements; results come from the lab/pasteuriser.
function buildModel(src: any, spec: any): CoaModel {
  const sp = spec?.specs || {}
  const req = (v: any) => v != null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'NOT REQUIRED'

  // ── Microbiology: rows required by the spec (or, with no spec, whatever the lab reported) ──
  let micro: CoaLine[]
  if (spec) {
    micro = MICRO_ROWS
      .filter(r => req(sp.micro?.[MICRO_TO_SPECKEY[r.key]]))
      .map(r => ({ label: r.label, spec: String(sp.micro[MICRO_TO_SPECKEY[r.key]]), result: microDisplay(r.key, src.microData[r.key]) }))
  } else {
    micro = MICRO_ROWS
      .map(r => ({ key: r.key, label: r.label, spec: r.specDefault, result: microDisplay(r.key, src.microData[r.key]) }))
      .filter(r => r.result !== '').map(({ label, spec, result }) => ({ label, spec, result }))
  }

  // ── Cut length: spec from the matched customer spec's mesh set ──
  const cutLength: CoaLine[] = CUT_LENGTH_ROWS.map(row => {
    let specVal = ''
    if (spec) { for (const mk of CUT_TO_MESH[row.key]) { const m = sp.mesh?.[mk]; if (m && req(m.spec)) { specVal = String(m.spec); break } } }
    return { label: row.label, spec: specVal, result: src.cutResults[row.key] || '' }
  })

  // ── Other analysis ──
  const other: CoaLine[] = []
  if (src.moistureAvg != null) other.push({ label: 'Moisture', spec: spec ? moistSpec(spec.moisture_max) || '<10%' : '<10%', result: `${src.moistureAvg.toFixed(1).replace('.', ',')}%` })
  if (src.bdAvg != null) other.push({ label: 'Bulk Density', spec: spec ? (bdSpec(spec.bd_min, spec.bd_max) || '280 – 340cc/100g') : '280 – 340cc/100g', result: `${Math.round(src.bdAvg)}cc/100g` })
  // Like Moisture/Bulk Density above (a measurement to show, not a
  // pass/fail contaminant toggle) — included whenever a result exists rather
  // than gated by sections/wantX, so there's no "Include sections" checkbox
  // for it either.
  if (src.results.waterActivity) other.push({ label: 'Water Activity', spec: (spec && req(sp.other?.water_activity)) ? String(sp.other.water_activity) : '', result: src.results.waterActivity })
  other.push({ label: 'Foreign Material', spec: (spec && req(sp.other?.foreign_material)) ? String(sp.other.foreign_material) : '<1%', result: '0.0%' })
  const wantResidue = spec ? req(sp.other?.residue_reg) : src.found.residue
  const wantPa      = spec ? req(sp.contaminants?.pyrrolizidine_alkaloids) : src.found.pa
  const wantHm      = spec ? ['lead','cadmium','mercury','arsenic','copper'].some(k => req(sp.contaminants?.[k])) : src.found.heavyMetals
  const wantMosh    = spec ? req(sp.contaminants?.mosh_moah) : src.found.moshMoah
  // coa_specs already carried a chlorate_perchlorate contaminant field — this
  // is the row that finally renders it, now that a lab result can supply one.
  const wantChlor   = spec ? req(sp.contaminants?.chlorate_perchlorate) : src.found.chloratePerchlorate
  if (wantResidue) other.push({ label: 'Pesticide residue', spec: (spec && req(sp.other?.residue_reg)) ? String(sp.other.residue_reg) : COA_WORDING.residueRegulation, result: src.results.residue })
  if (wantPa)      other.push({ label: 'Pyrrolizidine Alkaloids', spec: (spec && req(sp.contaminants?.pyrrolizidine_alkaloids)) ? String(sp.contaminants.pyrrolizidine_alkaloids) : '<50 μg', result: src.results.pa })
  if (wantHm)      other.push({ label: 'Heavy Metals', spec: spec ? ['lead','cadmium','mercury','arsenic','copper'].filter(k => req(sp.contaminants?.[k])).map(k => `${k[0].toUpperCase()+k.slice(1)} ${sp.contaminants[k]}`).join('; ') : '', result: src.results.hm })
  if (wantMosh)    other.push({ label: 'MOSH/MOAH', spec: (spec && req(sp.contaminants?.mosh_moah)) ? String(sp.contaminants.mosh_moah) : '', result: src.results.mosh })
  if (wantChlor)   other.push({ label: 'Chlorate/Perchlorate', spec: (spec && req(sp.contaminants?.chlorate_perchlorate)) ? String(sp.contaminants.chlorate_perchlorate) : '', result: src.results.chlorate })
  other.push({ label: 'Sensorical Properties', spec: (spec && req(sp.other?.sensorial)) ? String(sp.other.sensorial) : COA_WORDING.sensorical, result: 'Complies' })

  const wantMicro = spec ? micro.length > 0 : src.found.micro
  const wantCut   = spec ? cutLength.some(c => c.spec !== '') : src.found.sieving

  return {
    batch: src.batch, found: src.found, isOrganic: src.isOrganic, header: { ...src.header },
    micro, cutLength, other,
    sections: { micro: wantMicro, cutLength: wantCut, residue: wantResidue, pa: wantPa, heavyMetals: wantHm, moshMoah: wantMosh, chloratePerchlorate: wantChlor },
    matchedDoc: spec?.doc_no || '',
    candidateDocs: src.candidateDocs || [],
  }
}

// ─── Signature pad (draw with mouse or touch) ─────────────────────────────────

// A signed signature that can be dragged to reposition and resized via a corner
// handle. The bottom edge stays anchored just above the ruled line; scaling grows
// it upward. The handle is .no-print so it never appears on the printed COA.
function DraggableSignature({ src, adjust, onChange }: {
  src: string
  adjust: { dx: number; dy: number; scale: number }
  onChange: (a: { dx: number; dy: number; scale: number }) => void
}) {
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const rez  = useRef<{ x: number; scale: number } | null>(null)
  const baseH = 40

  const onImgDown = (e: React.PointerEvent) => {
    e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, dx: adjust.dx, dy: adjust.dy }
  }
  const onImgMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    // bottom-anchored: dragging up (smaller clientY) increases dy
    onChange({ ...adjust, dx: drag.current.dx + (e.clientX - drag.current.x), dy: drag.current.dy - (e.clientY - drag.current.y) })
  }
  const endImg = () => { drag.current = null }

  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    rez.current = { x: e.clientX, scale: adjust.scale }
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!rez.current) return
    onChange({ ...adjust, scale: Math.max(0.4, Math.min(3, rez.current.scale + (e.clientX - rez.current.x) / 90)) })
  }
  const endHandle = () => { rez.current = null }

  return (
    <div style={{ position: 'relative', height: baseH, overflow: 'visible' }}>
      <div style={{ position: 'absolute', left: adjust.dx, bottom: adjust.dy }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="signature" draggable={false}
          onPointerDown={onImgDown} onPointerMove={onImgMove} onPointerUp={endImg} onPointerCancel={endImg}
          style={{ display: 'block', height: baseH * adjust.scale, width: 'auto', maxWidth: 260, cursor: 'move', touchAction: 'none', userSelect: 'none' }} />
        <div className="no-print" title="Drag to resize"
          onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={endHandle} onPointerCancel={endHandle}
          style={{ position: 'absolute', right: -6, top: -6, width: 12, height: 12, background: '#1f4e79', border: '2px solid #fff', borderRadius: 3, cursor: 'nesw-resize', touchAction: 'none' }} />
      </div>
    </div>
  )
}

// Result string for a "Complies / None detected" style block from a lab record.
// Whether an "Other Analysis" row belongs on the COA, given which sections are
// switched on. Rows with no toggle of their own (Moisture, Bulk Density,
// Foreign Material, Sensorical Properties) always show.
function otherRowVisible(l: CoaLine, sections: CoaModel['sections']): boolean {
  switch (l.label) {
    case 'Pesticide residue':         return sections.residue
    case 'Pyrrolizidine Alkaloids':   return sections.pa
    case 'Heavy Metals':              return sections.heavyMetals
    case 'MOSH/MOAH':                 return sections.moshMoah
    case 'Chlorate/Perchlorate':      return sections.chloratePerchlorate
    default:                          return true
  }
}

// Water Activity is a measurement people want to see on the COA (like
// Moisture/Bulk Density), not a pass/fail verdict like the contaminant rows —
// coaComplies() would collapse it to "Complies"/"Does not comply" and lose
// the actual Aw value, so this reads the number straight out of the one
// analyte the water_activity prompt extracts.
function waterActivityValue(rec: any): string {
  const d = rec.results || rec
  const a = Array.isArray(d.analytes) ? d.analytes[0] : null
  if (!a || a.result == null || a.result === '') return ''
  return `${a.result}${a.unit ? ' ' + a.unit : ''}`
}

function coaComplies(rec: any): string {
  const d = rec.results || rec
  const status = String(d.overall_status || rec.overall_status || '').toLowerCase()
  if (Array.isArray(d.compounds_detected) && d.compounds_detected.length === 0) return 'None detected'
  if (Array.isArray(d.analytes) && d.analytes.length === 0) return 'Complies'
  if (status.includes('pass') || status.includes('compl')) return 'Complies'
  if (status.includes('fail') || status.includes('exceed')) return 'Does not comply'
  return 'Complies'
}

// ─── Editable COA table ───────────────────────────────────────────────────────

function CoaTable({ title, cols, lines, onEdit }: {
  title: string; cols: string[]; lines: CoaLine[]; onEdit: (i: number, field: 'spec' | 'result', v: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="font-bold text-[11px] uppercase mb-1">{title}</div>
      {/* Fixed column widths (shared with every COA table) so the vertical
          borders line up across Microbiology / Cut Length / Other Analysis,
          instead of each table auto-sizing to its own longest label. */}
      <table className="w-full border-collapse text-[11px]" style={{ tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '32%' }} /><col style={{ width: '38%' }} /><col style={{ width: '30%' }} /></colgroup>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="border border-gray-300 bg-gray-100 px-2 py-1 text-center font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="border border-gray-300 px-2 py-1">{l.label}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <input value={l.spec} onChange={e => onEdit(i, 'spec', e.target.value)}
                  className="w-full text-center text-[11px] outline-none bg-transparent focus:bg-blue-50" />
              </td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <input value={l.result} onChange={e => onEdit(i, 'result', e.target.value)}
                  className="w-full text-center text-[11px] outline-none bg-transparent focus:bg-blue-50 font-semibold" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── PDF export (jsPDF, laid out to mirror the template) ──────────────────────

async function exportPdf(model: CoaModel, description: string, signatories?: { slot: number; title: string; name: string; signature: string }[], sigAdjust?: Record<number, { dx: number; dy: number; scale: number }>) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  // Logo (top-left) + centred title
  const logo = await loadImage('/logo.png')
  if (logo) {
    const h = 42, w = logo.w * (h / logo.h)
    doc.addImage(logo.dataUrl, 'PNG', margin, y - 28, w, h)
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('CERTIFICATE OF ANALYSIS', pageW / 2, y, { align: 'center' })
  doc.setLineWidth(1.2); doc.line(margin, y + 18, pageW - margin, y + 18)
  y += 40

  // Header — two columns
  const hdr: [string, string][] = [
    ['DATE OF ISSUE', model.header.date_of_issue], ['BATCH NUMBER', model.header.batch_number],
    ['INVOICE No.', model.header.invoice_no], ['GRADE', model.header.grade],
    ['DESTINATION', model.header.destination], ['QUANTITY OF BAGS', model.header.quantity_bags],
    ['ORDER NUMBER', model.header.order_number], ['PRODUCTION DATE', model.header.production_date],
    ["QUANTITY (Kg's)", model.header.quantity_kg], ['BEST BEFORE DATE', model.header.best_before],
  ]
  doc.setFontSize(8)
  const colX = [margin, pageW / 2 + 10]
  const colEnd = [pageW / 2 - 10, pageW - margin]
  for (let i = 0; i < hdr.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const item = hdr[i + c]; if (!item) continue
      const x = colX[c]
      const valX = x + 95
      doc.setFont('helvetica', 'bold'); doc.text(item[0], x, y)
      doc.setFont('helvetica', 'normal'); doc.text(String(item[1] || ''), valX, y)
      doc.setDrawColor(180); doc.setLineWidth(0.5)
      doc.setLineDashPattern([1.5, 1.5], 0)
      doc.line(valX, y + 2, colEnd[c], y + 2)
      doc.setLineDashPattern([], 0)
    }
    y += 15
  }
  y += 8

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('DESCRIPTION OF GOODS', margin, y); y += 12
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
  const descLines = doc.splitTextToSize(description, pageW - 2 * margin)
  doc.text(descLines, margin, y); y += descLines.length * 10 + 8

  const drawTable = (title: string, cols: string[], lines: CoaLine[]) => {
    if (!lines.length) return
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(title.toUpperCase(), margin, y); y += 12
    const w = pageW - 2 * margin
    const cw = [w * 0.4, w * 0.32, w * 0.28]
    doc.setFontSize(8)
    // header row
    doc.setFillColor(230, 230, 230); doc.rect(margin, y - 9, w, 14, 'F')
    doc.setFont('helvetica', 'bold')
    let cx = margin
    cols.forEach((c, i) => { doc.text(c, cx + cw[i] / 2, y, { align: 'center' }); cx += cw[i] })
    y += 6
    doc.setFont('helvetica', 'normal')
    lines.forEach(l => {
      const vals = [l.label, l.spec, l.result]
      const cellLines = vals.map((v, i) => doc.splitTextToSize(String(v || ''), cw[i] - 8))
      const rowH = Math.max(...cellLines.map(cl => cl.length)) * 9 + 4
      cx = margin
      doc.setDrawColor(200); doc.rect(margin, y - 2, w, rowH)
      vals.forEach((_, i) => {
        doc.text(cellLines[i], cx + cw[i] / 2, y + 7, { align: 'center' })
        if (i > 0) doc.line(cx, y - 2, cx, y - 2 + rowH)
        cx += cw[i]
      })
      y += rowH
    })
    y += 10
  }

  if (model.sections.micro) drawTable('Microbiological Analyses', ['Organism', "Spec (cfu's/g)", "Result (cfu's/g)"], model.micro)
  if (model.sections.cutLength) drawTable('Cut Length Guidelines', ['Sieve Size', 'Specification', 'Result'], model.cutLength)
  // Was a separate inline filter that had drifted out of sync with the
  // screen/print path's otherRowVisible() — it was already missing
  // Chlorate/Perchlorate, which meant a toggled-off row still made it into
  // the exported PDF. Sharing the one function keeps exported PDFs and every
  // future "Other Analysis" row (like Water Activity) consistent by
  // construction instead of by remembering to update two places.
  drawTable('Other Analysis', ['Description', 'Specification', 'Result'], model.other.filter(l => otherRowVisible(l, model.sections)))

  // Signatures — two blocks with the drawn signature above a ruled line
  y += 50
  const sigList = (signatories && signatories.length ? signatories : COA_WORDING.signatories.map((s, i) => ({ slot: i, ...s, signature: '' }))) as any[]
  const sigW = 170
  const sigX = [margin + 20, pageW - margin - 20 - sigW]
  for (let i = 0; i < Math.min(2, sigList.length); i++) {
    const s = sigList[i]
    const x = sigX[i]
    if (s.signature) {
      // signature may be a static path (/signatures/x.png) or a drawn data URL —
      // loadImage handles both and gives us dimensions to keep the aspect ratio.
      const img = await loadImage(s.signature)
      if (img) {
        // Apply the on-screen move/resize. Preview base height is 40px ≈ 30pt,
        // so convert px offsets to pt with k = 0.75. Bottom stays anchored above
        // the line (y - 2) and scaling grows the image upward.
        const adj = (sigAdjust && sigAdjust[s.slot]) || { dx: 0, dy: 0, scale: 1 }
        const k = 0.75
        const h = 30 * adj.scale
        const w = Math.min(150, img.w * (30 / img.h)) * adj.scale
        const left = x + adj.dx * k
        const top = (y - 2) - h - adj.dy * k
        try { doc.addImage(img.dataUrl, 'PNG', left, top, w, h) } catch { /* ignore bad image */ }
      }
    }
    doc.setDrawColor(17); doc.setLineWidth(0.8); doc.line(x, y, x + sigW, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(s.title || '', x, y + 12)
    doc.setFont('helvetica', 'normal'); doc.text(s.name || '', x, y + 23)
  }
  y += 46

  // Centred company footer
  COA_WORDING.companyFooter.forEach((line, i) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(i === 0 ? 8 : 7)
    doc.setTextColor(i === 0 ? 22 : 75, i === 0 ? 101 : 85, i === 0 ? 52 : 99)
    doc.text(line, pageW / 2, y, { align: 'center' }); y += (i === 0 ? 9 : 8)
  })
  doc.setTextColor(0, 0, 0)

  doc.save(`COA_${normBatch(model.batch)}.pdf`)
}
