'use client'

/**
 * Refining 1 & 2 — Production Capture Form
 * ─────────────────────────────────────────────────────────────────────────────
 * Tablet-first form for capturing a single Refining shift.
 *
 * LAYOUT
 * ┌─────────────────────────────────────────────────────┐
 * │ Header — date · shift · line (R1/R2) · names        │
 * ├─────────────────────────────────────────────────────┤
 * │ Section A — Input bags (debagging)                   │
 * │   Each row: serial · lot · variant · product · kg    │
 * │   Running total A                                    │
 * ├─────────────────────────────────────────────────────┤
 * │ Section B — Output group 1                           │
 * │ Section C — Output group 2                           │
 * │ Section D — Output group 3                           │
 * │   Each group is independent — product · serial · kg  │
 * ├─────────────────────────────────────────────────────┤
 * │ Mass balance: A − B − C − D = E                      │
 * │   Amber warning if |E| > 15 kg                       │
 * ├─────────────────────────────────────────────────────┤
 * │ Supervisor sign-off — SignaturePad                   │
 * └─────────────────────────────────────────────────────┘
 *
 * KEYPADS
 * All numeric and serial inputs open as BottomSheets so operators
 * can tap large targets on a tablet. BatchSelectModal (Task 4) shows
 * recent prod_bagging outputs as pre-fill options for debagging serials.
 */

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import {
  Plus, Trash2, AlertTriangle, CheckCircle2,
  Save, Send, RotateCcw, Layers,
} from 'lucide-react'
import clsx from 'clsx'

import BottomSheet    from '@/components/ui/BottomSheet'
import ConfirmSheet   from '@/components/ui/ConfirmSheet'
import SignaturePad   from '@/components/ui/SignaturePad'
import NumKeypad      from '@/components/count/NumKeypad'
import BatchKeypad    from '@/components/count/BatchKeypad'
import BatchSelectModal from '@/components/production/BatchSelectModal'
import { useToast }   from '@/components/ui/Toast'

import {
  emptyDebaggingRow, emptyBaggingRow,
  calcMassBalance, VARIANT_OPTIONS, SHIFT_OPTIONS,
} from '@/lib/production/types'
import type {
  RefiningFormState, DebaggingRow, BaggingRow,
  OutputGroup, Shift,
} from '@/lib/production/types'

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL STATE
// ─────────────────────────────────────────────────────────────────────────────

