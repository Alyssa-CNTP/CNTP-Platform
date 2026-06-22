'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import * as React from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, parseISO } from 'date-fns'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  CheckCircle2, ChevronLeft, Loader2, Clock, ClipboardList,
  Sparkles, PenLine, Lock, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { normaliseVariant, variantSuffix } from '@/lib/constants/manufacturing'
import { num, nowTime, F, Card } from '@/components/production/shared/ui'
import { markBagConsumed } from '@/lib/production/scan-utils'
import { AcumaticaSummary } from '@/components/production/AcumaticaSummary'
import { TimesheetTab } from '@/components/production/TimesheetTab'
import { SievingFormWrapper } from '@/components/production/SievingTowerForm'
import { RefiningForm, Refining2Form } from '@/components/production/RefiningForms'
import { GranuleForm } from '@/components/production/GranuleLineForm'
import { MultiBlenderForm, MultiProductionWrapper } from '@/components/production/BlenderForms'
import { PasteuriseurFormWrapper } from '@/components/production/PasteuriserForm'

// ── Section metadata ──────────────────────────────────────────────────────────
const SECTION_META: Record<string, { name: string; code: string; color: string }> = {
  sieving:     { name: 'Sieving Tower', code: 'ST', color: 'bg-blue-500'    },
  refining1:   { name: 'Refining 1',    code: 'R1', color: 'bg-emerald-600' },
  refining2:   { name: 'Refining 2',    code: 'R2', color: 'bg-emerald-500' },
  granule:     { name: 'Granule Line',  code: 'GL', color: 'bg-amber-500'   },
  blender:     { name: 'Blender',       code: 'BL', color: 'bg-purple-500'  },
  pasteuriser: { name: 'Pasteuriser',   code: 'PR', color: 'bg-red-500'     },
}

type Tab = 'timesheet' | 'production' | 'cleaning' | 'signoff'
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'timesheet',  label: 'Timesheet',  icon: <Clock size={14} />        },
  { id: 'production', label: 'Production', icon: <ClipboardList size={14} /> },
  { id: 'cleaning',   label: 'Cleaning',   icon: <Sparkles size={14} />     },
  { id: 'signoff',    label: 'Sign-off',   icon: <PenLine size={14} />      },
]

