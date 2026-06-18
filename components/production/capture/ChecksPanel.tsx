'use client'

import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2, AlertTriangle, Lock, Loader2, ShieldCheck, Camera, Plus, Wrench, Clock, Sparkles,
} from 'lucide-react'
import {
  visibleChecks, PHASE_LABEL, SECTION_TO_AREA, type MachineCheckDef, type CheckPhase,
} from '@/lib/production/checks-config'
import { loadCheckSpecs, outOfRange, scaleOutOfTolerance, loadQualitySieveHint, type CheckSpec } from '@/lib/production/check-specs'
import { ensureCheckRecord, appendCheckEvent, loadCheckRecord } from '@/lib/production/checks-db'
import { getDb } from '@/lib/supabase/db'

const INP = 'w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-stone-200 bg-white text-[15px] text-text outline-none focus:border-brand'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'
const PHASES: CheckPhase[] = ['startup', 'running', 'shutdown']

interface MassBalance { totalIn: number; totalOut: number; variance: number; withinTol: boolean }
interface VsdReading { id: string; value: number; at: string; oor: boolean }

export function ChecksPanel({
  sectionId, date, shift, sessionId, locked, operator, variant, grade, massBalance,
}: {
  sectionId: string; date: string; shift: string; sessionId: string | null; locked: boolean
  operator: { id: string; name: string; pin: string } | null
  variant: string; grade: string; massBalance: MassBalance
}) {
  const checks = visibleChecks(sectionId, shift)
  const [specs, setSpecs] = useState<Record<string, CheckSpec>>({})
  const [qmsHint, setQmsHint] = useState<string | null>(null)

  // Held-in-state results (written to the audit trail on sign).
  const [confirms, setConfirms] = useState<Record<string, { flagged: boolean; reason: string }>>({})
  const [numbers, setNumbers]   = useState<Record<string, string>>({})
  const [texts, setTexts]       = useState<Record<string, string>>({})
  const [scaleStd, setScaleStd] = useState('')
  const [scaleAct, setScaleAct] = useState('')

  // Live, timestamped events.
  const [vsd, setVsd] = useState<VsdReading[]>([])
  const [raised, setRaised] = useState<Record<string, number>>({})   // check_key → maintenance card id

  const [recordId, setRecordId] = useState<string | null>(null)
  const [signedStatus, setSignedStatus] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string>('')
  const [pin, setPin] = useState('')
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [raiseFor, setRaiseFor] = useState<MachineCheckDef | null>(null)

  const recordIdRef = useRef<string | null>(null)
  recordIdRef.current = recordId

  useEffect(() => {
    loadCheckSpecs(sectionId).then(setSpecs)
    loadQualitySieveHint(variant).then(setQmsHint)
    loadCheckRecord(sectionId, date, shift).then(({ record, events }) => {
      if (record) {
        setRecordId(record.id)
        setSignedStatus(record.status)
        setAiSummary(record.ai_summary ?? '')
        setVsd(events.filter((e: any) => e.check_key === 'infeed_vsd' && e.value_num != null)
          .map((e: any) => ({ id: e.id, value: Number(e.value_num), at: e.recorded_at, oor: e.status !== 'ok' })))
        const r: Record<string, number> = {}
        events.forEach((e: any) => { if (e.maintenance_card_id) r[e.check_key] = e.maintenance_card_id })
        setRaised(r)
      }
      setLoading(false)
    })
  }, [sectionId, date, shift, variant])

  const signed = signedStatus === 'operator_signed' || signedStatus === 'supervisor_verified'
  const readOnly = locked || signed

  async function getRecord(): Promise<string | null> {
    if (recordIdRef.current) return recordIdRef.current
    const id = await ensureCheckRecord(sectionId, date, shift, sessionId)
    setRecordId(id)
    return id
  }

  // ── Live: hourly VSD reading ───────────────────────────────────────────────
  async function logVsd(value: number, source: 'keypad' | 'photo') {
    const spec = specs['infeed_vsd']
    const oor = outOfRange(value, spec)
    const id = await getRecord()
    if (!id) return
    const at = new Date().toISOString()
    await appendCheckEvent(id, {
      phase: 'running', check_key: 'infeed_vsd', check_label: 'Infeed speed (VSD)', kind: 'number',
      value_num: value, unit: spec?.unit ?? 'Hz', status: oor ? 'flagged' : 'ok',
      spec_min: spec?.min ?? null, spec_max: spec?.max ?? null, source, recorded_at: at,
      actor_id: operator?.id ?? null, actor_name: operator?.name ?? null,
    })
    setVsd(v => [...v, { id: at, value, at, oor }])
  }

  // ── Live: confirm a mass-balance snapshot at shut-down ─────────────────────
  async function confirmMassBalance() {
    const id = await getRecord()
    if (!id) return
    await appendCheckEvent(id, {
      phase: 'shutdown', check_key: 'mass_balance', check_label: 'Mass balance', kind: 'massbalance',
      value_num: massBalance.variance, value_text: `${massBalance.totalIn.toFixed(1)} in / ${massBalance.totalOut.toFixed(1)} out`,
      unit: 'kg', status: massBalance.withinTol ? 'ok' : 'flagged', source: 'keypad',
      actor_id: operator?.id ?? null, actor_name: operator?.name ?? null,
    })
    setMbConfirmed(true)
  }
  const [mbConfirmed, setMbConfirmed] = useState(false)

  // ── Failing-check detection ────────────────────────────────────────────────
  function isFailing(def: MachineCheckDef): boolean {
    if (!def.failRaisesMaintenance) return false
    if (def.kind === 'confirm') return confirms[def.key]?.flagged ?? false
    if (def.kind === 'scale') {
      const s = parseFloat(scaleStd), a = parseFloat(scaleAct)
      return s > 0 && a > 0 && scaleOutOfTolerance(s, a, specs[def.key])
    }
    if (def.kind === 'number') {
      const v = parseFloat(numbers[def.key])
      return v > 0 && outOfRange(v, specs[def.key])
    }
    return false
  }

  // ── Raise a maintenance job from a failed check ────────────────────────────
  async function raiseMaintenance(def: MachineCheckDef, workflow: 'breakdown' | 'planned') {
    const reason = def.kind === 'scale'
      ? `Scale verification out of tolerance — standard ${scaleStd}kg, actual ${scaleAct}kg`
      : def.kind === 'confirm'
        ? `${def.label} flagged: ${confirms[def.key]?.reason || 'not OK'}`
        : `${def.label} out of range: ${numbers[def.key]}${def.unit ? ' ' + def.unit : ''}`
    const res = await fetch('/api/maintenance/job-cards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow, area: SECTION_TO_AREA[sectionId] ?? 'Sieving Tower', machine: def.equipment ?? null,
        description: `${def.label} — ${SECTION_TO_AREA[sectionId] ?? sectionId}`, long_desc: reason,
        raised_by: operator?.name ?? 'Production', maint_types: workflow === 'planned' ? ['Repair'] : undefined,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? 'Could not raise maintenance job'); setRaiseFor(null); return }
    const cardId = json.card?.id ?? null
    const id = await getRecord()
    if (id) await appendCheckEvent(id, {
      phase: def.phase, check_key: def.key, check_label: def.label, kind: def.kind,
      status: 'fail', reason, source: 'keypad', maintenance_card_id: cardId,
      actor_id: operator?.id ?? null, actor_name: operator?.name ?? null,
    })
    if (cardId) setRaised(r => ({ ...r, [def.key]: cardId }))
    setRaiseFor(null)
  }

  // ── Sign-off: write held checks, finalise record, generate AI summary ──────
  async function sign() {
    setError(null)
    if (!operator)            { setError('No operator identified for sign-off'); return }
    if (pin !== operator.pin) { setError('PIN does not match — re-enter to sign'); return }
    const missingReason = checks.some(c => c.kind === 'confirm' && confirms[c.key]?.flagged && !confirms[c.key].reason.trim())
    if (missingReason)        { setError('Add a reason for each flagged check'); return }
    setSigning(true)
    try {
      const id = await getRecord()
      if (!id) throw new Error('Could not create checks record')
      const now = new Date().toISOString()
      const actor = { actor_id: operator.id, actor_name: operator.name }

      for (const c of checks) {
        if (raised[c.key]) continue   // already written live with its maintenance link
        if (c.kind === 'confirm') {
          const ex = confirms[c.key]
          await appendCheckEvent(id, { phase: c.phase, check_key: c.key, check_label: c.label, kind: 'confirm',
            status: ex?.flagged ? 'flagged' : 'ok', reason: ex?.reason ?? null, source: 'sign', ...actor })
        } else if (c.kind === 'number') {
          const v = parseFloat(numbers[c.key])
          if (!isFinite(v)) continue
          const spec = specs[c.key]
          await appendCheckEvent(id, { phase: c.phase, check_key: c.key, check_label: c.label, kind: 'number',
            value_num: v, unit: c.unit ?? spec?.unit ?? null, status: outOfRange(v, spec) ? 'flagged' : 'ok',
            spec_min: spec?.min ?? null, spec_max: spec?.max ?? null, source: 'sign', ...actor })
        } else if (c.kind === 'scale') {
          const s = parseFloat(scaleStd), a = parseFloat(scaleAct)
          if (!isFinite(s) || !isFinite(a)) continue
          const fail = scaleOutOfTolerance(s, a, specs[c.key])
          await appendCheckEvent(id, { phase: c.phase, check_key: c.key, check_label: c.label, kind: 'scale',
            value_num: a, value_text: `std ${s} / actual ${a}`, unit: 'kg', status: fail ? 'fail' : 'ok', source: 'sign', ...actor })
        } else if (c.kind === 'text') {
          const t = (texts[c.key] ?? '').trim()
          if (!t) continue
          await appendCheckEvent(id, { phase: c.phase, check_key: c.key, check_label: c.label, kind: 'text',
            value_text: t, status: 'ok', source: 'sign', ...actor })
        }
      }
      // Mass-balance snapshot at sign-off (if afternoon/shutdown applies).
      if (checks.some(c => c.key === 'mass_balance') && !mbConfirmed) {
        await appendCheckEvent(id, { phase: 'shutdown', check_key: 'mass_balance', check_label: 'Mass balance', kind: 'massbalance',
          value_num: massBalance.variance, value_text: `${massBalance.totalIn.toFixed(1)} in / ${massBalance.totalOut.toFixed(1)} out`,
          unit: 'kg', status: massBalance.withinTol ? 'ok' : 'flagged', source: 'sign', ...actor })
      }

      await getDb().schema('production').from('check_records').update({
        status: 'operator_signed', operator_id: operator.id, operator_name: operator.name,
        operator_signed_at: now,
      } as any).eq('id', id)

      // AI shift summary (best-effort).
      try {
        const sres = await fetch('/api/production/check-summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: sectionId, shift, date, variant, grade,
            massBalance: { in: massBalance.totalIn, out: massBalance.totalOut, variance: massBalance.variance },
            vsd: vsd.map(r => r.value),
            checks: checks.map(c => ({ label: c.label, value: c.kind === 'confirm' ? (confirms[c.key]?.flagged ? 'flagged' : 'ok') : c.kind === 'scale' ? `${scaleStd}/${scaleAct}` : c.kind === 'text' ? texts[c.key] : numbers[c.key] })),
            exceptions: checks.filter(c => confirms[c.key]?.flagged).map(c => ({ check: c.label, reason: confirms[c.key]?.reason })),
            maintenanceRaised: Object.keys(raised),
          }),
        })
        const sj = await sres.json().catch(() => ({}))
        if (sj.summary) {
          setAiSummary(sj.summary)
          await getDb().schema('production').from('check_records').update({ ai_summary: sj.summary } as any).eq('id', id)
        }
      } catch { /* summary is best-effort */ }

      setSignedStatus('operator_signed')
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  const lastVsd = vsd.length ? vsd[vsd.length - 1] : null

  return (
    <div className="space-y-5">
      <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-[12px] text-stone-500 leading-relaxed">
        Machine checks for this shift. Confirm-style checks are <strong>assumed OK</strong> — only flag what isn't.
        Readings can be typed or <strong>scanned from the display</strong>. Your name and the time are recorded automatically.
      </div>

      {signed && aiSummary && (
        <div className="px-4 py-3 bg-ok/5 border border-ok/30 rounded-2xl">
          <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold text-ok uppercase tracking-wide"><Sparkles size={13} /> Shift summary</div>
          <p className="text-[13px] text-text leading-relaxed">{aiSummary}</p>
        </div>
      )}

      {PHASES.map(phase => {
        const phaseChecks = checks.filter(c => c.phase === phase)
        if (!phaseChecks.length) return null
        return (
          <div key={phase} className="space-y-3">
            <div className="text-[12px] font-semibold text-text uppercase tracking-wide">{PHASE_LABEL[phase]}</div>
            {phaseChecks.map(def => (
              <CheckCard
                key={def.key} def={def} spec={specs[def.key]} readOnly={readOnly}
                confirm={confirms[def.key]} onToggleConfirm={() => setConfirms(c => {
                  const cur = c[def.key]
                  if (cur?.flagged) { const { [def.key]: _, ...rest } = c; return rest }
                  return { ...c, [def.key]: { flagged: true, reason: '' } }
                })}
                onReason={(r: string) => setConfirms(c => ({ ...c, [def.key]: { flagged: true, reason: r } }))}
                numberValue={numbers[def.key] ?? ''} onNumber={(v: string) => setNumbers(n => ({ ...n, [def.key]: v }))}
                textValue={texts[def.key] ?? ''} onText={(v: string) => setTexts(t => ({ ...t, [def.key]: v }))}
                qmsHint={def.key === 'sieving_config' ? qmsHint : null}
                scaleStd={scaleStd} scaleAct={scaleAct} onScaleStd={setScaleStd} onScaleAct={setScaleAct}
                vsd={vsd} lastVsd={lastVsd} onLogVsd={logVsd}
                massBalance={massBalance} mbConfirmed={mbConfirmed} onConfirmMb={confirmMassBalance}
                failing={isFailing(def)} raisedCard={raised[def.key]} onRaise={() => setRaiseFor(def)}
              />
            ))}
          </div>
        )
      })}

      {/* Sign-off */}
      {signed ? (
        <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
          <Lock size={20} className="text-ok" />
          <span className="font-semibold text-[14px] text-ok">Checks signed off{signedStatus === 'supervisor_verified' ? ' & verified' : ''}.</span>
        </div>
      ) : !readOnly && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand shrink-0" />
            <input type="password" inputMode="numeric" maxLength={4} value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null) }}
              placeholder="Enter PIN to sign checks"
              className="flex-1 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-center font-mono tracking-[0.4em] text-[16px] outline-none focus:border-brand" />
            <button onClick={sign} disabled={signing || pin.length !== 4}
              className="px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 flex items-center gap-1.5">
              {signing ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Sign
            </button>
          </div>
          {error && <p className="text-[12px] text-err">{error}</p>}
        </div>
      )}

      {raiseFor && (
        <RaiseModal def={raiseFor} onClose={() => setRaiseFor(null)} onRaise={raiseMaintenance} />
      )}
    </div>
  )
}