function initialState(line: 'ref1' | 'ref2'): RefiningFormState {
  return {
    // Header fields
    date:       format(new Date(), 'yyyy-MM-dd'),
    shift:      'morning',
    line,
    operator1:  '',
    operator2:  '',
    supervisor: '',

    // Bag rows — start with one empty row each
    debagging: [emptyDebaggingRow()],
    outputB:   [emptyBaggingRow()],
    outputC:   [emptyBaggingRow()],
    outputD:   [emptyBaggingRow()],

    // Session tracking
    sessionId:           null,
    submittedAt:         null,
    submittedBy:         null,

    // Sign-off — supervisor signature only (no operator tap-to-confirm)
    supervisorConfirmed: false,
    supervisorSignature: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYPAD TARGET — which field is currently open in a keypad BottomSheet
// ─────────────────────────────────────────────────────────────────────────────

type KpTarget =
  | { kind: 'debag-kg';     idx: number }
  | { kind: 'debag-serial'; idx: number }
  | { kind: 'debag-lot';    idx: number }
  | { kind: 'bag-serial';   group: OutputGroup; idx: number }
  | { kind: 'bag-kg';       group: OutputGroup; idx: number }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function RefiningPage() {
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const { user }      = useAuth()
  const db            = getDb()
  const toast         = useToast()

  const lineParam = (searchParams.get('line') ?? 'ref1') as 'ref1' | 'ref2'
  const lineName  = lineParam === 'ref1' ? 'Refining 1' : 'Refining 2'

  // ── State ──────────────────────────────────────────────────────────────────
  const [form,        setForm]        = useState<RefiningFormState>(() => initialState(lineParam))
  const [kpTarget,    setKpTarget]    = useState<KpTarget | null>(null)
  const [showBatch,   setShowBatch]   = useState<{ idx: number } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)

  // ── Load draft on mount ────────────────────────────────────────────────────
  // If a draft already exists for today / this line / this shift, restore it
  // so the operator doesn't start from scratch.
  useEffect(() => { loadDraft() }, [lineParam])

  async function loadDraft() {
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: session } = await db
      .from('prod_sessions')
      .select('id, operator_names, supervisor_name, status, submitted_at, submitted_by')
      .eq('section_id', lineParam)
      .eq('date', today)
      .eq('shift', form.shift)
      .maybeSingle()

    if (!session) return
    const s = session as any

    // Already submitted — show the submitted screen immediately
    if (s.status === 'submitted' || s.status === 'approved') {
      setSubmitted(true)
      setForm(f => ({ ...f, sessionId: s.id, submittedAt: s.submitted_at, submittedBy: s.submitted_by }))
      return
    }

    // Restore header fields
    const ops: string[] = s.operator_names ?? []
    setForm(f => ({
      ...f,
      sessionId:  s.id,
      operator1:  ops[0] ?? '',
      operator2:  ops[1] ?? '',
      supervisor: s.supervisor_name ?? '',
    }))

    // Restore bag rows
    const { data: debagData } = await db
      .from('prod_debagging')
      .select('*')
      .eq('session_id', s.id)
      .order('sequence_no')

    const { data: bagData } = await db
      .from('prod_bagging')
      .select('*')
      .eq('session_id', s.id)
      .order('sequence_no')

    const debagRows = ((debagData ?? []) as any[]).map(r => ({
      id:           crypto.randomUUID(),
      bagSerialNo:  r.bag_serial_no  ?? '',
      lotNumber:    r.lot_number     ?? '',
      productType:  r.product_type   ?? '',
      variant:      r.variant        ?? '',
      kgNett:       r.kg_nett != null ? String(r.kg_nett) : '',
      deliveryDate: r.delivery_date  ?? '',
      notes:        r.notes          ?? '',
    }))

    // Map bagging rows back into the correct output group (B / C / D)
    const mapGroup = (group: string) =>
      ((bagData ?? []) as any[])
        .filter(r => r.output_group === group)
        .map(r => ({
          id:          crypto.randomUUID(),
          bagSerialNo: r.bag_serial_no ?? '',
          lotNumber:   r.lot_number    ?? '',
          productType: r.product_type  ?? '',
          inventoryId: r.inventory_id  ?? '',
          variant:     r.variant       ?? '',
          kg:          r.kg != null ? String(r.kg) : '',
          baggingTime: r.bagging_time  ?? '',
        }))

    setForm(f => ({
      ...f,
      debagging: debagRows.length          ? debagRows      : f.debagging,
      outputB:   mapGroup('B').length      ? mapGroup('B')  : f.outputB,
      outputC:   mapGroup('C').length      ? mapGroup('C')  : f.outputC,
      outputD:   mapGroup('D').length      ? mapGroup('D')  : f.outputD,
    }))
  }

  // ── Row mutation helpers ───────────────────────────────────────────────────

  function setDebag(idx: number, field: keyof DebaggingRow, value: string) {
    setForm(f => {
      const rows = [...f.debagging]
      rows[idx] = { ...rows[idx], [field]: value }
      return { ...f, debagging: rows }
    })
  }

  function addDebagRow() {
    setForm(f => ({ ...f, debagging: [...f.debagging, emptyDebaggingRow()] }))
  }

  function removeDebagRow(idx: number) {
    setForm(f => {
      const rows = f.debagging.filter((_, i) => i !== idx)
      return { ...f, debagging: rows.length ? rows : [emptyDebaggingRow()] }
    })
  }

  function setBagging(group: OutputGroup, idx: number, field: keyof BaggingRow, value: string) {
    const key = `output${group}` as 'outputB' | 'outputC' | 'outputD'
    setForm(f => {
      const rows = [...f[key]]
      rows[idx] = { ...rows[idx], [field]: value }
      return { ...f, [key]: rows }
    })
  }

  function addBagRow(group: OutputGroup) {
    const key = `output${group}` as 'outputB' | 'outputC' | 'outputD'
    setForm(f => ({ ...f, [key]: [...f[key], emptyBaggingRow()] }))
  }

  function removeBagRow(group: OutputGroup, idx: number) {
    const key = `output${group}` as 'outputB' | 'outputC' | 'outputD'
    setForm(f => {
      const rows = f[key].filter((_, i) => i !== idx)
      return { ...f, [key]: rows.length ? rows : [emptyBaggingRow()] }
    })
  }

  // ── Keypad confirm ─────────────────────────────────────────────────────────
  // Called when operator confirms a value in a NumKeypad or BatchKeypad sheet.

  function confirmKp(val: string) {
    if (!kpTarget) return
    switch (kpTarget.kind) {
      case 'debag-kg':     setDebag(kpTarget.idx, 'kgNett', val);      break
      case 'debag-serial': setDebag(kpTarget.idx, 'bagSerialNo', val); break
      case 'debag-lot':    setDebag(kpTarget.idx, 'lotNumber', val);   break
      case 'bag-serial':   setBagging(kpTarget.group, kpTarget.idx, 'bagSerialNo', val); break
      case 'bag-kg':       setBagging(kpTarget.group, kpTarget.idx, 'kg', val);          break
    }
    setKpTarget(null)
  }

  // ── Mass balance (live) ────────────────────────────────────────────────────
  const mb = calcMassBalance(form.debagging, form.outputB, form.outputC, form.outputD)

  // ── Save draft ─────────────────────────────────────────────────────────────
  // Returns the session ID so handleSubmit can use it directly without a
  // state-read race condition.

  async function saveDraft(): Promise<string | null> {
    setSaving(true)
    setSaveError(null)
    try {
      // Upsert the session header row
      const sessionData = {
        section_id:      form.line,
        section_name:    lineName,
        date:            form.date,
        shift:           form.shift,
        operator_names:  [form.operator1, form.operator2].filter(Boolean),
        supervisor_name: form.supervisor || null,
        status:          'draft',
        updated_at:      new Date().toISOString(),
      }

      let sessionId = form.sessionId

      if (!sessionId) {
        // Check for an existing session for this line/date/shift before inserting
        const { data: existing } = await db
          .from('prod_sessions')
          .select('id')
          .eq('section_id', form.line)
          .eq('date', form.date)
          .eq('shift', form.shift)
          .maybeSingle()

        if (existing) {
          sessionId = (existing as any).id
          await db.from('prod_sessions').update(sessionData).eq('id', sessionId)
        } else {
          const { data: created, error: cErr } = await db
            .from('prod_sessions')
            .insert(sessionData)
            .select('id')
            .single()
          if (cErr) throw new Error(cErr.message)
          sessionId = (created as any).id
        }
        setForm(f => ({ ...f, sessionId }))
      } else {
        await db.from('prod_sessions').update(sessionData).eq('id', sessionId)
      }

      // Debagging rows — delete all, re-insert (simple replace strategy)
      await db.from('prod_debagging').delete().eq('session_id', sessionId)
      const debagRows = form.debagging
        .filter(r => r.kgNett || r.bagSerialNo)
        .map((r, i) => ({
          session_id:    sessionId,
          sequence_no:   i + 1,
          bag_serial_no: r.bagSerialNo  || null,
          lot_number:    r.lotNumber    || null,
          product_type:  r.productType  || null,
          variant:       r.variant      || null,
          kg_nett:       parseFloat(r.kgNett) || 0,
          delivery_date: r.deliveryDate || null,
          notes:         r.notes        || null,
        }))
      if (debagRows.length) await db.from('prod_debagging').insert(debagRows)

      // Bagging rows — delete all groups, re-insert
      await db.from('prod_bagging').delete().eq('session_id', sessionId)
      const bagRows: any[] = []

      const pushGroup = (rows: BaggingRow[], group: string) => {
        rows.filter(r => r.kg || r.bagSerialNo).forEach((r, i) => {
          bagRows.push({
            session_id:    sessionId,
            output_group:  group,
            sequence_no:   i + 1,
            bag_serial_no: r.bagSerialNo || null,
            lot_number:    r.lotNumber   || null,
            product_type:  r.productType || 'Unknown',
            inventory_id:  r.inventoryId || null,
            variant:       r.variant     || null,
            kg:            parseFloat(r.kg) || 0,
            bagging_time:  r.baggingTime || null,
          })
        })
      }
      pushGroup(form.outputB, 'B')
      pushGroup(form.outputC, 'C')
      pushGroup(form.outputD, 'D')
      if (bagRows.length) await db.from('prod_bagging').insert(bagRows)

      // Mass balance snapshot
      await db.from('prod_mass_balance').upsert({
        session_id:        sessionId,
        total_input_kg:    mb.totalInput,
        total_output_b_kg: mb.totalOutputB,
        total_output_c_kg: mb.totalOutputC,
        total_output_d_kg: mb.totalOutputD,
        balance_kg:        mb.balance,
        yield_pct:         mb.totalInput > 0
          ? parseFloat(((mb.totalInput - mb.balance) / mb.totalInput * 100).toFixed(2))
          : null,
        within_tolerance:  mb.withinTolerance,
        calculated_at:     new Date().toISOString(),
      }, { onConflict: 'session_id' })

      return sessionId
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed')
      return null
    } finally {
      setSaving(false)
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  // Saves the draft first, then marks the session as submitted.

  async function handleSubmit() {
    if (!form.supervisorConfirmed) return
    const sessionId = await saveDraft()
    if (!sessionId) return

    const { error } = await db
      .from('prod_sessions')
      .update({
        status:       'submitted',
        submitted_at: new Date().toISOString(),
        submitted_by: user?.id ?? null,
      })
      .eq('id', sessionId)

    if (error) { setSaveError(error.message); return }
    setForm(f => ({ ...f, submittedAt: new Date().toISOString(), submittedBy: user?.id ?? null }))
    setSubmitted(true)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUBMITTED SCREEN
  // ─────────────────────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-full bg-brand flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mb-6">
          <CheckCircle2 size={32} className="text-accent-light" />
        </div>
        <h2 className="font-display font-bold text-3xl text-white mb-2">Session submitted</h2>
        <p className="text-white/50 text-sm mb-8">
          {lineName} · {form.shift} shift · {format(new Date(form.date + 'T12:00:00'), 'd MMMM yyyy')}
        </p>

        {/* Summary stats */}
        <div className="flex gap-10 mb-10">
          <div>
            <div className="font-display font-bold text-4xl text-white">
              {form.debagging.filter(r => r.kgNett).length}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[1px] text-white/40 mt-1">Input bags</div>
          </div>
          <div>
            <div className="font-display font-bold text-4xl text-white">
              {Math.round(mb.totalInput).toLocaleString()}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[1px] text-white/40 mt-1">kg input</div>
          </div>
          <div>
            <div className={clsx('font-display font-bold text-4xl', mb.withinTolerance ? 'text-accent-light' : 'text-yellow-300')}>
              {mb.balance >= 0 ? '+' : ''}{Math.round(mb.balance)}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[1px] text-white/40 mt-1">kg balance</div>
          </div>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => router.push('/production')}
            className="w-full py-3 bg-accent rounded-xl font-semibold text-base text-white hover:opacity-90 transition-opacity"
          >
            Back to production
          </button>
          <button
            onClick={() => { setForm(initialState(lineParam)); setSubmitted(false) }}
            className="w-full py-3 bg-white/10 border border-white/15 rounded-xl font-semibold text-base text-white hover:bg-white/15 flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} /> New session
          </button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN FORM
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-32">

      {/* ── HEADER ── */}
      <div className="card p-4 space-y-4">

        {/* Line selector + title */}
        <div className="flex items-center gap-2">
          <div className={clsx('w-2 h-8 rounded-full flex-shrink-0', lineParam === 'ref1' ? 'bg-blue-700' : 'bg-indigo-700')} />
          <h1 className="font-display font-bold text-xl text-text">{lineName}</h1>
          <div className="ml-auto flex gap-2">
            {(['ref1', 'ref2'] as const).map(l => (
              <button
                key={l}
                onClick={() => setForm(f => ({ ...f, line: l }))}
                className={clsx(
                  'px-3 py-1.5 rounded-lg font-semibold text-[13px] transition-colors',
                  form.line === l
                    ? l === 'ref1' ? 'bg-blue-700 text-white' : 'bg-indigo-700 text-white'
                    : 'bg-surface text-text-muted border border-surface-rule hover:border-text-muted'
                )}
              >
                {l === 'ref1' ? 'R1' : 'R2'}
              </button>
            ))}
          </div>
        </div>

        {/* Date + Shift */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Shift</label>
            <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as Shift }))} className="input">
              {SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Operator names */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Operator 1</label>
            <input type="text" value={form.operator1} onChange={e => setForm(f => ({ ...f, operator1: e.target.value }))} placeholder="Name" className="input" />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Operator 2</label>
            <input type="text" value={form.operator2} onChange={e => setForm(f => ({ ...f, operator2: e.target.value }))} placeholder="Name (optional)" className="input" />
          </div>
        </div>

        {/* Supervisor */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Supervisor</label>
          <input type="text" value={form.supervisor} onChange={e => setForm(f => ({ ...f, supervisor: e.target.value }))} placeholder="Supervisor name" className="input" />
        </div>
      </div>

      {/* ── SECTION A — INPUT BAGS ── */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <div>
            <span className="card-title">Section A — Input bags</span>
            <p className="text-xs text-text-muted mt-0.5">Record each bag opened (debagged) this shift</p>
          </div>
          {/* Running total */}
          <div className="text-right flex-shrink-0">
            <div className="font-display font-bold text-2xl text-text">{mb.totalInput.toFixed(1)}</div>
            <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted">Total A (kg)</div>
          </div>
        </div>

        <div className="divide-y divide-surface-rule">
          {form.debagging.map((row, i) => (
            <InputBagRow
              key={row.id}
              row={row}
              index={i}
              total={form.debagging.length}
              onChange={(field, val) => setDebag(i, field, val)}
              onOpenKg={()     => setKpTarget({ kind: 'debag-kg',     idx: i })}
              onOpenSerial={()  => setShowBatch({ idx: i })}
              onOpenLot={()    => setKpTarget({ kind: 'debag-lot',    idx: i })}
              onRemove={()     => removeDebagRow(i)}
            />
          ))}
        </div>

        <div className="p-3">
          <button
            onClick={addDebagRow}
            className="w-full py-2.5 border-2 border-dashed border-surface-rule rounded-xl font-semibold text-sm text-accent hover:bg-ok-bg hover:border-accent/40 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus size={15} /> Add input bag
          </button>
        </div>
      </div>

      {/* ── SECTIONS B / C / D — OUTPUT GROUPS ── */}
      {(['B', 'C', 'D'] as OutputGroup[]).map(group => {
        const key    = `output${group}` as 'outputB' | 'outputC' | 'outputD'
        const rows   = form[key]
        const total  = rows.reduce((s, r) => s + (parseFloat(r.kg) || 0), 0)

        const groupLabel: Record<OutputGroup, string> = {
          B: 'Section B — Output group 1',
          C: 'Section C — Output group 2',
          D: 'Section D — Output group 3',
        }
        const groupColor: Record<OutputGroup, string> = {
          B: 'text-blue-600',
          C: 'text-indigo-600',
          D: 'text-purple-600',
        }

        return (
          <div key={group} className="card overflow-hidden">
            <div className="card-head">
              <div>
                <span className="card-title">{groupLabel[group]}</span>
                <p className="text-xs text-text-muted mt-0.5">Independent output stream</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={clsx('font-display font-bold text-2xl', groupColor[group])}>{total.toFixed(1)}</div>
                <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted">kg</div>
              </div>
            </div>

            <div className="divide-y divide-surface-rule">
              {rows.map((row, i) => (
                <OutputBagRow
                  key={row.id}
                  row={row}
                  index={i}
                  total={rows.length}
                  group={group}
                  onChange={(field, val) => setBagging(group, i, field, val)}
                  onOpenSerial={() => setKpTarget({ kind: 'bag-serial', group, idx: i })}
                  onOpenKg={()     => setKpTarget({ kind: 'bag-kg',     group, idx: i })}
                  onRemove={()     => removeBagRow(group, i)}
                />
              ))}
            </div>

            <div className="p-3">
              <button
                onClick={() => addBagRow(group)}
                className="w-full py-2.5 border-2 border-dashed border-surface-rule rounded-xl font-semibold text-sm text-accent hover:bg-ok-bg hover:border-accent/40 transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus size={15} /> Add output bag
              </button>
            </div>
          </div>
        )
      })}

      {/* ── MASS BALANCE ── */}
      <MassBalanceCard mb={mb} />

      {/* ── SUPERVISOR SIGN-OFF ── */}
      <div className="card p-4 space-y-3">
        <div>
          <p className="font-semibold text-base text-text">Supervisor sign-off</p>
          <p className="text-xs text-text-muted mt-0.5">
            The supervisor on shift must sign to confirm this session is complete and accurate.
          </p>
        </div>
        <SignaturePad
          label="Supervisor"
          name={form.supervisor || 'Enter supervisor name in header above'}
          value={form.supervisorSignature}
          onChange={(sig: string | null) => setForm(f => ({
            ...f,
            supervisorSignature: sig,
            supervisorConfirmed: !!sig,
          }))}
          disabled={submitted}
        />
      </div>

      {/* ── SAVE ERROR ── */}
      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-err-bg border border-err/30 rounded-xl text-sm text-status-error">
          <AlertTriangle size={16} /> {saveError}
        </div>
      )}

      {/* ── FIXED BOTTOM ACTION BAR ── */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface-card border-t border-surface-rule z-20">
        <div className="max-w-3xl mx-auto flex gap-3">
          {/* Save draft */}
          <button
            onClick={() => saveDraft().then(id => id && toast('Draft saved', 'success'))}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-3 border border-surface-rule rounded-xl font-semibold text-sm text-text-muted hover:bg-surface transition-colors"
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save draft'}
          </button>

          {/* Submit — only enabled once supervisor has signed */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!form.supervisorConfirmed || saving}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-base transition-all',
              form.supervisorConfirmed
                ? 'bg-brand text-white hover:opacity-90'
                : 'bg-surface-rule text-text-faint cursor-not-allowed'
            )}
          >
            <Send size={16} />
            {form.supervisorConfirmed ? 'Submit session' : 'Supervisor signature required'}
          </button>
        </div>
      </div>

      {/* ── KEYPADS ── */}

      {/* Weight keypad — debagging kg or output bag kg */}
      <BottomSheet
        open={!!kpTarget && (kpTarget.kind === 'debag-kg' || kpTarget.kind === 'bag-kg')}
        onClose={() => setKpTarget(null)}
      >
        <NumKeypad
          label="Weight (kg)"
          context=""
          initial={
            kpTarget?.kind === 'debag-kg'
              ? form.debagging[kpTarget.idx]?.kgNett ?? ''
              : kpTarget?.kind === 'bag-kg'
              ? (form[`output${kpTarget.group}` as 'outputB'][kpTarget.idx]?.kg ?? '')
              : ''
          }
          onCancel={() => setKpTarget(null)}
          onConfirm={confirmKp}
        />
      </BottomSheet>

      {/* Batch/serial keypad — lot numbers and output bag serials */}
      <BottomSheet
        open={!!kpTarget && (kpTarget.kind === 'debag-lot' || kpTarget.kind === 'bag-serial')}
        onClose={() => setKpTarget(null)}
      >
        <BatchKeypad
          label={kpTarget?.kind === 'debag-lot' ? 'Lot / Batch number' : 'Bag serial number'}
          context=""
          initial={
            kpTarget?.kind === 'debag-lot'
              ? form.debagging[kpTarget.idx]?.lotNumber ?? ''
              : kpTarget?.kind === 'bag-serial'
              ? (form[`output${kpTarget.group}` as 'outputB'][kpTarget.idx]?.bagSerialNo ?? '')
              : ''
          }
          onCancel={() => setKpTarget(null)}
          onConfirm={confirmKp}
        />
      </BottomSheet>

      {/* Batch select modal — Task 4: shows recent prod_bagging outputs as
          quick-fill options when operator taps the serial field on a debag row */}
      <BatchSelectModal
        open={!!showBatch}
        sectionId={form.line}
        onSelect={batch => {
          if (!showBatch) return
          setDebag(showBatch.idx, 'lotNumber',   batch.lot_number)
          setDebag(showBatch.idx, 'bagSerialNo', batch.bag_serial_no)
          setDebag(showBatch.idx, 'productType', batch.product_type)
          setDebag(showBatch.idx, 'variant',     batch.variant as any)
          setShowBatch(null)
        }}
        onManual={() => {
          if (!showBatch) return
          setShowBatch(null)
          setKpTarget({ kind: 'debag-serial', idx: showBatch.idx })
        }}
        onClose={() => setShowBatch(null)}
      />

      {/* Submit confirmation sheet */}
      <ConfirmSheet
        open={showConfirm}
        title="Submit this session?"
        message={`${lineName} · ${form.shift} shift · ${format(new Date(form.date + 'T12:00:00'), 'd MMMM yyyy')}. Once submitted the record is locked.`}
        confirmLabel="Yes, submit"
        onConfirm={() => { setShowConfirm(false); handleSubmit() }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DESKTOP DETECTION
// Native inputs on laptop, custom keypad BottomSheet on tablet/mobile.
// ─────────────────────────────────────────────────────────────────────────────

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    setIsDesktop(mq.matches)
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return isDesktop
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT BAG ROW
// Each row represents one bag that was opened (debagged) during the shift.
// ─────────────────────────────────────────────────────────────────────────────

function InputBagRow({
  row, index, total, onChange, onOpenKg, onOpenSerial, onOpenLot, onRemove,
}: {
  row:         DebaggingRow
  index:       number
  total:       number
  onChange:    (field: keyof DebaggingRow, val: string) => void
  onOpenKg:    () => void
  onOpenSerial:() => void
  onOpenLot:   () => void
  onRemove:    () => void
}) {
  const isDesktop = useIsDesktop()
  const hasKg = parseFloat(row.kgNett) > 0

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Input bag {index + 1}</span>
        {total > 1 && <button onClick={onRemove}><Trash2 size={13} className="text-text-faint hover:text-status-error transition-colors" /></button>}
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Bag serial no.</div>
        {isDesktop
          ? <input type="text" value={row.bagSerialNo} onChange={e => onChange('bagSerialNo', e.target.value)} placeholder="Enter bag serial number" className="input font-mono text-[13px]" />
          : <button onClick={onOpenSerial} className={clsx('w-full px-3 py-2.5 text-left rounded-xl border-2 font-mono text-[13px] font-bold transition-colors', row.bagSerialNo ? 'border-accent/40 bg-ok-bg/50 text-text' : 'border-surface-rule bg-surface-card text-text-faint')}>
              {row.bagSerialNo || 'Tap to select or enter serial'}
            </button>
        }
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Lot / Batch no.</div>
          {isDesktop
            ? <input type="text" value={row.lotNumber} onChange={e => onChange('lotNumber', e.target.value)} placeholder="Lot number" className="input font-mono text-[13px]" />
            : <button onClick={onOpenLot} className={clsx('w-full px-3 py-2.5 text-left rounded-xl border-2 font-mono text-[13px] font-bold transition-colors', row.lotNumber ? 'border-accent/40 bg-ok-bg/50 text-text' : 'border-surface-rule bg-surface-card text-text-faint')}>
                {row.lotNumber || '—'}
              </button>
          }
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Variant</div>
          <select value={row.variant} onChange={e => onChange('variant', e.target.value)} className="input text-[13px]">
            <option value="">Select…</option>
            {VARIANT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Product type</div>
        <input type="text" value={row.productType} onChange={e => onChange('productType', e.target.value)} placeholder="e.g. Sticks, Dust: Brown" className="input text-[13px]" />
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Net weight (kg)</div>
        {isDesktop
          ? <input type="number" value={row.kgNett} onChange={e => onChange('kgNett', e.target.value)} placeholder="0.0" step="0.1" className="input font-mono text-[18px]" />
          : <button onClick={onOpenKg} className={clsx('w-full px-3 py-3 text-left rounded-xl border-2 font-mono text-[18px] font-bold transition-colors', hasKg ? 'border-accent/40 bg-ok-bg/50 text-text' : 'border-surface-rule bg-surface-card text-text-faint')}>
              {hasKg ? `${row.kgNett} kg` : 'Tap to enter weight'}
            </button>
        }
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT BAG ROW
// Each row represents one bag filled during the shift for a given output group.
// ─────────────────────────────────────────────────────────────────────────────

function OutputBagRow({
  row, index, total, group, onChange, onOpenSerial, onOpenKg, onRemove,
}: {
  row:          BaggingRow
  index:        number
  total:        number
  group:        OutputGroup
  onChange:     (field: keyof BaggingRow, val: string) => void
  onOpenSerial: () => void
  onOpenKg:     () => void
  onRemove:     () => void
}) {
  const isDesktop = useIsDesktop()
  const hasKg = parseFloat(row.kg) > 0

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Bag {index + 1}</span>
        {total > 1 && <button onClick={onRemove}><Trash2 size={13} className="text-text-faint hover:text-status-error transition-colors" /></button>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Product type</div>
          <input type="text" value={row.productType} onChange={e => onChange('productType', e.target.value)} placeholder="Product…" className="input text-[13px]" />
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Variant</div>
          <select value={row.variant} onChange={e => onChange('variant', e.target.value)} className="input text-[13px]">
            <option value="">Select…</option>
            {VARIANT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Bag serial no.</div>
        {isDesktop
          ? <input type="text" value={row.bagSerialNo} onChange={e => onChange('bagSerialNo', e.target.value)} placeholder="Enter bag serial number" className="input font-mono text-[13px]" />
          : <button onClick={onOpenSerial} className={clsx('w-full px-3 py-2.5 text-left rounded-xl border-2 font-mono text-[13px] font-bold transition-colors', row.bagSerialNo ? 'border-accent/40 bg-ok-bg/50 text-text' : 'border-surface-rule bg-surface-card text-text-faint')}>
              {row.bagSerialNo || 'Tap to enter serial number'}
            </button>
        }
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-muted mb-1 uppercase tracking-wide">Weight (kg)</div>
        {isDesktop
          ? <input type="number" value={row.kg} onChange={e => onChange('kg', e.target.value)} placeholder="0.0" step="0.1" className="input font-mono text-[18px]" />
          : <button onClick={onOpenKg} className={clsx('w-full px-3 py-3 text-left rounded-xl border-2 font-mono text-[18px] font-bold transition-colors', hasKg ? 'border-accent/40 bg-ok-bg/50 text-text' : 'border-surface-rule bg-surface-card text-text-faint')}>
              {hasKg ? `${row.kg} kg` : 'Tap to enter weight'}
            </button>
        }
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MASS BALANCE CARD
// Shows A − B − C − D = E with a tolerance warning if |E| > 15 kg.
// ─────────────────────────────────────────────────────────────────────────────

function MassBalanceCard({ mb }: { mb: ReturnType<typeof calcMassBalance> }) {
  const outOfTol = !mb.withinTolerance && mb.totalInput > 0

  return (
    <div className={clsx('card p-4', outOfTol ? 'border-warn/50 bg-warn-bg/30' : '')}>
      <div className="flex items-center gap-2 mb-4">
        <Layers size={18} className={outOfTol ? 'text-status-warn' : 'text-text-muted'} />
        <span className="font-semibold text-base text-text">Mass balance</span>
        {outOfTol && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-status-warn font-semibold">
            <AlertTriangle size={13} /> Balance &gt; {mb.toleranceKg} kg — review before submitting
          </span>
        )}
        {!outOfTol && mb.totalInput > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-status-ok font-semibold">
            <CheckCircle2 size={13} /> Within tolerance
          </span>
        )}
      </div>

      {/* Formula display: A − B − C − D = E */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {[
          { label: 'A (input)',   value: mb.totalInput,   color: 'text-text' },
          { label: '−',          value: null,             color: 'text-text-muted', isOp: true },
          { label: 'B',          value: mb.totalOutputB,  color: 'text-blue-600' },
          { label: '−',          value: null,             color: 'text-text-muted', isOp: true },
          { label: 'C',          value: mb.totalOutputC,  color: 'text-indigo-600' },
          { label: '−',          value: null,             color: 'text-text-muted', isOp: true },
          { label: 'D',          value: mb.totalOutputD,  color: 'text-purple-600' },
          { label: '=',          value: null,             color: 'text-text-muted', isOp: true },
          { label: 'E (balance)', value: mb.balance,      color: outOfTol ? 'text-status-warn' : 'text-status-ok' },
        ].map((item, i) => {
          if (item.isOp) return (
            <span key={i} className={clsx('font-display font-bold text-2xl', item.color)}>{item.label}</span>
          )
          return (
            <div key={i} className="text-center">
              <div className={clsx('font-display font-bold text-2xl', item.color)}>
                {item.value != null ? (item.value as number).toFixed(1) : '—'}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-wide text-text-muted mt-0.5 whitespace-nowrap">
                {item.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Yield percentage */}
      {mb.totalInput > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-rule flex justify-between text-xs text-text-muted">
          <span>Yield</span>
          <span className="font-mono font-bold text-text">
            {((mb.totalInput - mb.balance) / mb.totalInput * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WRAPPER — Next.js requires useSearchParams inside a Suspense boundary
// ─────────────────────────────────────────────────────────────────────────────

export default function RefiningPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center bg-surface">
        <div className="font-mono text-[11px] tracking-[2px] uppercase text-text-muted animate-pulse">
          Loading…
        </div>
      </div>
    }>
      <RefiningPage />
    </Suspense>
  )
}