// ── Cleaning tasks per section ────────────────────────────────────────────────
type CleanTask = { id: string; area: string; task: string; responsible: string; done: boolean; time: string; name: string }
const BASE_TASKS = (): Record<string, CleanTask[]> => ({
  sieving: [
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Vacuum walls and floor',                                    responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush sieves (every 2 hrs)',                                responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush off aspirator',                                       responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Clean magnet',                                              responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush off dust on bell conveyors',                          responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush off dust on screw conveyor',                          responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush off excess tea on rolsif + wipe magnet',              responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Brush down screen with telescopic handle and vacuum up dust',responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Sieving',              task: 'Check and clean rotary valve',                              responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'De-bagging',           task: 'Check and clean rotary valve',                              responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'De-bagging',           task: 'Vacuum walls and floor',                                    responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'De-bagging',           task: 'Sweep spillages',                                           responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Dust Collection Room', task: 'Brush crevices and hard to reach areas',                    responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Dust Collection Room', task: 'Vacuum walls and floors',                                   responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Dust Collection Room', task: 'Bag filters removed and changed (Rooibos↔Honeybush)',       responsible: 'General cleaner',            done: false, time: '', name: '' },
  ],
  refining1: [
    { id: crypto.randomUUID(), area: 'De-bagging', task: 'Check and clean rotary valve',                                           responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'De-bagging', task: 'Vacuum walls and floor',                                                 responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'De-bagging', task: 'Sweep spillages',                                                        responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Post-sieve', task: 'Clean sieves by brushing off excess tea leaves, dust and material',      responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Post-sieve', task: 'Remove foreign material from magnet and record on form',                 responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Post-sieve', task: 'Brush down screw conveyors and chute',                                   responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Post-sieve', task: 'Vacuum walls and floors',                                                responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',    task: 'Wipe surfaces on conveyor chute with disposable cloth',                  responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',    task: 'Brush down bagging machine',                                             responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',    task: 'Brush down small conveyor',                                              responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',    task: 'Vacuum internal walls and floor',                                        responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',    task: 'Lift scale and vacuum or sweep tea underneath daily',                    responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
  ],
  granule: [
    { id: crypto.randomUUID(), area: 'Granule Line', task: 'Vacuum walls and floor',                             responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Granule Line', task: 'Brush off all dust on equipment surfaces',           responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Granule Line', task: 'Check and clean rotary valve',                       responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',      task: 'Wipe surfaces on conveyor chute',                    responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',      task: 'Brush down bagging machine',                         responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',      task: 'Vacuum internal walls and floor',                    responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',      task: 'Check and clean scale',                              responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
  ],
  blender: [
    { id: crypto.randomUUID(), area: 'Blender', task: 'Vacuum walls and floor',                                  responsible: 'Operator / General cleaner', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Blender', task: 'After mini-blender: brush, vacuum and disinfect',         responsible: 'Operator',                   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging', task: 'Wipe surfaces on conveyor chute with disposable cloth',   responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging', task: 'Brush down bagging machine',                              responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging', task: 'Vacuum internal walls and floor',                         responsible: 'General cleaner',            done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging', task: 'Check and clean scale',                                   responsible: 'Bagging machine operator',   done: false, time: '', name: '' },
  ],
  pasteuriser: [
    { id: crypto.randomUUID(), area: 'Pasteuriser', task: 'Clean per PPM 13.4',                                                 responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Pasteuriser', task: 'Vacuum dust and leaves from walls and floors',                       responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Drying',      task: 'Remove funnel at dryer feed and wipe with disposable cloth',         responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Drying',      task: 'Remove all hatches, brush and vacuum inside dryer',                  responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Drying',      task: 'Brush down screw conveyor and chute',                                responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Drying',      task: 'Vacuum walls and floors',                                            responsible: 'Operator / General worker', done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',     task: 'Wipe surfaces on conveyor chute with disposable cloth',              responsible: 'Bagging machine operator',  done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',     task: 'Brush down bagging machine',                                         responsible: 'Bagging machine operator',  done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',     task: 'Vacuum internal walls and floor',                                    responsible: 'General cleaner',           done: false, time: '', name: '' },
    { id: crypto.randomUUID(), area: 'Bagging',     task: 'Check and clean scale',                                              responsible: 'Bagging machine operator',  done: false, time: '', name: '' },
  ],
})

// ── Cleaning tab ──────────────────────────────────────────────────────────────
function CleaningTab({ sectionId, locked, onProgress }: {
  sectionId: string; locked: boolean; onProgress?: (done: number, total: number) => void
}) {
  const base = BASE_TASKS()
  const initial = (base[sectionId] ?? base['refining1'] ?? []).map(t => ({ ...t, id: crypto.randomUUID() }))
  const [tasks, setTasks] = useState<CleanTask[]>(initial)

  function toggle(i: number) {
    setTasks(ts => ts.map((t, j) => j === i ? { ...t, done: !t.done, time: !t.done ? nowTime() : t.time } : t))
  }
  function setName(i: number, v: string) {
    setTasks(ts => ts.map((t, j) => j === i ? { ...t, name: v } : t))
  }

  const done  = tasks.filter(t => t.done).length
  const total = tasks.length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0
  const areas = [...new Set(tasks.map(t => t.area))]

  useEffect(() => { onProgress?.(done, total) }, [done, total])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-stone-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Progress</span>
          <span className="font-mono font-bold text-[18px] text-brand">{done}/{total}</span>
        </div>
        <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {areas.map(area => (
        <Card key={area} title={area}>
          {tasks.filter(t => t.area === area).map(t => {
            const i = tasks.findIndex(x => x.id === t.id)
            return (
              <div key={t.id} className={`rounded-xl border p-4 transition-colors ${t.done ? 'bg-ok/5 border-ok/30' : 'bg-stone-50 border-stone-200'}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => !locked && toggle(i)}
                    className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${t.done ? 'bg-ok border-ok' : 'border-stone-300 bg-white'} ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {t.done && <CheckCircle2 size={12} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] leading-snug ${t.done ? 'text-ok line-through opacity-70' : 'text-text'}`}>{t.task}</p>
                    <p className="text-[10px] text-text-faint mt-0.5">{t.responsible}</p>
                    {t.done && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="font-mono text-[10px] text-ok">{t.time}</span>
                        <input
                          value={t.name}
                          onChange={e => setName(i, e.target.value)}
                          placeholder="Print name"
                          disabled={locked}
                          className="flex-1 px-2 py-1 rounded-lg border border-ok/30 bg-ok/5 text-[12px] text-ok outline-none focus:border-ok"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </Card>
      ))}

      {done === total && total > 0 && (
        <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
          <CheckCircle2 size={20} className="text-ok" />
          <span className="font-semibold text-[14px] text-ok">All cleaning tasks completed.</span>
        </div>
      )}
    </div>
  )
}

// ── Signature pad ─────────────────────────────────────────────────────────────
function SignaturePad({ label, onSign, signed, disabled }: {
  label: string; onSign: (data: string) => void; signed: boolean; disabled: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const [hasSig, setHasSig] = useState(false)

  function getPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const src = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }
  function startDraw(e: any) { if (disabled || signed) return; drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const pos = getPos(e.nativeEvent ?? e, canvasRef.current!); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault?.() }
  function draw(e: any) { if (!drawing.current || disabled) return; const ctx = canvasRef.current!.getContext('2d')!; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1C1917'; const pos = getPos(e.nativeEvent ?? e, canvasRef.current!); ctx.lineTo(pos.x, pos.y); ctx.stroke(); setHasSig(true); e.preventDefault?.() }
  function stopDraw() { drawing.current = false }
  function clear() { canvasRef.current!.getContext('2d')!.clearRect(0, 0, 600, 140); setHasSig(false) }
  function confirm() { onSign(canvasRef.current!.toDataURL()) }

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.07em]">{label}</label>
      <div className={`rounded-2xl border-2 overflow-hidden ${signed ? 'border-ok/40 bg-ok/5' : 'border-stone-200 bg-white'}`}>
        {signed ? (
          <div className="flex items-center gap-3 px-5 py-5">
            <CheckCircle2 size={20} className="text-ok" />
            <span className="font-semibold text-[14px] text-ok">Signed</span>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef} width={600} height={140}
              className="w-full touch-none cursor-crosshair block" style={{ height: 140 }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
              <span className="text-[10px] text-stone-400">Sign above with finger or stylus</span>
              <div className="flex gap-2">
                {hasSig && <button onClick={clear} disabled={disabled} className="text-[11px] text-stone-500 hover:text-err px-3 py-1.5 rounded-lg border border-stone-200">Clear</button>}
                {hasSig && <button onClick={confirm} disabled={disabled} className="text-[11px] text-white bg-brand px-3 py-1.5 rounded-lg">Confirm</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Sign-off tab ──────────────────────────────────────────────────────────────
function SignOffTab({ sessionId, locked, sessionStatus, onSubmit, onApprove, onRequestCorrection, submitting, role, sectionId, formData, dateParam, shift }: {
  sessionId: string | null; locked: boolean; sessionStatus: string; onSubmit: () => void
  onApprove: () => void; onRequestCorrection: (reason: string) => Promise<void>
  submitting: boolean; role: string | null; sectionId: string; formData: any
  dateParam: string; shift: string
}) {
  const [opName,  setOpName]  = useState('')
  const [supName, setSupName] = useState('')
  const [opSig,   setOpSig]   = useState('')
  const [supSig,  setSupSig]  = useState('')
  const [showCorrect, setShowCorrect] = useState(false)
  const [correctReason, setCorrectReason] = useState('')
  const [correcting, setCorrecting] = useState(false)

  async function storeSignature(role: 'operator' | 'supervisor', name: string, sig: string) {
    if (!sessionId) return
    try {
      await getDb().schema('production').from('session_signatures').insert({
        session_id:     sessionId,
        signer_role:    role,
        signer_name:    name,
        signature_b64:  sig,
      } as any)
      await getDb().schema('production').from('prod_sessions').update(
        role === 'operator'
          ? { op_signed: true,  op_name_signoff:  name, op_signed_at:  new Date().toISOString() }
          : { sup_signed: true, sup_name_signoff: name, sup_signed_at: new Date().toISOString() }
      ).eq('id', sessionId)
    } catch (e: any) { console.error('signature store failed:', e.message) }
  }

  async function handleOpSign(data: string) {
    if (!opName.trim()) return
    setOpSig(data)
    await storeSignature('operator', opName.trim(), data)
  }

  async function handleSupSign(data: string) {
    if (!supName.trim()) return
    setSupSig(data)
    await storeSignature('supervisor', supName.trim(), data)
  }

  async function handleCorrection() {
    if (!correctReason.trim()) return
    setCorrecting(true)
    await onRequestCorrection(correctReason.trim())
    setShowCorrect(false)
    setCorrectReason('')
    setCorrecting(false)
  }

  const opDone  = !!opSig
  const supDone = !!supSig

  return (
    <div className="space-y-5">
      <div className="px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl">
        <p className="text-[13px] text-stone-500 leading-relaxed">
          Both operator and supervisor must sign to complete this shift record. The supervisor signature locks the form.
        </p>
      </div>

      {sectionId !== 'pasteuriser' && (
        <AcumaticaSummary sectionId={sectionId} sessionData={formData} date={dateParam} shift={shift} />
      )}

      <Card title="Operator sign-off">
        <F label="Operator name (print)" value={opName} onChange={setOpName} ph="Full name" disabled={locked} />
        {!opName.trim() && !locked && (
          <p className="text-[11px] text-warn px-1">Enter your name before signing</p>
        )}
        <SignaturePad label="Operator signature" onSign={handleOpSign} signed={opDone} disabled={locked || !opName.trim()} />
      </Card>

      {opDone && (
        <Card title="Supervisor sign-off">
          <F label="Supervisor name (print)" value={supName} onChange={setSupName} ph="Full name" disabled={locked} />
          {!supName.trim() && !locked && (
            <p className="text-[11px] text-warn px-1">Enter supervisor name before signing</p>
          )}
          <SignaturePad label="Supervisor signature" onSign={handleSupSign} signed={supDone} disabled={locked || !supName.trim()} />
        </Card>
      )}

      {!locked && opDone && supDone && sessionStatus !== 'submitted' && sessionStatus !== 'approved' && (
        <button
          onClick={onSubmit} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40"
        >
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          {submitting ? 'Submitting…' : 'Submit shift record'}
        </button>
      )}

      {(role === 'production_supervisor' || role === 'supervisor' || role === 'admin') && sessionStatus === 'submitted' && (
        <button
          onClick={onApprove} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40"
        >
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
          {submitting ? 'Locking…' : 'Approve and lock session'}
        </button>
      )}

      {role !== 'supervisor' && role !== 'admin' && sessionStatus === 'submitted' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-info/5 border border-info/20 rounded-2xl text-[13px] text-info">
          <CheckCircle2 size={16} className="flex-shrink-0" />
          <span>Record submitted — waiting for supervisor approval.</span>
        </div>
      )}

      {sessionStatus === 'submitted' && !locked && (
        <div className="space-y-3">
          {!showCorrect ? (
            <button
              onClick={() => setShowCorrect(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-warn/40 bg-warn/10 text-warn font-medium text-[13px] hover:bg-warn/20 transition-colors"
            >
              <RotateCcw size={15} /> Request correction
            </button>
          ) : (
            <div className="bg-warn/5 border border-warn/30 rounded-2xl p-4 space-y-3">
              <p className="text-[12px] font-semibold text-warn">State the reason for correction</p>
              <textarea
                value={correctReason} onChange={e => setCorrectReason(e.target.value)} rows={3}
                placeholder="e.g. Wrong weight entered for Fine Leaf bag 2"
                className="w-full px-3 py-2.5 rounded-xl border border-warn/30 bg-white text-[13px] text-text outline-none focus:border-warn resize-none"
              />
              <div className="flex gap-2">
                <button onClick={() => { setShowCorrect(false); setCorrectReason('') }} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-[13px] font-medium text-stone-500 hover:bg-stone-50">Cancel</button>
                <button onClick={handleCorrection} disabled={!correctReason.trim() || correcting} className="flex-1 py-2.5 rounded-xl bg-warn text-white text-[13px] font-medium disabled:opacity-40">
                  {correcting ? 'Unlocking…' : 'Confirm — unlock for editing'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {locked && (
        <div className="flex items-center gap-3 px-5 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
          <Lock size={20} className="text-ok" />
          <span className="font-semibold text-[14px] text-ok">Session signed off and locked.</span>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ROW BUILDERS — convert form component state → structured DB rows
// ═════════════════════════════════════════════════════════════════════════════

function buildDebagRows(sectionId: string, formData: any, sid: string): any[] {
  const rows: any[] = []
  if (sectionId === 'sieving' && formData.debag) {
    formData.debag.forEach((r: any, i: number) => {
      if (!r.mass_nett || num(r.mass_nett) === 0) return
      rows.push({
        session_id: sid, bag_no: i + 1,
        bag_serial_no:  r.bag_number || null,
        lot_number:     r.lot_serial || null,
        product_type:   r.local_export || null,
        variant:        normaliseVariant(r.org_conv) || null,
        kg_gross:       num(r.mass_gross) || null,
        kg_nett:        num(r.mass_nett),
        delivery_date:  r.delivery_date || null,
        local_or_export: r.local_export || null,
        org_or_conv:    r.org_conv || null,
        is_spillage:    i < 2,
      })
    })
  }
  if ((sectionId === 'refining1' || sectionId === 'refining2') && formData.debag) {
    formData.debag.forEach((r: any, i: number) => {
      if (!r.qty || num(r.qty) === 0) return
      rows.push({
        session_id: sid, bag_no: i + 1,
        bag_serial_no: r.serial || null,
        product_type:  r.grade || null,
        variant:       normaliseVariant(r.con_org) || null,
        kg_nett:       num(r.qty),
        delivery_date: r.date || null,
        is_spillage:   false,
      })
    })
  }
  if (sectionId === 'blender') {
    const inputs = [
      { key: 'rowsA', type: 'Sieved Fine Leaf' }, { key: 'rowsB', type: 'Sieved Coarse Leaf' },
      { key: 'rowsC', type: 'Blocks Clean' },     { key: 'rowsD', type: 'Blocks Cut' },
      { key: 'rowsE', type: formData.other1Label || 'Other 1' },
      { key: 'rowsF', type: formData.other2Label || 'Other 2' },
    ]
    let seq = 1
    inputs.forEach(({ key, type }) => {
      ;(formData[key] ?? []).forEach((r: any) => {
        if (!r.kg || num(r.kg) === 0) return
        rows.push({ session_id: sid, bag_no: seq++, lot_number: r.lot || null, bag_serial_no: r.serial || null, product_type: type, kg_nett: num(r.kg), is_spillage: false })
      })
    })
  }
  if (sectionId === 'pasteuriser') {
    const all = [...(formData.debag?.debagRows ?? []), ...(formData.debag?.postSieveRows ?? [])]
    all.forEach((r: any, i: number) => {
      if (!r.kg || num(r.kg) === 0) return
      rows.push({
        session_id: sid, bag_no: i + 1,
        bag_serial_no: r.serial || null,
        lot_number:    r.lot || null,
        product_type:  r.product_type || null,
        variant:       normaliseVariant(formData.debag?.variantCode) || null,
        kg_nett:       num(r.kg),
        is_spillage:   false,
      })
    })
  }
  return rows
}

function buildBagRows(sectionId: string, formData: any, sid: string): any[] {
  const rows: any[] = []
  if (sectionId === 'sieving') {
    let seq = 1
    const streams = [
      { bags: formData.flBags ?? [], type: 'Fine Leaf' },
      { bags: formData.clBags ?? [], type: 'Coarse Leaf' },
    ]
    streams.forEach(({ bags, type }) => {
      bags.forEach((b: any) => {
        if (!b.kg || num(b.kg) === 0) return
        rows.push({ session_id: sid, bag_no: seq++, bag_serial_no: b.serial || null, lot_number: b.batch || null, product_type: type, kg: num(b.kg), bagging_time: b.time || null })
      })
    })
  }
  if (sectionId === 'refining1') {
    let seq = 1
    ;[{ rows: formData.out1 ?? [], g: 'B' }, { rows: formData.out2 ?? [], g: 'C' }, { rows: formData.out3 ?? [], g: 'D' }].forEach(({ rows: gr, g }) => {
      gr.forEach((r: any) => {
        if (!r.qty || num(r.qty) === 0) return
        rows.push({ session_id: sid, bag_no: seq++, output_group: g, bag_serial_no: r.serial || null, product_type: r.name || null, kg: num(r.qty) })
      })
    })
  }
  if (sectionId === 'refining2') {
    let seq = 1
    ;[
      { rows: formData.rowsA ?? [], type: 'Cut Heavy Stick Fine',   g: 'B' },
      { rows: formData.rowsB ?? [], type: 'Cut Heavy Stick Coarse', g: 'C' },
      { rows: formData.rowsC ?? [], type: 'White Dust',             g: 'D' },
      { rows: formData.rowsD ?? [], type: 'Powder Dust',            g: 'D' },
    ].forEach(({ rows: gr, type, g }) => {
      gr.forEach((r: any) => {
        if (!r.qty || num(r.qty) === 0) return
        rows.push({ session_id: sid, bag_no: seq++, output_group: g, bag_serial_no: r.serial || null, lot_number: r.lot || null, product_type: type, kg: num(r.qty) })
      })
    })
  }
  if (sectionId === 'blender' && formData.bagRows) {
    formData.bagRows.forEach((r: any, i: number) => {
      if (!r.kg || num(r.kg) === 0) return
      rows.push({ session_id: sid, bag_no: i + 1, bag_serial_no: r.serial_no || null, lot_number: formData.lotNo || null, product_type: r.blend_type || formData.blendCode || null, kg: num(r.kg), bagging_time: r.time || null })
    })
  }
  if (sectionId === 'granule' && formData.bagRows) {
    formData.bagRows.forEach((r: any, i: number) => {
      const kg = num(r.total_weight)
      if (kg === 0) return
      rows.push({ session_id: sid, bag_no: i + 1, bag_serial_no: r.serial_numbers || null, lot_number: r.lot_number || null, product_type: r.item || null, kg })
    })
  }
  if (sectionId === 'pasteuriser' && formData.bagging?.bagRows) {
    formData.bagging.bagRows.forEach((r: any, i: number) => {
      const kg = num(r.total_weight)
      if (kg === 0) return
      rows.push({ session_id: sid, bag_no: i + 1, bag_serial_no: r.start_bag || null, lot_number: r.lot || null, product_type: r.item || null, kg, bagging_time: r.start_time || null })
    })
  }
  return rows
}

// Derive mass balance totals from form data
function getMassBalance(sectionId: string, formData: any) {
  const productions: any[] = formData.productions?.map((p: any) => p.data || p).filter(Boolean) ?? [formData]

  let totalIn = 0, totalB = 0, totalC = 0, totalD = 0

  if (sectionId === 'pasteuriser') {
    totalIn = [...(formData.debag?.debagRows ?? []), ...(formData.debag?.postSieveRows ?? [])].reduce((s: number, r: any) => s + num(r.kg), 0)
    totalB  = (formData.bagging?.bagRows ?? []).reduce((s: number, r: any) => s + num(r.total_weight), 0)
  } else if (sectionId === 'refining1') {
    totalIn = (formData.debag ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    totalB  = (formData.out1 ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    totalC  = (formData.out2 ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    totalD  = (formData.out3 ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
  } else if (sectionId === 'refining2') {
    totalIn = (formData.debag ?? []).reduce((s: number, r: any) => s + num(r.qty), 0)
    const groups = ['rowsA', 'rowsB', 'rowsC', 'rowsD']
    totalB = groups.reduce((s, k) => s + (formData[k] ?? []).reduce((ss: number, r: any) => ss + num(r.qty), 0), 0)
  } else {
    totalIn = productions.reduce((s, p) => s + (p?.totalA ?? p?.totalIn ?? 0), 0)
    totalB  = productions.reduce((s, p) => s + (p?.totalOut ?? p?.totalOutput ?? 0), 0)
  }

  return { totalIn, totalB, totalC, totalD }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN INNER COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
function SectionCaptureInner() {
  const sp     = useSearchParams()
  const router = useRouter()
  const { user, role } = useAuth()

  const sectionId  = sp.get('id')    ?? ''
  const shift      = sp.get('shift') ?? 'morning'
  const dateParam  = sp.get('date')  ?? format(new Date(), 'yyyy-MM-dd')

  const meta = SECTION_META[sectionId]

  const [activeTab,     setActiveTab]     = useState<Tab>('timesheet')
  const [sessionId,     setSessionId]     = useState<string | null>(null)
  const [sessionStatus, setStatus]        = useState<'new' | 'draft' | 'submitted' | 'approved'>('new')
  const [formData,      setFormData]      = useState<any>({})
  const [savedData,     setSavedData]     = useState<any>(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [submitting,    setSubmitting]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [cleaningDone,  setCleaningDone]  = useState(0)
  const [cleaningTotal, setCleaningTotal] = useState(0)

  // Refs for stable closures in event listeners / timers
  const formDataRef  = React.useRef<any>({})
  const sessionIdRef = React.useRef<string | null>(null)
  formDataRef.current  = formData
  sessionIdRef.current = sessionId

  // ── Load existing session ───────────────────────────────────────────────
  useEffect(() => {
    if (!sectionId) { setLoading(false); return }
    async function load() {
      const { data } = await getDb().schema('production').from('prod_sessions')
        .select('id,status,draft_data,op_signed,sup_signed')
        .eq('section_id', sectionId).eq('date', dateParam).eq('shift', shift)
        .maybeSingle()
      if (data) {
        setSessionId((data as any).id)
        setStatus((data as any).status)
        const draft = (data as any).draft_data
        if (draft && typeof draft === 'object' && Object.keys(draft).length > 0) {
          setFormData(draft)
          setSavedData(draft)
        }
        if ((data as any).status === 'draft') setActiveTab('production')
      }
      setLoading(false)
    }
    load()
  }, [sectionId, dateParam, shift])

  // ── Auto-save on visibility change / page hide ──────────────────────────
  useEffect(() => {
    function onHide() {
      const fd  = formDataRef.current
      const sid = sessionIdRef.current
      if (!sid || Object.keys(fd).length === 0) return
      getDb().schema('production').from('prod_sessions')
        .update({ draft_data: fd, updated_at: new Date().toISOString() } as any)
        .eq('id', sid).then(() => {}).catch(() => {})
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  // ── Auto-save every 30 s ────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const fd  = formDataRef.current
      const sid = sessionIdRef.current
      if (!sid || Object.keys(fd).length === 0) return
      getDb().schema('production').from('prod_sessions')
        .update({ draft_data: fd, updated_at: new Date().toISOString() } as any)
        .eq('id', sid).catch(() => {})
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  // ── Create session row if it doesn't exist ──────────────────────────────
  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId
    const { data, error } = await getDb().schema('production').from('prod_sessions')
      .insert({
        section_id: sectionId,
        date:       dateParam,
        shift,
        status:     'draft',
        created_by: user?.id ?? null,
      } as any)
      .select('id').single()
    if (error) throw new Error(error.message)
    const id = (data as any).id
    setSessionId(id)
    return id
  }

  // ── Save draft ─────────────────────────────────────────────────────────
  async function saveDraft() {
    setSaving(true)
    setError(null)
    try {
      const sid = await ensureSession()
      const fd  = formDataRef.current
      const productions: any[] = fd.productions?.map((p: any) => p.data || p).filter(Boolean) ?? [fd]

      // Extract metadata from form state
      const operatorNamesText = fd.shiftOps || fd.operators || fd.op1 || fd.debag?.operators || ''
      const operatorNames = operatorNamesText
        .split(/[,/;]+/).map((n: string) => n.trim()).filter(Boolean)

      const sessionMeta = {
        status:          'draft',
        draft_data:      fd,
        operator_names:  operatorNames.length > 0 ? operatorNames : null,
        supervisor_name: fd.supervisor || fd.mbSupervisor || fd.bagging?.supervisor || null,
        lot_number:      fd.lotNo || fd.lotNumber || fd.bagging?.lotNumber || fd.daily?.batchNumber || null,
        variant:         normaliseVariant(fd.variantCode || fd.debag?.[0]?.org_conv) || null,
        production_orders: productions
          .map((p: any) => p?.prodOrderId || p?.blendCode || null)
          .filter(Boolean),
        comments:        fd.comments || fd.bagging?.comments || null,
        updated_at:      new Date().toISOString(),
      }

      await getDb().schema('production').from('prod_sessions')
        .update(sessionMeta as any).eq('id', sid)

      // ── Debagging rows ────────────────────────────────────────────────
      const debagRows = buildDebagRows(sectionId, fd, sid)
      if (debagRows.length > 0) {
        await getDb().schema('production').from('prod_debagging').delete().eq('session_id', sid)
        await getDb().schema('production').from('prod_debagging').insert(debagRows as any)
      }

      // ── Bagging rows ──────────────────────────────────────────────────
      const bagRows = buildBagRows(sectionId, fd, sid)
      if (bagRows.length > 0) {
        await getDb().schema('production').from('prod_bagging').delete().eq('session_id', sid)
        await getDb().schema('production').from('prod_bagging').insert(bagRows as any)
      }

      // ── Mass balance ──────────────────────────────────────────────────
      const { totalIn, totalB, totalC, totalD } = getMassBalance(sectionId, fd)
      await getDb().schema('production').from('prod_mass_balance').upsert({
        session_id:        sid,
        total_input_kg:    totalIn,
        total_output_b_kg: totalB,
        total_output_c_kg: totalC,
        total_output_d_kg: totalD,
        calculated_at:     new Date().toISOString(),
      } as any, { onConflict: 'session_id' })

      // ── Bag tags — output serials ─────────────────────────────────────
      for (const row of bagRows) {
        if (!row.bag_serial_no) continue
        const vSuffix = variantSuffix(sessionMeta.variant as any)
        await getDb().schema('production').from('bag_tags').upsert({
          serial_number:  row.bag_serial_no,
          section_id:     sectionId,
          session_id:     sid,
          product_type:   row.product_type || 'Unknown',
          variant:        sessionMeta.variant || null,
          weight_kg:      row.kg,
          lot_number:     row.lot_number || sessionMeta.lot_number || null,
          status:         'in_stock',
          consumed:       false,
          created_by:     user?.id ?? null,
        } as any, { onConflict: 'serial_number' })
      }

      // ── Mark input bags consumed ──────────────────────────────────────
      const inputSerials: { serial: string; kg?: number }[] = []
      if (sectionId === 'sieving') {
        ;(fd.debag ?? []).forEach((r: any) => { if (r.bag_number) inputSerials.push({ serial: r.bag_number, kg: num(r.mass_nett) || undefined }) })
      } else if (sectionId === 'refining1' || sectionId === 'refining2') {
        ;(fd.debag ?? []).forEach((r: any) => { if (r.serial) inputSerials.push({ serial: r.serial, kg: num(r.qty) || undefined }) })
      } else if (sectionId === 'blender') {
        ;['rowsA', 'rowsB', 'rowsC', 'rowsD', 'rowsE', 'rowsF'].forEach(k => {
          ;(fd[k] ?? []).forEach((r: any) => { if (r.serial) inputSerials.push({ serial: r.serial, kg: num(r.kg) || undefined }) })
        })
      } else if (sectionId === 'pasteuriser') {
        ;[...(fd.debag?.debagRows ?? []), ...(fd.debag?.postSieveRows ?? [])].forEach((r: any) => {
          if (r.serial) inputSerials.push({ serial: r.serial, kg: num(r.kg) || undefined })
        })
      }
      Promise.all(inputSerials.map(({ serial, kg }) => markBagConsumed(serial, sectionId, sid, kg, user?.id))).catch(() => {})

      setStatus('draft')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e.message)
    }
    setSaving(false)
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    await saveDraft()
    setSubmitting(true)
    try {
      const sid = await ensureSession()
      await getDb().schema('production').from('prod_sessions').update({
        status:       'submitted',
        submitted_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      } as any).eq('id', sid)
      setStatus('submitted')
    } catch (e: any) { setError(e.message) }
    setSubmitting(false)
  }

  // ── Approve ────────────────────────────────────────────────────────────
  async function handleApprove() {
    setSubmitting(true)
    try {
      await getDb().schema('production').from('prod_sessions').update({
        status:     'approved',
        updated_at: new Date().toISOString(),
      } as any).eq('id', sessionId)
      setStatus('approved')
    } catch (e: any) { setError(e.message) }
    setSubmitting(false)
  }

  // ── Request correction ─────────────────────────────────────────────────
  async function handleRequestCorrection(reason: string) {
    try {
      await getDb().schema('production').from('prod_sessions').update({
        status:     'draft',
        comments:   reason,
        updated_at: new Date().toISOString(),
      } as any).eq('id', sessionId)
      setStatus('draft')
    } catch (e: any) { setError(e.message) }
  }

  const locked = sessionStatus === 'approved'

  // Mass balance for status strip
  const { totalIn, totalB, totalC, totalD } = getMassBalance(sectionId, formData)
  const variance    = totalIn - totalB - totalC - totalD
  const withinTol   = Math.abs(variance) <= 15
  const showBalance = totalIn > 0

  if (!sectionId || !meta) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-3">
        <p className="text-[13px] text-err">No section selected.</p>
        <button onClick={() => router.back()} className="text-[12px] text-brand hover:underline">← Go back</button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  const statusLabel = sessionStatus === 'approved' ? 'Signed off' : sessionStatus === 'submitted' ? 'Awaiting sign-off' : sessionStatus === 'draft' ? 'Draft' : 'New'
  const statusColor = sessionStatus === 'approved' ? 'bg-ok/10 text-ok' : sessionStatus === 'submitted' ? 'bg-info/10 text-info' : sessionStatus === 'draft' ? 'bg-warn/10 text-warn' : 'bg-stone-100 text-stone-500'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 flex-shrink-0">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-stone-100 transition-colors text-stone-400">
          <ChevronLeft size={18} />
        </button>
        <div className={`w-9 h-9 rounded-xl ${meta.color} flex items-center justify-center shrink-0`}>
          <span className="font-mono font-bold text-[11px] text-white">{meta.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-[20px] text-text leading-tight">{meta.name}</h1>
          <p className="text-[11px] text-text-muted capitalize">
            {shift} shift · {format(parseISO(dateParam + 'T12:00:00'), 'd MMM yyyy')}
          </p>
        </div>
        <span className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg shrink-0 ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* ── Mass balance strip (shown once data is entered) ─────────────── */}
      {showBalance && (
        <div className={`flex items-center gap-3 mx-4 mb-2 px-4 py-2.5 rounded-xl border text-[12px] font-mono ${withinTol ? 'bg-ok/5 border-ok/20 text-ok' : 'bg-warn/10 border-warn/30 text-warn font-bold'}`}>
          {!withinTol && <AlertTriangle size={13} className="shrink-0" />}
          <span>In: {totalIn.toFixed(1)} kg</span>
          <span className="text-stone-400">·</span>
          <span>Out: {(totalB + totalC + totalD).toFixed(1)} kg</span>
          <span className="text-stone-400">·</span>
          <span>Var: {variance > 0 ? '+' : ''}{variance.toFixed(1)} kg</span>
          {!withinTol && <span className="ml-1">— review before submitting</span>}
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="flex border-b border-stone-200 px-4 flex-shrink-0 bg-white">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-3 font-medium text-[13px] border-b-2 transition-colors ${activeTab === tab.id ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-700'}`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-surface)' }}>
        <div className="px-4 py-5 max-w-[800px] space-y-5">

          {activeTab === 'timesheet' && (
            <TimesheetTab locked={locked} sectionId={sectionId} dateParam={dateParam} shift={shift} />
          )}

          {activeTab === 'production' && (
            <>
              {sectionId === 'sieving' && (
                <MultiProductionWrapper
                  sectionId="sieving" locked={locked}
                  onData={setFormData} savedData={savedData}
                  FormComponent={SievingFormWrapper}
                  extraProps={{ shift, sessionId, dateParam }}
                  getTabLabel={(data: any, i: number) => {
                    if (!data?.prodOrderId) return `Production ${i + 1}`
                    return `${i + 1}: ${data.prodOrderId.split(' — ')[0]}`
                  }}
                />
              )}
              {sectionId === 'refining1' && (
                <RefiningForm sectionId={sectionId} locked={locked} onData={setFormData} savedData={savedData} />
              )}
              {sectionId === 'refining2' && (
                <Refining2Form locked={locked} onData={setFormData} savedData={savedData} />
              )}
              {sectionId === 'granule' && (
                <MultiProductionWrapper
                  sectionId="granule" locked={locked}
                  onData={setFormData} savedData={savedData}
                  FormComponent={GranuleForm}
                  getTabLabel={(data: any, i: number) => {
                    const item = data?.bagRows?.[0]?.item || ''
                    return item ? `${i + 1}: ${item.split(' — ')[0]}` : `Production ${i + 1}`
                  }}
                />
              )}
              {sectionId === 'blender' && (
                <MultiBlenderForm locked={locked} onData={setFormData} savedData={savedData} />
              )}
              {sectionId === 'pasteuriser' && (
                <MultiProductionWrapper
                  sectionId="pasteuriser" locked={locked}
                  onData={setFormData} savedData={savedData}
                  FormComponent={PasteuriseurFormWrapper}
                  extraProps={{ sessionId, dateParam, shift }}
                  getTabLabel={(data: any, i: number) =>
                    data?.batchNumber ? `${i + 1}: ${data.batchNumber}` : `Production ${i + 1}`
                  }
                />
              )}

              {!locked && (
                <button
                  onClick={saveDraft} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors"
                >
                  {saving  ? <Loader2 size={15} className="animate-spin" /> :
                   saved   ? <CheckCircle2 size={15} className="text-ok" /> : null}
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
                </button>
              )}
            </>
          )}

          {activeTab === 'cleaning' && (
            <CleaningTab
              sectionId={sectionId} locked={locked}
              onProgress={(d, t) => { setCleaningDone(d); setCleaningTotal(t) }}
            />
          )}

          {activeTab === 'signoff' && (
            <SignOffTab
              sessionId={sessionId}
              locked={locked}
              sessionStatus={sessionStatus}
              onSubmit={handleSubmit}
              onApprove={handleApprove}
              onRequestCorrection={handleRequestCorrection}
              submitting={submitting}
              role={role}
              sectionId={sectionId}
              formData={formData}
              dateParam={dateParam}
              shift={shift}
            />
          )}

          {error && (
            <p className="text-[12px] text-err px-1">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page wrapper with Suspense (required for useSearchParams) ─────────────────
export default function SectionCapturePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    }>
      <SectionCaptureInner />
    </Suspense>
  )
}
