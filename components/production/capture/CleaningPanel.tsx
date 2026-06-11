'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, Lock, Loader2, ShieldCheck } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { cleaningTasksFor, FREQUENCY_LABEL, type CleaningTaskDef } from '@/lib/production/cleaning-config'

interface ExceptionState { flagged: boolean; reason: string }

/**
 * Exception-based cleaning. Tasks default to done; the operator only flags what
 * wasn't completed (+reason). Identity + timestamp come from the login. On
 * sign-off the operator re-enters their PIN; everything is written to the
 * append-only cleaning_logs audit trail.
 */
export function CleaningPanel({ sectionId, date, shift, sessionId, locked, operator }: {
  sectionId: string
  date: string
  shift: string
  sessionId: string | null
  locked: boolean
  operator: { id: string; name: string; pin: string } | null
}) {
  const tasks = cleaningTasksFor(sectionId)
  const areas = [...new Set(tasks.map(t => t.area))]

  const [exceptions, setExceptions] = useState<Record<string, ExceptionState>>({})
  const [pin, setPin]       = useState('')
  const [signed, setSigned] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDb().schema('production').from('cleaning_records')
      .select('status').eq('section_id', sectionId).eq('date', date).eq('shift', shift).maybeSingle()
      .then(({ data }: any) => { if (data && data.status !== 'in_progress') setSigned(true); setLoading(false) })
  }, [sectionId, date, shift])

  function toggleException(key: string) {
    setExceptions(e => {
      const cur = e[key]
      if (cur?.flagged) { const { [key]: _, ...rest } = e; return rest }
      return { ...e, [key]: { flagged: true, reason: '' } }
    })
  }
  function setReason(key: string, reason: string) {
    setExceptions(e => ({ ...e, [key]: { flagged: true, reason } }))
  }

  const flaggedKeys = Object.keys(exceptions).filter(k => exceptions[k].flagged)
  const doneCount = tasks.length - flaggedKeys.length
  const missingReason = flaggedKeys.some(k => !exceptions[k].reason.trim())

  async function sign() {
    setError(null)
    if (!operator)               { setError('No operator identified for sign-off'); return }
    if (pin !== operator.pin)    { setError('PIN does not match — re-enter to sign'); return }
    if (missingReason)           { setError('Add a reason for each flagged task'); return }
    setSigning(true)
    try {
      const db = getDb()
      const { data: rec } = await db.schema('production').from('cleaning_records').upsert({
        section_id: sectionId, date, shift, session_id: sessionId,
        status: 'operator_signed',
        operator_id: operator.id, operator_name: operator.name,
        operator_signed_at: new Date().toISOString(),
        exceptions_count: flaggedKeys.length,
      } as any, { onConflict: 'section_id,date,shift' }).select('id').single()
      const recordId = (rec as any).id

      const logs: any[] = []
      areas.forEach(area => logs.push({ record_id: recordId, action: 'area_confirmed', area, actor_id: operator.id, actor_name: operator.name }))
      flaggedKeys.forEach(k => {
        const t = tasks.find(x => x.key === k)
        logs.push({ record_id: recordId, action: 'task_exception', area: t?.area ?? null, task_key: k, detail: { reason: exceptions[k].reason, task: t?.task }, actor_id: operator.id, actor_name: operator.name })
      })
      logs.push({ record_id: recordId, action: 'operator_sign', detail: { pin_verified: true, done: doneCount, flagged: flaggedKeys.length }, actor_id: operator.id, actor_name: operator.name })
      await db.schema('production').from('cleaning_logs').insert(logs as any)

      setSigned(true)
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  if (signed) {
    return (
      <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
        <Lock size={20} className="text-ok" />
        <span className="font-semibold text-[14px] text-ok">Cleaning signed off{flaggedKeys.length > 0 ? ` · ${flaggedKeys.length} exception(s) logged` : ''}.</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-[12px] text-stone-500 leading-relaxed">
        Everything's assumed done. <strong>Tap only the tasks that weren't completed</strong> and add a reason. Your name and the time are recorded automatically.
      </div>

      {areas.map(area => (
        <div key={area} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-stone-100 font-semibold text-[13px] text-text">{area}</div>
          <div className="divide-y divide-stone-100">
            {tasks.filter(t => t.area === area).map(t => {
              const ex = exceptions[t.key]
              return (
                <div key={t.key} className="px-4 py-2.5">
                  <button onClick={() => !locked && toggleException(t.key)} disabled={locked}
                    className="w-full flex items-center gap-3 text-left">
                    {ex?.flagged
                      ? <AlertTriangle size={17} className="text-err shrink-0" />
                      : <CheckCircle2 size={17} className="text-ok shrink-0" />}
                    <span className={`flex-1 text-[13px] ${ex?.flagged ? 'text-err' : 'text-text'}`}>{t.task}</span>
                    {t.frequency !== 'daily' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{FREQUENCY_LABEL[t.frequency]}</span>}
                  </button>
                  {ex?.flagged && (
                    <input autoFocus value={ex.reason} onChange={e => setReason(t.key, e.target.value)}
                      placeholder="Why wasn't this done?"
                      className="mt-2 w-full px-3 py-2 rounded-lg border border-err/30 bg-err/5 text-[12px] text-text outline-none focus:border-err" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <span className="text-ok font-medium">{doneCount} done</span>
          {flaggedKeys.length > 0 && <span className="text-err font-medium">· {flaggedKeys.length} flagged</span>}
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand shrink-0" />
          <input type="password" inputMode="numeric" maxLength={4} value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null) }}
            placeholder="Enter PIN to sign" disabled={locked}
            className="flex-1 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-center font-mono tracking-[0.4em] text-[16px] outline-none focus:border-brand" />
          <button onClick={sign} disabled={locked || signing || pin.length !== 4}
            className="px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 flex items-center gap-1.5">
            {signing ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Sign
          </button>
        </div>
        {error && <p className="text-[12px] text-err">{error}</p>}
      </div>
    </div>
  )
}