// ── One check card ───────────────────────────────────────────────────────────
function CheckCard(props: any) {
  const {
    def, spec, readOnly, confirm, onToggleConfirm, onReason, numberValue, onNumber, textValue, onText,
    qmsHint, scaleStd, scaleAct, onScaleStd, onScaleAct, vsd, lastVsd, onLogVsd,
    massBalance, mbConfirmed, onConfirmMb, failing, raisedCard, onRaise,
  } = props
  const d = def as MachineCheckDef

  return (
    <div className={`bg-white border rounded-2xl p-4 space-y-3 ${failing ? 'border-err/40' : 'border-stone-200'}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[13px] text-text">{d.label}</span>
        {d.help && <span className="text-[10px] text-stone-400">{d.help}</span>}
      </div>

      {/* Confirm (exception-based) */}
      {d.kind === 'confirm' && (
        <>
          <button onClick={() => !readOnly && onToggleConfirm()} disabled={readOnly} className="flex items-center gap-2.5 text-left">
            {confirm?.flagged ? <AlertTriangle size={18} className="text-err" /> : <CheckCircle2 size={18} className="text-ok" />}
            <span className={`text-[13px] ${confirm?.flagged ? 'text-err' : 'text-text'}`}>{confirm?.flagged ? 'Flagged — not OK' : 'OK'}</span>
          </button>
          {confirm?.flagged && (
            <input autoFocus value={confirm.reason} disabled={readOnly} onChange={e => onReason(e.target.value)}
              placeholder="What's wrong?" className="w-full px-3 py-2 rounded-lg border border-err/30 bg-err/5 text-[12px] outline-none focus:border-err" />
          )}
        </>
      )}

      {/* Number (with photo-read) */}
      {d.kind === 'number' && (
        <ValueCapture label={d.label} unit={d.unit ?? spec?.unit ?? ''} value={numberValue} onChange={onNumber}
          disabled={readOnly} spec={spec} />
      )}

      {/* Text (+ optional QC hint) */}
      {d.kind === 'text' && (
        <>
          <input value={textValue} disabled={readOnly} onChange={e => onText(e.target.value)} placeholder="Type here" className={INP} />
          {qmsHint && <p className="text-[11px] text-text-muted flex items-center gap-1"><Sparkles size={11} className="text-ok" /> {qmsHint}</p>}
        </>
      )}

      {/* Scale verification */}
      {d.kind === 'scale' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><label className={LBL}>Standard (kg)</label>
            <input type="number" inputMode="decimal" value={scaleStd} disabled={readOnly} onChange={e => onScaleStd(e.target.value)} className={INP} /></div>
          <div className="space-y-1"><label className={LBL}>Actual (kg)</label>
            <input type="number" inputMode="decimal" value={scaleAct} disabled={readOnly} onChange={e => onScaleAct(e.target.value)} className={INP} /></div>
        </div>
      )}

      {/* Hourly VSD readings timeline */}
      {d.kind === 'number' && d.hourly && (
        <div className="space-y-2">
          {vsd.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {vsd.map((r: VsdReading) => (
                <span key={r.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono ${r.oor ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-600'}`}>
                  <Clock size={10} /> {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {r.value}{d.unit}
                </span>
              ))}
            </div>
          )}
          {!readOnly && (
            <button onClick={() => { const v = parseFloat(numberValue); if (isFinite(v)) { onLogVsd(v, 'keypad'); onNumber('') } }}
              disabled={!numberValue}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand/10 text-brand font-medium text-[13px] disabled:opacity-40">
              <Plus size={15} /> Log reading{lastVsd ? ` (last ${lastVsd.value}${d.unit} at ${new Date(lastVsd.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
            </button>
          )}
        </div>
      )}

      {/* Mass balance (auto) */}
      {d.kind === 'massbalance' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="font-mono font-bold text-[16px]">{massBalance.totalIn.toFixed(1)}</div><div className="text-[10px] text-text-muted">kg in</div></div>
            <div><div className="font-mono font-bold text-[16px]">{massBalance.totalOut.toFixed(1)}</div><div className="text-[10px] text-text-muted">kg out</div></div>
            <div><div className={`font-mono font-bold text-[16px] ${massBalance.withinTol ? 'text-ok' : 'text-warn'}`}>{massBalance.variance > 0 ? '+' : ''}{massBalance.variance.toFixed(1)}</div><div className="text-[10px] text-text-muted">variance</div></div>
          </div>
          {!readOnly && (
            <button onClick={onConfirmMb} disabled={mbConfirmed}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ok/10 text-ok font-medium text-[13px] disabled:opacity-40">
              <CheckCircle2 size={15} /> {mbConfirmed ? 'Mass balance confirmed' : 'Confirm mass balance'}
            </button>
          )}
        </div>
      )}

      {/* Failure → maintenance */}
      {raisedCard ? (
        <p className="text-[12px] text-info flex items-center gap-1.5"><Wrench size={13} /> Maintenance job raised (#{raisedCard}).</p>
      ) : failing && !readOnly && (
        <button onClick={onRaise} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-err/10 text-err font-medium text-[13px]">
          <Wrench size={15} /> Raise to maintenance
        </button>
      )}
    </div>
  )
}

// ── Numeric input with camera photo-read ──────────────────────────────────────
function ValueCapture({ label, unit, value, onChange, disabled, spec }: {
  label: string; unit: string; value: string; onChange: (v: string) => void; disabled: boolean; spec?: CheckSpec
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const v = parseFloat(value)
  const oor = isFinite(v) && outOfRange(v, spec)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true); setErr(null)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file)
      })
      const resp = await fetch('/api/production/read-value', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, mimeType: file.type || 'image/jpeg', label, unit }),
      })
      const j = await resp.json()
      if (j.value != null) onChange(String(j.value))
      else setErr('Could not read the display — type it instead')
    } catch { setErr('Scan failed — type it instead') }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input type="number" inputMode="decimal" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
          placeholder={spec?.min != null || spec?.max != null ? `${spec?.min ?? ''}–${spec?.max ?? ''}` : ''}
          className={INP + (oor ? ' border-warn' : '')} />
        {unit && <span className="text-[12px] text-text-muted w-8 shrink-0">{unit}</span>}
        {!disabled && (
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="px-3 py-2.5 rounded-xl border border-stone-200 text-stone-500 hover:border-brand hover:text-brand shrink-0" title="Scan the display">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
      {oor && <p className="text-[11px] text-warn flex items-center gap-1"><AlertTriangle size={11} /> Outside expected {spec?.min ?? ''}–{spec?.max ?? ''}{unit ? ' ' + unit : ''}</p>}
      {err && <p className="text-[11px] text-err">{err}</p>}
    </div>
  )
}

// ── Raise-to-maintenance modal ────────────────────────────────────────────────
function RaiseModal({ def, onClose, onRaise }: {
  def: MachineCheckDef; onClose: () => void; onRaise: (def: MachineCheckDef, w: 'breakdown' | 'planned') => Promise<void>
}) {
  const [busy, setBusy] = useState<'breakdown' | 'planned' | null>(null)
  async function go(w: 'breakdown' | 'planned') { setBusy(w); await onRaise(def, w) }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center gap-2"><Wrench size={18} className="text-err" /><span className="font-semibold text-[15px] text-text">Raise to maintenance</span></div>
        <p className="text-[13px] text-text-muted">{def.label}{def.equipment ? ` · ${def.equipment}` : ''}. How urgent is this?</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => go('breakdown')} disabled={busy !== null}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-err text-white text-[13px] font-medium disabled:opacity-40">
            {busy === 'breakdown' ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />} Breakdown (urgent)
          </button>
          <button onClick={() => go('planned')} disabled={busy !== null}
            className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-stone-200 text-text text-[13px] font-medium disabled:opacity-40">
            {busy === 'planned' ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />} Planned
          </button>
        </div>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl text-[13px] text-stone-500">Cancel</button>
      </div>
    </div>
  )
}
