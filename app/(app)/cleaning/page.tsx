'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import SignaturePad from '@/components/ui/SignaturePad'

type Shift = 'morning' | 'afternoon' | 'night'
type ChecklistRef = 'PR-FM-015/0' | 'PR-FM-017/0' | 'PR-FM-022.1/0'

interface CleanTask { area: string; task: string; responsible: string; isMagnet?: boolean }
interface TaskEntry { done: boolean; timeCleaned: string; printName: string; foreignObject: string; signature: string | null }

const CHECKLISTS: Record<ChecklistRef, { title: string; sectionId: string; tasks: CleanTask[] }> = {
  'PR-FM-017/0': {
    title: 'Sieving Tower Daily Plant Cleaning',
    sectionId: 'sieve',
    tasks: [
      { area: '1. Debagging hopper', task: 'Brush down debagging hopper daily', responsible: 'Operators and general cleaner' },
      { area: '1. Debagging hopper', task: 'Sweep up spillages', responsible: 'Operators and general cleaner' },
      { area: '2. Magnet', task: 'Clean magnet — day shift', responsible: 'Operators and general cleaner', isMagnet: true },
      { area: '2. Magnet', task: 'Clean magnet — afternoon shift', responsible: 'Operators and general cleaner', isMagnet: true },
      { area: '2. Magnet', task: 'Clean magnet — night shift', responsible: 'Operators and general cleaner', isMagnet: true },
      { area: '3. Conveyor belt', task: 'Brush down dust on conveyor belt', responsible: 'Operators and general cleaner' },
      { area: '4. Rolsif', task: 'Brush down and vacuum all surfaces on Rolsif', responsible: 'Operators and general cleaner' },
      { area: '5. Indent screen', task: 'Brush down dust on indent screen and vacuum', responsible: 'Operators and general cleaner' },
      { area: '6. Bucket elevator', task: 'Brush down dust on bucket elevator and vacuum', responsible: 'Operators and general cleaner' },
      { area: '7. Fanie Sieve', task: 'Brush down dust on fanie sieve and vacuum', responsible: 'Operators and general cleaner' },
      { area: '8. Mini Sifter', task: 'Brush down dust on mini sifter and vacuum', responsible: 'Operators and general cleaner' },
      { area: '9. Blender', task: 'Sweep up spillages', responsible: 'Operators and general cleaner' },
      { area: '9. Blender', task: 'Brush down blender and vacuum', responsible: 'Operators and general cleaner' },
      { area: '10. Floor Scale', task: 'Lift scale and sweep or vacuum underneath — do this every day', responsible: 'Operators and general cleaner' },
      { area: '11. DB', task: 'Brush under conveyor belt and behind debagging hopper', responsible: 'Operators and general cleaner' },
      { area: '12. Dust extraction', task: 'Change over from Rooibos to Honeybush (and vice versa)', responsible: 'Operators and general cleaner' },
      { area: '12. Dust extraction', task: 'Empty and clean dust extraction systems every Friday', responsible: 'Operators and general cleaner' },
      { area: '13. Walls and floor', task: 'Sweep up spillages', responsible: 'Operators and general cleaner' },
      { area: '13. Walls and floor', task: 'Clean walls and vacuum floors', responsible: 'Operators and general cleaner' },
    ],
  },
  'PR-FM-015/0': {
    title: 'Daily Plant Cleaning Checklist',
    sectionId: 'past',
    tasks: [
      { area: '2. Sieving', task: 'Vacuum the internal walls and floor', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Brush sieves (every 2hrs) — 1st brush', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Brush sieves (every 2hrs) — 2nd brush', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Brush sieves (every 2hrs) — 3rd brush', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Brush off aspirator', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Clean magnet', responsible: 'Operators & General Cleaner', isMagnet: true },
      { area: '2. Sieving', task: 'Brush off dust on bell conveyors', responsible: 'Operators & General Cleaner' },
      { area: '2. Sieving', task: 'Brush off dust on screw conveyor', responsible: 'Operators & General Cleaner' },
      { area: '3. De-bagging', task: 'Vacuum walls and floor', responsible: 'Operators / General Cleaner' },
      { area: '3. De-bagging', task: 'Sweep up spillages', responsible: 'Operators / General Cleaner' },
      { area: '4. Dust Collection Room', task: 'Brush out crevices and hard to reach areas', responsible: 'General Cleaner' },
      { area: '4. Dust Collection Room', task: 'Vacuum walls and floors', responsible: 'General Cleaner' },
      { area: '4. Dust Collection Room', task: 'Bag filters removed and changed (Rooibos ↔ Honeybush)', responsible: 'General Cleaner' },
      { area: '5. Pasteuriser', task: 'Clean pasteuriser as per procedure PPM 13.4', responsible: 'Operators / General Workers' },
      { area: '5. Pasteuriser', task: 'Vacuum all dust, tea leaves and foreign material from walls and floors', responsible: 'Operators / General Workers' },
      { area: '6. Post-sieve', task: 'Clean sieves — brush off excess tea leaves, dust and material', responsible: 'Bagging operator / General Cleaner' },
      { area: '6. Post-sieve', task: 'Remove foreign material from magnet and clean. Record nuts/bolts and report to Production Foreman immediately.', responsible: 'Bagging operator / General Cleaner', isMagnet: true },
      { area: '6. Post-sieve', task: 'Brush down dust on all surfaces of screw conveyors and chute', responsible: 'Bagging operator / General Cleaner' },
      { area: '6. Post-sieve', task: 'Vacuum all dust, tea leaves and foreign material from walls and floors', responsible: 'Bagging operator / General Cleaner' },
      { area: '7. Drying', task: 'Remove funnel at dryer feed and wipe with disposable cloth', responsible: 'Operators / General Workers' },
      { area: '7. Drying', task: 'Remove hatches, access inside dryer and remove all tea and dust using brush, dustpan and vacuum', responsible: 'Operators / General Workers' },
      { area: '7. Drying', task: 'Brush down all dust on screw conveyor and chute', responsible: 'Operators / General Workers' },
      { area: '7. Drying', task: 'Vacuum all dust, tea leaves and foreign material from walls and floors', responsible: 'Operators / General Workers' },
      { area: '8. Bagging', task: 'Wipe surfaces on conveyor chute with disposable cloth', responsible: 'Bagging machine operators / General Cleaner' },
      { area: '8. Bagging', task: 'Brush down bagging machine and small conveyor', responsible: 'Bagging machine operators / General Cleaner' },
      { area: '8. Bagging', task: 'Vacuum internal walls and floor in bagging area', responsible: 'Bagging machine operators / General Cleaner' },
      { area: '8. Bagging', task: 'Lift scale and vacuum or sweep tea underneath — do this daily', responsible: 'Bagging machine operators / General Cleaner' },
      { area: '10. Stores', task: 'Vacuum dust on floors and stored raw materials', responsible: 'General Cleaner' },
      { area: '10. Stores', task: 'Vacuum walls to reachable height', responsible: 'General Cleaner' },
      { area: '10. Stores', task: 'After mini-blender: brush out excess tea, vacuum, disinfect', responsible: 'General Cleaner' },
    ],
  },
  'PR-FM-022.1/0': {
    title: 'Cutter & Hammermill Cleaning Checklist',
    sectionId: 'gran',
    tasks: [
      { area: '1. Hammermill Hopper', task: 'Brush down hammermill hopper', responsible: 'Operators and general cleaner' },
      { area: '2. Bucket elevator', task: 'Brush dust on bucket elevator and vacuum', responsible: 'Operators and general cleaner' },
      { area: '3. Mini Sifter', task: 'Brush down dust on mini sifter and vacuum', responsible: 'Operators and general cleaner' },
      { area: '4. Floor', task: 'Lift bags, sweep and vacuum tea underneath and in surrounding areas', responsible: 'Operators and general cleaner' },
      { area: '10. Walls and surfaces', task: 'Dust off walls, tabletops and scales', responsible: 'Operators and general cleaner' },
    ],
  },
}

function taskKey(task: CleanTask, idx: number) { return `${task.area}__${idx}` }
function nowTime() { return format(new Date(), 'HH:mm') }
function emptyEntry(): TaskEntry { return { done: false, timeCleaned: '', printName: '', foreignObject: '', signature: null } }

function CleaningInner() {
  const { displayName } = useAuth()
  const searchParams = useSearchParams()
  const db = getDb()

  const defaultRef = (searchParams.get('ref') as ChecklistRef) ?? 'PR-FM-017/0'
  const defaultShift = (searchParams.get('shift') as Shift) ?? 'morning'

  const [activeRef,   setActiveRef]   = useState<ChecklistRef>(defaultRef)
  const [shift,       setShift]       = useState<Shift>(defaultShift)
  const [entries,     setEntries]     = useState<Record<string, TaskEntry>>({})
  const [supervisor,  setSupervisor]  = useState('')
  const [supSig,      setSupSig]      = useState<string | null>(null)
  const [savedId,     setSavedId]     = useState<string | null>(null)
  const [submitted,   setSubmitted]   = useState(false)
  const [saving,      setSaving]      = useState(false)

  const checklist = CHECKLISTS[activeRef]
  const tasks     = checklist.tasks
  const areas     = [...new Set(tasks.map(t => t.area))]
  const today     = format(new Date(), 'yyyy-MM-dd')

  // Reset and load when checklist or shift changes
  useEffect(() => {
    const blank: Record<string, TaskEntry> = {}
    tasks.forEach((t, i) => { blank[taskKey(t, i)] = emptyEntry() })
    setEntries(blank)
    setSupSig(null)
    setSubmitted(false)
    setSavedId(null)
    loadExisting(blank)
  }, [activeRef, shift])

  async function loadExisting(blank: Record<string, TaskEntry>) {
    const { data } = await db.from('cleaning_checklists').select('*')
      .eq('section_id', checklist.sectionId).eq('date', today).eq('shift', shift).maybeSingle()
    if (!data) return
    const c = data as any
    setEntries(c.entries ?? blank)
    setSupervisor(c.supervisor_name ?? '')
    setSupSig(c.supervisor_signature ?? null)
    setSavedId(c.id)
    setSubmitted(!!c.submitted_at)
  }

  function updateEntry(key: string, field: keyof TaskEntry, value: any) {
    setEntries(e => ({ ...e, [key]: { ...e[key], [field]: value } }))
  }

  function markDone(key: string) {
    setEntries(e => ({
      ...e,
      [key]: { ...e[key], done: true, timeCleaned: e[key].timeCleaned || nowTime(), printName: e[key].printName || displayName }
    }))
  }

  const doneTasks  = tasks.filter((t, i) => entries[taskKey(t, i)]?.done).length
  const totalTasks = tasks.length

  async function save(submit = false) {
    setSaving(true)
    const payload: any = {
      section_id: checklist.sectionId, section_name: checklist.title,
      date: today, shift,
      entries, supervisor_name: supervisor, supervisor_signature: supSig,
    }
    if (submit) payload.submitted_at = new Date().toISOString()
    if (savedId) {
      await db.from('cleaning_checklists').update(payload).eq('id', savedId)
    } else {
      const { data } = await db.from('cleaning_checklists').insert(payload).select('id').single()
      if (data) setSavedId((data as any).id)
    }
    setSaving(false)
    if (submit) setSubmitted(true)
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center flex-shrink-0">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-text">Cleaning Checklists</h1>
            <p className="font-mono text-[11px] text-text-muted">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {(['morning', 'afternoon', 'night'] as Shift[]).map(s => (
            <button key={s} onClick={() => setShift(s)}
              className={clsx('px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase font-semibold capitalize transition-colors',
                shift === s ? 'bg-brand text-white' : 'bg-surface-card border border-surface-rule text-text-muted')}>
              {s === 'morning' ? 'Morn' : s === 'afternoon' ? 'Aftn' : 'Night'}
            </button>
          ))}
        </div>
      </div>

      {/* Checklist selector */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(CHECKLISTS) as ChecklistRef[]).map(ref => (
          <button key={ref} onClick={() => setActiveRef(ref)}
            className={clsx('px-3 py-1.5 rounded-xl font-display font-bold text-[12px] border transition-colors',
              activeRef === ref ? 'bg-brand text-white border-brand' : 'bg-surface-card text-text-muted border-surface-rule hover:text-text')}>
            {ref}
          </button>
        ))}
      </div>

      {/* Title + progress */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{activeRef}</p>
            <p className="font-display font-bold text-lg text-text">{checklist.title}</p>
          </div>
          <div className="text-right">
            <p className="font-display font-bold text-2xl text-text">{doneTasks}<span className="text-text-muted font-normal text-base">/{totalTasks}</span></p>
            <p className="font-mono text-[10px] text-text-muted">tasks done</p>
          </div>
        </div>
        <div className="h-1.5 bg-surface-rule rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full transition-all duration-500', doneTasks === totalTasks ? 'bg-status-ok' : 'bg-status-info')}
            style={{ width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%` }} />
        </div>
      </div>

      {submitted && (
        <div className="flex items-center gap-3 p-4 bg-ok-bg border border-ok/30 rounded-xl">
          <CheckCircle2 size={20} className="text-status-ok" />
          <p className="font-semibold text-text">Checklist submitted ✓</p>
        </div>
      )}

      {/* Tasks by area */}
      {areas.map(area => {
        const areaTasks = tasks.map((t, i) => ({ ...t, idx: i, key: taskKey(t, i) })).filter(t => t.area === area)
        const areaDone  = areaTasks.filter(t => entries[t.key]?.done).length
        return (
          <div key={area} className="card overflow-hidden">
            <div className="card-head bg-surface">
              <div>
                <span className="card-title text-[14px]">{area}</span>
                <p className="font-mono text-[9px] text-text-muted mt-0.5">{areaTasks[0]?.responsible}</p>
              </div>
              <span className={clsx('font-mono text-[11px] font-semibold', areaDone === areaTasks.length ? 'text-status-ok' : 'text-text-muted')}>
                {areaDone}/{areaTasks.length}
              </span>
            </div>
            <div className="divide-y divide-surface-rule">
              {areaTasks.map(task => {
                const entry = entries[task.key] ?? emptyEntry()
                const isDone = entry.done
                return (
                  <div key={task.key} className={clsx('p-4 transition-colors', isDone ? 'bg-ok-bg/15' : '')}>
                    <div className="flex items-start gap-3 mb-2">
                      <button
                        onClick={() => !submitted && (isDone ? updateEntry(task.key, 'done', false) : markDone(task.key))}
                        disabled={submitted}
                        className={clsx('w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all',
                          isDone ? 'bg-status-ok border-ok' : 'border-surface-rule bg-surface-card hover:border-accent')}>
                        {isDone && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                      <p className={clsx('text-[13px] leading-relaxed flex-1', isDone ? 'text-text-muted' : 'text-text')}>{task.task}</p>
                    </div>

                    {task.isMagnet && (
                      <div className="ml-9 mb-3">
                        <label className="font-mono text-[10px] uppercase tracking-wide text-status-warn block mb-1">⚠️ Foreign object sighting log</label>
                        <input className="input text-sm" placeholder="Record any nuts, bolts, metal found — report to Foreman immediately"
                          value={entry.foreignObject} onChange={e => updateEntry(task.key, 'foreignObject', e.target.value)} disabled={submitted} />
                      </div>
                    )}

                    {(isDone || entry.timeCleaned || entry.printName) && (
                      <div className="ml-9 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted block mb-1">Time cleaned</label>
                            <input className="input text-sm font-mono" placeholder="HH:MM" value={entry.timeCleaned}
                              onChange={e => updateEntry(task.key, 'timeCleaned', e.target.value)} disabled={submitted} />
                          </div>
                          <div>
                            <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted block mb-1">Print name</label>
                            <input className="input text-sm" placeholder="Name" value={entry.printName}
                              onChange={e => updateEntry(task.key, 'printName', e.target.value)} disabled={submitted} />
                          </div>
                        </div>
                        <div>
                          <label className="font-mono text-[10px] uppercase tracking-wide text-text-muted block mb-1">Signature</label>
                          <SignaturePad label="Operator" name={entry.printName || displayName} value={entry.signature}
                            onChange={(sig: string | null) => updateEntry(task.key, 'signature', sig)} disabled={submitted} />
                        </div>
                      </div>
                    )}

                    {!isDone && !entry.timeCleaned && !submitted && (
                      <button onClick={() => markDone(task.key)} className="ml-9 mt-1 text-[11px] text-text-muted hover:text-status-ok transition-colors">
                        Tap to mark as done — fills in the time automatically
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Supervisor sign-off */}
      <div className="card p-4 space-y-3">
        <p className="font-semibold text-base text-text">Supervisor sign-off ✍️</p>
        <p className="text-sm text-text-muted">Call your supervisor when all tasks are done. They check the list and sign below.</p>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Supervisor name</label>
          <input className="input" placeholder="Supervisor's name" value={supervisor}
            onChange={e => setSupervisor(e.target.value)} disabled={submitted} />
        </div>
        <SignaturePad label="Supervisor signature" name={supervisor || 'Enter supervisor name above'}
          value={supSig} onChange={(sig: string | null) => setSupSig(sig)} disabled={submitted} />
      </div>

      {!submitted && (
        <div className="flex gap-3">
          <button onClick={() => save(false)} disabled={saving}
            className="px-4 py-3 border border-surface-rule rounded-xl text-sm font-semibold text-text-muted hover:bg-surface transition-colors">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button onClick={() => save(true)} disabled={!supSig || saving}
            className={clsx('flex-1 py-3 rounded-xl font-semibold text-base transition-all',
              supSig ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed')}>
            {!supSig ? 'Supervisor must sign first' : saving ? 'Submitting…' : 'Submit checklist'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function CleaningPage() {
  return (
    <Suspense fallback={<div className="min-h-full flex items-center justify-center"><div className="font-mono text-[11px] tracking-[2px] uppercase text-text-muted animate-pulse">Loading…</div></div>}>
      <CleaningInner />
    </Suspense>
  )
}