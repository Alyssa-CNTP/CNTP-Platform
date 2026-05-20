'use client'

/**
 * H&S Shift Checklist
 * ─────────────────────────────────────────────────────────────────────────────
 * Completed per section per shift — not a general daily checklist.
 * When accessed from the production flow (?section=Refining+1), it pre-filters
 * to show only the checklist items relevant to that section.
 * Can also be accessed standalone for any section.
 */

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { ShieldCheck, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react'
import clsx from 'clsx'
import SignaturePad from '@/components/ui/SignaturePad'

// ── CHECKLIST: items are tagged by which sections they apply to ───────────────
// section tags: 'all' | 'sieve' | 'ref' | 'gran' | 'blend' | 'past'
interface HSItem {
  id: string
  category: string
  label: string
  note?: string
  sections: string[]  // which section IDs this applies to ('all' = every section)
}

const HS_ITEMS: HSItem[] = [
  // PPE — all sections
  { id: 'ppe_gloves',    category: 'PPE', sections: ['all'], label: 'Gloves worn by all operators handling product' },
  { id: 'ppe_dustmask',  category: 'PPE', sections: ['all'], label: 'Dust masks worn where dust is present' },
  { id: 'ppe_hairnet',   category: 'PPE', sections: ['all'], label: 'Hairnets and beard nets worn' },
  { id: 'ppe_ear',       category: 'PPE', sections: ['all'], label: 'Ear protection worn in high-noise areas' },
  { id: 'ppe_boots',     category: 'PPE', sections: ['all'], label: 'Safety footwear worn by all floor personnel' },
  { id: 'ppe_jewellery', category: 'PPE', sections: ['all'], label: 'No jewellery, watches, or nail polish on floor' },

  // Equipment — all sections
  { id: 'eq_guards',     category: 'Equipment', sections: ['all'], label: 'All machine guards in place before start-up', note: 'Check conveyors, sieves, and rotating equipment' },
  { id: 'eq_fire',       category: 'Equipment', sections: ['all'], label: 'Fire extinguisher accessible — not obstructed' },
  { id: 'eq_firstaid',   category: 'Equipment', sections: ['all'], label: 'First aid kit available and fully stocked' },
  { id: 'eq_emergency',  category: 'Equipment', sections: ['all'], label: 'Emergency exits clear and signage visible' },
  { id: 'eq_electrical', category: 'Equipment', sections: ['all'], label: 'No exposed electrical cables or damage observed' },

  // Housekeeping — all sections
  { id: 'hk_spills',    category: 'Housekeeping', sections: ['all'], label: 'No spills or slip hazards on floor' },
  { id: 'hk_walkways',  category: 'Housekeeping', sections: ['all'], label: 'All walkways and aisles clear of obstruction' },
  { id: 'hk_waste',     category: 'Housekeeping', sections: ['all'], label: 'Waste bins not overflowing — waste removed to designated area' },
  { id: 'hk_chemicals', category: 'Housekeeping', sections: ['all'], label: 'Cleaning chemicals stored correctly — labelled and locked' },

  // Quality — all sections
  { id: 'qa_scale',     category: 'Quality', sections: ['all'], label: 'Scale verified before start of shift', note: 'Record std weight and actual weight on cleaning checklist' },
  { id: 'qa_hygiene',   category: 'Quality', sections: ['all'], label: 'Operators have washed hands before handling product' },
  { id: 'qa_allergen',  category: 'Quality', sections: ['all'], label: 'Allergen controls in place for current production run' },
  { id: 'qa_foreign',   category: 'Quality', sections: ['all'], label: 'Foreign object awareness briefing completed for shift' },

  // Sieving Tower specific
  { id: 'sv_magnet',    category: 'Sieving Tower', sections: ['sieve'], label: 'Magnet cleaned and checked before start', note: 'Record any metal found in foreign object sighting log' },
  { id: 'sv_aspirator', category: 'Sieving Tower', sections: ['sieve'], label: 'Aspirator checked and operational' },
  { id: 'sv_dustex',    category: 'Sieving Tower', sections: ['sieve'], label: 'Dust extraction system operational and connected' },
  { id: 'sv_hopper',    category: 'Sieving Tower', sections: ['sieve'], label: 'Debagging hopper clear — no blockages' },

  // Refining specific
  { id: 'rf_magnet',    category: 'Refining', sections: ['ref1', 'ref2'], label: 'Post-sieve magnet cleaned — foreign objects recorded', note: 'Report any nuts/bolts immediately to Production Foreman' },
  { id: 'rf_screen',    category: 'Refining', sections: ['ref1', 'ref2'], label: 'Indent screen inspected and clear' },
  { id: 'rf_chute',     category: 'Refining', sections: ['ref1', 'ref2'], label: 'Screw conveyors and chute free of blockage' },

  // Granule Line specific
  { id: 'gr_water',     category: 'Granule Line', sections: ['gran'], label: 'Water supply pressure checked before start' },
  { id: 'gr_dryer',     category: 'Granule Line', sections: ['gran'], label: 'Dryer temperature verified within range' },
  { id: 'gr_pelletmill',category: 'Granule Line', sections: ['gran'], label: 'Pellet mill feed hopper clear and operational' },
  { id: 'gr_dustex',    category: 'Granule Line', sections: ['gran'], label: 'Granule dust extraction connected and operational' },

  // Blender specific
  { id: 'bl_clean',     category: 'Blender', sections: ['blend'], label: 'Blender drum inspected clean — no residue from previous blend', note: 'Critical for allergen and cross-contamination control' },
  { id: 'bl_seals',     category: 'Blender', sections: ['blend'], label: 'Blender door and seals intact before loading' },

  // Pasteuriser specific
  { id: 'pa_boiler',    category: 'Pasteuriser', sections: ['past'], label: 'Boiler pressure within acceptable range (500–1000 kPa)', note: 'Check before start-up every shift' },
  { id: 'pa_temp',      category: 'Pasteuriser', sections: ['past'], label: 'Pasteuriser temperature reached >85°C before production' },
  { id: 'pa_steam',     category: 'Pasteuriser', sections: ['past'], label: 'Steam temperature within range (104–150°C)' },
  { id: 'pa_water',     category: 'Pasteuriser', sections: ['past'], label: 'Water condition checked (<950 mS)' },
  { id: 'pa_postsieve', category: 'Pasteuriser', sections: ['past'], label: 'Post-sieve plate size confirmed per job card' },

  // Environment — all sections
  { id: 'env_temp',     category: 'Environment', sections: ['all'], label: 'Temperature and humidity within acceptable range' },
  { id: 'env_lighting', category: 'Environment', sections: ['all'], label: 'Adequate lighting in all work areas' },
]

type CheckState = 'pass' | 'fail' | 'na' | null

interface CheckRecord {
  id?: string
  section_id: string
  section_name: string
  date: string
  shift: 'morning' | 'afternoon'
  supervisor: string
  checks: Record<string, CheckState>
  comments: string
  signature: string | null
  submitted_at: string | null
}

function makeEmpty(sectionId: string, sectionName: string, shift: 'morning' | 'afternoon'): CheckRecord {
  const items = getItemsForSection(sectionId)
  return {
    section_id: sectionId,
    section_name: sectionName,
    date: format(new Date(), 'yyyy-MM-dd'),
    shift,
    supervisor: '',
    checks: Object.fromEntries(items.map(i => [i.id, null])),
    comments: '',
    signature: null,
    submitted_at: null,
  }
}

function getItemsForSection(sectionId: string): HSItem[] {
  return HS_ITEMS.filter(i => i.sections.includes('all') || i.sections.includes(sectionId))
}

const SECTION_NAMES: Record<string, string> = {
  ref1: 'Refining 1', ref2: 'Refining 2',
  sieve: 'Sieving Tower', gran: 'Granule Line',
  blend: 'Blender', past: 'Pasteuriser',
}

const ALL_SECTIONS = [
  { id: 'sieve', name: 'Sieving Tower' },
  { id: 'ref1',  name: 'Refining 1' },
  { id: 'ref2',  name: 'Refining 2' },
  { id: 'gran',  name: 'Granule Line' },
  { id: 'blend', name: 'Blender' },
  { id: 'past',  name: 'Pasteuriser' },
]

function HSPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { displayName } = useAuth()
  const db = getDb()

  const fromFlow   = searchParams.get('from') === 'flow'
  const flowId     = searchParams.get('flowId') ?? ''
  const paramSecId = searchParams.get('section') ?? ''

  const [sectionId,  setSectionId]  = useState(paramSecId || 'sieve')
  const [shift,      setShift]      = useState<'morning' | 'afternoon'>('morning')
  const [record,     setRecord]     = useState<CheckRecord>(() => makeEmpty(paramSecId || 'sieve', SECTION_NAMES[paramSecId || 'sieve'] ?? 'Sieving Tower', 'morning'))
  const [saving,     setSaving]     = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [recordId,   setRecordId]   = useState<string | null>(null)

  const sectionName = SECTION_NAMES[sectionId] ?? sectionId
  const items = getItemsForSection(sectionId)
  const categories = [...new Set(items.map(i => i.category))]

  useEffect(() => {
    const empty = makeEmpty(sectionId, sectionName, shift)
    setRecord(empty)
    setSubmitted(false)
    setRecordId(null)
    checkExisting()
  }, [sectionId, shift])

  async function checkExisting() {
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data } = await db.from('hs_checklists')
      .select('*').eq('date', today).eq('section_id', sectionId).eq('shift', shift).maybeSingle()
    if (data) {
      setRecord(data as any)
      setSubmitted(!!(data as any).submitted_at)
      setRecordId((data as any).id)
    }
  }

  function setCheck(id: string, val: CheckState) {
    setRecord(r => ({ ...r, checks: { ...r.checks, [id]: val } }))
  }

  const allAnswered = items.every(i => record.checks[i.id] !== null)
  const failCount   = items.filter(i => record.checks[i.id] === 'fail').length
  const doneCount   = items.filter(i => record.checks[i.id] !== null).length

  async function submit() {
    if (!record.signature) return
    setSaving(true)
    const payload = { ...record, supervisor: record.supervisor || displayName, submitted_at: new Date().toISOString() }
    if (recordId) {
      await db.from('hs_checklists').update(payload).eq('id', recordId)
    } else {
      const { data } = await db.from('hs_checklists').insert(payload).select('id').single()
      if (data) setRecordId((data as any).id)
    }
    setSaving(false)
    setSubmitted(true)
    if (fromFlow) setTimeout(() => router.push(`/production/flow?id=${flowId}`), 1200)
  }

  async function saveDraft() {
    setSaving(true)
    const payload = { ...record, supervisor: record.supervisor || displayName }
    if (recordId) {
      await db.from('hs_checklists').update(payload).eq('id', recordId)
    } else {
      const { data } = await db.from('hs_checklists').insert(payload).select('id').single()
      if (data) setRecordId((data as any).id)
    }
    setSaving(false)
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5 pb-8">

      {/* Back */}
      {fromFlow && (
        <button onClick={() => router.push(`/production/flow?id=${flowId}`)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors">
          <ArrowLeft size={15} /> Back to {sectionName} flow
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={20} className="text-accent-light" />
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-text">H&S Shift Checklist</h1>
          <p className="text-[11px] text-text-muted">{format(new Date(), 'EEEE d MMMM yyyy')} · BHW</p>
        </div>
      </div>

      {/* Section + Shift selectors */}
      {!fromFlow && (
        <div className="card p-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Section</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="input">
              {ALL_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Shift</label>
            <div className="flex border border-surface-rule rounded-xl overflow-hidden">
              {(['morning', 'afternoon'] as const).map((s, i) => (
                <button key={s} onClick={() => setShift(s)}
                  className={clsx('flex-1 py-2 text-sm font-semibold transition-colors capitalize', i > 0 && 'border-l border-surface-rule', shift === s ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text')}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section + shift summary when from flow */}
      {fromFlow && (
        <div className="flex items-center gap-3 p-3 bg-surface rounded-xl border border-surface-rule">
          <div className="flex-1">
            <p className="font-semibold text-sm text-text">{sectionName} · {shift} shift</p>
            <p className="text-[11px] text-text-muted">{doneCount} of {items.length} items checked</p>
          </div>
          <div className="flex gap-2">
            {(['morning', 'afternoon'] as const).map((s, i) => (
              <button key={s} onClick={() => setShift(s)}
                className={clsx('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors capitalize', shift === s ? 'bg-brand text-white' : 'bg-surface-card border border-surface-rule text-text-muted')}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-[10px] text-text-muted mb-1">
          <span>{doneCount} / {items.length} checked</span>
          {failCount > 0 && <span className="text-status-error font-semibold">{failCount} failed</span>}
        </div>
        <div className="h-1.5 bg-surface-rule rounded-full overflow-hidden">
          <div className="h-full bg-status-ok rounded-full transition-all duration-500"
            style={{ width: `${items.length > 0 ? (doneCount / items.length) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Alerts */}
      {submitted && (
        <div className="flex items-center gap-3 p-3 bg-ok-bg border border-ok/30 rounded-xl">
          <CheckCircle2 size={18} className="text-status-ok flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm text-text">Checklist submitted</p>
            <p className="text-[11px] text-text-muted">{failCount > 0 ? `${failCount} items flagged — corrective action required` : 'All clear'}</p>
          </div>
        </div>
      )}

      {failCount > 0 && !submitted && (
        <div className="flex items-center gap-3 p-3 bg-err-bg border border-err/30 rounded-xl">
          <AlertTriangle size={16} className="text-status-error flex-shrink-0" />
          <p className="text-sm text-text"><strong>{failCount} item{failCount !== 1 ? 's' : ''} failed</strong> — corrective action required before production continues.</p>
        </div>
      )}

      {/* Checklist by category */}
      {categories.map(category => {
        const catItems = items.filter(i => i.category === category)
        const catDone  = catItems.filter(i => record.checks[i.id] !== null).length
        return (
          <div key={category} className="card overflow-hidden">
            <div className="card-head bg-surface">
              <span className="card-title text-[14px]">{category}</span>
              <span className="font-mono text-[10px] text-text-muted">{catDone}/{catItems.length}</span>
            </div>
            <div className="divide-y divide-surface-rule">
              {catItems.map(item => {
                const state = record.checks[item.id]
                return (
                  <div key={item.id} className={clsx('px-4 py-3', state === 'fail' && 'bg-err-bg/20')}>
                    <div className="flex items-start gap-4 mb-1">
                      <p className="flex-1 text-[13px] text-text leading-relaxed">{item.label}</p>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {(['pass', 'fail', 'na'] as CheckState[]).map(opt => (
                          <button key={opt} disabled={submitted} onClick={() => setCheck(item.id, opt)}
                            className={clsx(
                              'px-2.5 py-1 rounded-lg font-mono text-[9px] font-bold uppercase tracking-wide transition-all border',
                              state === opt
                                ? opt === 'pass' ? 'bg-status-ok text-white border-ok'
                                  : opt === 'fail' ? 'bg-status-error text-white border-err'
                                  : 'bg-surface-rule text-text border-surface-rule'
                                : 'bg-surface-card text-text-muted border-surface-rule hover:border-text-muted disabled:opacity-50'
                            )}>
                            {opt === 'na' ? 'N/A' : opt}
                          </button>
                        ))}
                      </div>
                    </div>
                    {item.note && (
                      <p className="text-[11px] text-text-muted italic ml-0 mt-0.5">{item.note}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Comments */}
      <div className="card p-4 space-y-2">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Comments / corrective actions taken</label>
        <textarea
          value={record.comments}
          onChange={e => setRecord(r => ({ ...r, comments: e.target.value }))}
          disabled={submitted}
          placeholder="Note any failed items, actions taken, or observations for this shift…"
          rows={3}
          className="input resize-none text-sm"
        />
      </div>

      {/* Supervisor */}
      <div className="card p-4 space-y-3">
        <p className="font-semibold text-[15px] text-text">Supervisor sign-off</p>
        <p className="text-xs text-text-muted">The supervisor on shift must sign to confirm this checklist is complete.</p>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted block mb-1">Supervisor name</label>
          <input
            className="input"
            placeholder="Enter supervisor name"
            value={record.supervisor}
            onChange={e => setRecord(r => ({ ...r, supervisor: e.target.value }))}
            disabled={submitted}
          />
        </div>
        <SignaturePad
          label="Supervisor signature"
          name={record.supervisor || 'Enter supervisor name above'}
          value={record.signature}
          onChange={(sig: string | null) => setRecord(r => ({ ...r, signature: sig }))}
          disabled={submitted}
        />
      </div>

      {/* Actions */}
      {!submitted && (
        <div className="flex gap-3">
          <button onClick={saveDraft} disabled={saving}
            className="px-4 py-3 border border-surface-rule rounded-xl text-sm font-semibold text-text-muted hover:bg-surface transition-colors">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={submit}
            disabled={!allAnswered || !record.signature || saving}
            className={clsx('flex-1 py-3 rounded-xl font-semibold text-base transition-all', allAnswered && record.signature ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed')}
          >
            {saving ? 'Submitting…' : !allAnswered ? `Complete all ${items.length} checks first` : !record.signature ? 'Signature required' : 'Submit H&S Checklist'}
          </button>
        </div>
      )}

      {submitted && fromFlow && (
        <button onClick={() => router.push(`/production/flow?id=${flowId}`)}
          className="w-full py-3 bg-ok-bg border border-ok/30 rounded-xl font-semibold text-status-ok text-sm">
          ✓ Submitted — return to {sectionName} flow
        </button>
      )}
    </div>
  )
}

export default function HSPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center">
        <div className="text-[11px] text-text-muted animate-pulse uppercase tracking-[2px]">Loading…</div>
      </div>
    }>
      <HSPage />
    </Suspense>
  )
}