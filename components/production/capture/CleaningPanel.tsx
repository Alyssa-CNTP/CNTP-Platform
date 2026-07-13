'use client'

import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, Circle, AlertTriangle, Lock, Loader2, ShieldCheck, Camera, Sparkles } from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { cleaningTasksFor, FREQUENCY_LABEL, FREQUENCY_DAYS, type CleaningTaskDef } from '@/lib/production/cleaning-config'

type TaskStatus = 'done' | 'flag'
interface PhotoVerdict { clean: boolean; note: string }

const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/**
 * Explicit-confirmation cleaning (compliance). Every due task starts UNCHECKED;
 * the operator must tick each one as done, or flag it not-done with a reason,
 * before they can sign off — nothing is ever assumed done. Identity + timestamp
 * come from the login. On sign-off the operator re-enters their PIN; each done
 * task and each flagged exception is written to the append-only cleaning_logs
 * audit trail (per-task proof via the area_confirmed / task_exception actions).
 *
 * Smart additions: weekly/monthly tasks surface only when due (from
 * cleaning_task_state); each area can be photo-verified (Gemini vision); and a
 * concise AI cleaning summary is stored on the record at sign-off.
 */
export function CleaningPanel({ sectionId, date, shift, sessionId, locked, operators }: {
  sectionId: string
  date: string
  shift: string
  sessionId: string | null
  locked: boolean
  operators: { id: string; name: string; pin: string }[]
}) {
  const tasks = cleaningTasksFor(sectionId)
  const areas = [...new Set(tasks.map(t => t.area))]

  const [status, setStatus] = useState<Record<string, TaskStatus>>({})   // task_key → 'done' | 'flag'
  const [reasons, setReasons] = useState<Record<string, string>>({})     // task_key → not-done reason
  const [taskState, setTaskState]   = useState<Record<string, string>>({})   // task_key → last_done_at
  const [photos, setPhotos]         = useState<Record<string, PhotoVerdict>>({}) // area → verdict
  const [verifying, setVerifying]   = useState<string | null>(null)
  const [aiSummary, setAiSummary]   = useState('')
  const [pin, setPin]       = useState('')
  const [signed, setSigned] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const verifyAreaRef = useRef<string | null>(null)

  useEffect(() => {
    const db = getDb()
    db.schema('production').from('cleaning_records')
      .select('status, ai_summary').eq('section_id', sectionId).eq('date', date).eq('shift', shift).maybeSingle()
      .then(({ data }: any) => { if (data && data.status !== 'in_progress') { setSigned(true); setAiSummary(data.ai_summary ?? '') } })
    db.schema('production').from('cleaning_task_state').select('*').eq('section_id', sectionId)
      .then(({ data }: any) => {
        const m: Record<string, string> = {}
        ;(data ?? []).forEach((r: any) => { m[r.task_key] = r.last_done_at })
        setTaskState(m)
        setLoading(false)
      })
  }, [sectionId, date, shift])

  // Weekly/monthly tasks show only when due (daily always shows).
  function isDue(t: CleaningTaskDef): boolean {
    if (t.frequency === 'daily') return true
    const last = taskState[t.key]
    return !last || daysSince(last) >= FREQUENCY_DAYS[t.frequency]
  }

  // Explicit confirmation: a task is either ticked done or flagged not-done.
  // Tapping the active state again clears it (back to un-actioned).
  function markDone(key: string) {
    setStatus(s => {
      if (s[key] === 'done') { const { [key]: _, ...rest } = s; return rest }
      return { ...s, [key]: 'done' }
    })
  }
  function markFlag(key: string) {
    setStatus(s => {
      if (s[key] === 'flag') { const { [key]: _, ...rest } = s; return rest }
      return { ...s, [key]: 'flag' }
    })
  }
  function setReason(key: string, reason: string) {
    setReasons(r => ({ ...r, [key]: reason }))
  }

  // ── Photo-verify an area (Gemini vision; image not stored) ─────────────────
  function startVerify(area: string) { verifyAreaRef.current = area; fileRef.current?.click() }
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const area = verifyAreaRef.current
    if (fileRef.current) fileRef.current.value = ''
    if (!file || !area) return
    setVerifying(area); setError(null)
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file)
      })
      const resp = await fetch('/api/production/verify-clean', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, mimeType: file.type || 'image/jpeg', area }),
      })
      const j = await resp.json()
      if (resp.ok) setPhotos(p => ({ ...p, [area]: { clean: !!j.clean, note: j.note ?? '' } }))
      else setError(j.error ?? 'Photo check failed')
    } catch { setError('Photo check failed') }
    setVerifying(null)
  }

  const dueTasks = tasks.filter(isDue)
  const doneKeys    = dueTasks.filter(t => status[t.key] === 'done').map(t => t.key)
  const flaggedKeys = dueTasks.filter(t => status[t.key] === 'flag').map(t => t.key)
  const untouched   = dueTasks.filter(t => !status[t.key])
  const doneCount = doneKeys.length
  const missingReason = flaggedKeys.some(k => !(reasons[k] ?? '').trim())
  const canSign = untouched.length === 0 && !missingReason

  async function sign() {
    setError(null)
    if (!operators.length)       { setError('No operators rostered for this section'); return }
    const op = operators.find(o => o.pin && o.pin === pin)
    if (!op)                     { setError('PIN not recognised — check the roster'); return }
    if (untouched.length)        { setError(`Tick or flag every task first — ${untouched.length} still to action`); return }
    if (missingReason)           { setError('Add a reason for each flagged task'); return }
    setSigning(true)
    try {
      const db = getDb()
      const { data: rec } = await db.schema('production').from('cleaning_records').upsert({
        section_id: sectionId, date, shift, session_id: sessionId,
        status: 'operator_signed',
        operator_id: op.id, operator_name: op.name,
        operator_signed_at: new Date().toISOString(),
        exceptions_count: flaggedKeys.length,
      } as any, { onConflict: 'section_id,date,shift' }).select('id').single()
      const recordId = (rec as any).id

      const logs: any[] = []
      // Per-task done proof — each task the operator explicitly ticked (task_key set).
      doneKeys.forEach(k => {
        const t = tasks.find(x => x.key === k)
        logs.push({ record_id: recordId, action: 'area_confirmed', area: t?.area ?? null, task_key: k, detail: { task: t?.task }, actor_id: op.id, actor_name: op.name })
      })
      flaggedKeys.forEach(k => {
        const t = tasks.find(x => x.key === k)
        logs.push({ record_id: recordId, action: 'task_exception', area: t?.area ?? null, task_key: k, detail: { reason: reasons[k] ?? '', task: t?.task }, actor_id: op.id, actor_name: op.name })
      })
      Object.entries(photos).forEach(([area, v]) => {
        logs.push({ record_id: recordId, action: 'photo', area, detail: { source: 'ai_verify', clean: v.clean, note: v.note }, actor_id: op.id, actor_name: op.name })
      })
      logs.push({ record_id: recordId, action: 'operator_sign', detail: { pin_verified: true, done: doneCount, flagged: flaggedKeys.length, total: dueTasks.length }, actor_id: op.id, actor_name: op.name })
      await db.schema('production').from('cleaning_logs').insert(logs as any)

      // Mark weekly/monthly tasks done (so they go quiet until next due).
      const now = new Date().toISOString()
      const stateRows = dueTasks
        .filter(t => t.frequency !== 'daily' && status[t.key] === 'done')
        .map(t => ({ section_id: sectionId, task_key: t.key, last_done_at: now }))
      if (stateRows.length) await db.schema('production').from('cleaning_task_state').upsert(stateRows as any, { onConflict: 'section_id,task_key' })

      // AI cleaning summary (best-effort).
      try {
        const sres = await fetch('/api/production/check-summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'cleaning', section: sectionId, shift, date,
            done: doneCount, total: dueTasks.length,
            exceptions: flaggedKeys.map(k => ({ task: tasks.find(t => t.key === k)?.task, reason: reasons[k] ?? '' })),
            photos: Object.entries(photos).map(([area, v]) => ({ area, clean: v.clean, note: v.note })),
          }),
        })
        const sj = await sres.json().catch(() => ({}))
        if (sj.summary) {
          setAiSummary(sj.summary)
          await db.schema('production').from('cleaning_records').update({ ai_summary: sj.summary } as any).eq('id', recordId)
        }
      } catch { /* summary is best-effort */ }

      setSigned(true)
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  if (signed) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
          <Lock size={20} className="text-ok" />
          <span className="font-semibold text-[14px] text-ok">Cleaning signed off{flaggedKeys.length > 0 ? ` · ${flaggedKeys.length} exception(s) logged` : ''}.</span>
        </div>
        {aiSummary && (
          <div className="px-4 py-3 bg-ok/5 border border-ok/30 rounded-2xl">
            <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold text-ok uppercase tracking-wide"><Sparkles size={13} /> Cleaning summary</div>
            <p className="text-[13px] text-text leading-relaxed">{aiSummary}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-[12px] text-stone-500 leading-relaxed">
        <strong>Tick each task as you complete it.</strong> If something wasn't done, tap <strong>Flag</strong> and add a reason.
        You can't sign off until every task is ticked or flagged. Weekly/monthly tasks appear only when due. You can
        <strong> photo-verify</strong> an area. Your name and the time are recorded automatically.
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />

      {areas.map(area => {
        const areaTasks = tasks.filter(t => t.area === area)
        const dueArea   = areaTasks.filter(isDue)
        const notDue    = areaTasks.filter(t => !isDue(t))
        const verdict   = photos[area]
        return (
          <div key={area} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
              <span className="font-semibold text-[13px] text-text flex-1">{area}</span>
              <button onClick={() => startVerify(area)} disabled={verifying !== null}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-brand px-1.5 py-1 rounded-lg" title="Photo-verify this area">
                {verifying === area ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Verify
              </button>
            </div>
            {verdict && (
              <div className={`flex items-start gap-2 px-4 py-2 text-[12px] ${verdict.clean ? 'text-ok bg-ok/5' : 'text-warn bg-warn/5'}`}>
                {verdict.clean ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <span>{verdict.clean ? 'Photo looks clean' : 'Photo flagged'}{verdict.note ? ` — ${verdict.note}` : ''}</span>
              </div>
            )}
            <div className="divide-y divide-stone-100">
              {dueArea.map(t => {
                const st = status[t.key]
                return (
                  <div key={t.key} className="px-4 py-2.5">
                    <div className="w-full flex items-center gap-3">
                      <button onClick={() => !locked && markDone(t.key)} disabled={locked} className="shrink-0" title="Mark done" aria-pressed={st === 'done'}>
                        {st === 'done'
                          ? <CheckCircle2 size={20} className="text-ok" />
                          : <Circle size={20} className={`${st === 'flag' ? 'text-stone-200' : 'text-stone-300'}`} />}
                      </button>
                      <span className={`flex-1 text-[13px] ${st === 'flag' ? 'text-err' : 'text-text'}`}>{t.task}</span>
                      {t.frequency !== 'daily' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">{FREQUENCY_LABEL[t.frequency]} · due</span>}
                      <button onClick={() => !locked && markFlag(t.key)} disabled={locked}
                        className={`shrink-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors ${st === 'flag' ? 'border-err/40 bg-err/5 text-err' : 'border-stone-200 text-stone-400 hover:text-err hover:border-err/30'}`}
                        title="Flag as not done">
                        <AlertTriangle size={13} /> {st === 'flag' ? 'Not done' : 'Flag'}
                      </button>
                    </div>
                    {st === 'flag' && (
                      <input autoFocus value={reasons[t.key] ?? ''} onChange={e => setReason(t.key, e.target.value)}
                        placeholder="Why wasn't this done?"
                        className="mt-2 w-full px-3 py-2 rounded-lg border border-err/30 bg-err/5 text-[12px] text-text outline-none focus:border-err" />
                    )}
                  </div>
                )
              })}
              {notDue.map(t => (
                <div key={t.key} className="px-4 py-2 flex items-center gap-3 text-[12px] text-stone-400">
                  <CheckCircle2 size={15} className="text-stone-300 shrink-0" />
                  <span className="flex-1">{t.task}</span>
                  <span className="text-[10px]">{FREQUENCY_LABEL[t.frequency]} · next due {taskState[t.key] ? fmtDate(new Date(new Date(taskState[t.key]).getTime() + FREQUENCY_DAYS[t.frequency] * 86_400_000).toISOString()) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[12px] text-text-muted flex-wrap">
          <span className="text-ok font-medium">{doneCount} done</span>
          {flaggedKeys.length > 0 && <span className="text-err font-medium">· {flaggedKeys.length} flagged</span>}
          {untouched.length > 0 && <span className="text-amber-600 font-medium">· {untouched.length} still to action</span>}
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand shrink-0" />
          <input type="password" inputMode="numeric" maxLength={4} value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null) }}
            placeholder="Enter PIN to sign" disabled={locked}
            className="flex-1 px-3 py-2.5 rounded-xl border border-stone-200 bg-white text-center font-mono tracking-[0.4em] text-[16px] outline-none focus:border-brand" />
          <button onClick={sign} disabled={locked || signing || pin.length !== 4 || !canSign}
            className="px-4 py-2.5 rounded-xl bg-brand text-white text-[13px] font-medium disabled:opacity-40 flex items-center gap-1.5">
            {signing ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Sign
          </button>
        </div>
        {error && <p className="text-[12px] text-err">{error}</p>}
      </div>
    </div>
  )
}
