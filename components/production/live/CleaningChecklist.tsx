'use client'
// CleaningChecklist — section-specific cleaning tasks for the live capture page.
// Tasks sourced from Production Capture Fields HTML and existing section/page.tsx.

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle2 } from 'lucide-react'

// ── Tasks per section ─────────────────────────────────────────────────────────
const TASKS: Record<string, { area: string; task: string; responsible: string }[]> = {
  sieving: [
    { area: 'De-bagging',      task: 'Check and clean rotary valve',                                responsible: 'Operator' },
    { area: 'De-bagging',      task: 'Vacuum walls and floor',                                      responsible: 'Operator / General cleaner' },
    { area: 'De-bagging',      task: 'Sweep spillages',                                             responsible: 'General cleaner' },
    { area: 'Sieving',         task: 'Vacuum walls and floor',                                      responsible: 'Operator / General cleaner' },
    { area: 'Sieving',         task: 'Brush sieves (every 2 hrs)',                                  responsible: 'Operator' },
    { area: 'Sieving',         task: 'Brush off aspirator',                                         responsible: 'Operator' },
    { area: 'Sieving',         task: 'Clean magnet',                                                responsible: 'Operator' },
    { area: 'Sieving',         task: 'Brush off dust on bell conveyors',                            responsible: 'Operator' },
    { area: 'Sieving',         task: 'Brush off dust on screw conveyor',                            responsible: 'Operator' },
    { area: 'Sieving',         task: 'Brush off excess tea on rolsif + wipe magnet',                responsible: 'Operator' },
    { area: 'Sieving',         task: 'Brush down screen with telescopic handle and vacuum up dust', responsible: 'Operator' },
    { area: 'Sieving',         task: 'Check and clean rotary valve',                                responsible: 'Operator' },
    { area: 'Dust Collection', task: 'Brush crevices and hard to reach areas',                      responsible: 'General cleaner' },
    { area: 'Dust Collection', task: 'Vacuum walls and floors',                                     responsible: 'General cleaner' },
    { area: 'Dust Collection', task: 'Bag filters removed and changed (Rooibos ↔ Honeybush)',        responsible: 'General cleaner' },
  ],
  refining1: [
    { area: 'De-bagging', task: 'Check and clean rotary valve',                              responsible: 'Operator' },
    { area: 'De-bagging', task: 'Vacuum walls and floor',                                    responsible: 'Operator / General cleaner' },
    { area: 'De-bagging', task: 'Sweep spillages',                                           responsible: 'General cleaner' },
    { area: 'Post-sieve', task: 'Clean sieves — brush off excess tea leaves and dust',       responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Remove foreign material from magnet and record on form',    responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Brush down screw conveyors and chute',                      responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Vacuum walls and floors',                                   responsible: 'Operator / General cleaner' },
    { area: 'Bagging',    task: 'Wipe surfaces on conveyor chute with disposable cloth',     responsible: 'Bagging operator' },
    { area: 'Bagging',    task: 'Brush down bagging machine',                                responsible: 'Bagging operator' },
    { area: 'Bagging',    task: 'Brush down small conveyor',                                 responsible: 'Bagging operator' },
    { area: 'Bagging',    task: 'Vacuum internal walls and floor',                           responsible: 'General cleaner' },
    { area: 'Bagging',    task: 'Lift scale and vacuum or sweep tea underneath daily',       responsible: 'Bagging operator' },
  ],
  refining2: [
    { area: 'De-bagging', task: 'Check and clean rotary valve',                              responsible: 'Operator' },
    { area: 'De-bagging', task: 'Vacuum walls and floor',                                    responsible: 'Operator / General cleaner' },
    { area: 'De-bagging', task: 'Sweep spillages',                                           responsible: 'General cleaner' },
    { area: 'Post-sieve', task: 'Clean sieves — brush off excess tea leaves and dust',       responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Remove foreign material from magnet and record on form',    responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Brush down screw conveyors and chute',                      responsible: 'Operator' },
    { area: 'Post-sieve', task: 'Vacuum walls and floors',                                   responsible: 'Operator / General cleaner' },
    { area: 'Bagging',    task: 'Wipe surfaces on conveyor chute with disposable cloth',     responsible: 'Bagging operator' },
    { area: 'Bagging',    task: 'Brush down bagging machine',                                responsible: 'Bagging operator' },
    { area: 'Bagging',    task: 'Vacuum internal walls and floor',                           responsible: 'General cleaner' },
    { area: 'Bagging',    task: 'Lift scale and vacuum or sweep tea underneath daily',       responsible: 'Bagging operator' },
  ],
  granule: [
    { area: 'Granule Line', task: 'Vacuum walls and floor',                                  responsible: 'Operator / General cleaner' },
    { area: 'Granule Line', task: 'Brush off all dust on equipment surfaces',                responsible: 'Operator' },
    { area: 'Granule Line', task: 'Check and clean rotary valve',                            responsible: 'Operator' },
    { area: 'Bagging',      task: 'Wipe surfaces on conveyor chute',                         responsible: 'Bagging operator' },
    { area: 'Bagging',      task: 'Brush down bagging machine',                              responsible: 'Bagging operator' },
    { area: 'Bagging',      task: 'Vacuum internal walls and floor',                         responsible: 'General cleaner' },
    { area: 'Bagging',      task: 'Check and clean scale',                                   responsible: 'Bagging operator' },
  ],
  blender: [
    { area: 'Blender', task: 'Vacuum walls and floor',                                       responsible: 'Operator / General cleaner' },
    { area: 'Blender', task: 'After mini-blender: brush, vacuum and disinfect',              responsible: 'Operator' },
    { area: 'Bagging', task: 'Wipe surfaces on conveyor chute with disposable cloth',        responsible: 'Bagging operator' },
    { area: 'Bagging', task: 'Brush down bagging machine',                                   responsible: 'Bagging operator' },
    { area: 'Bagging', task: 'Vacuum internal walls and floor',                              responsible: 'General cleaner' },
    { area: 'Bagging', task: 'Check and clean scale',                                        responsible: 'Bagging operator' },
  ],
  smallblender: [
    { area: 'Blender', task: 'Vacuum walls and floor',                                       responsible: 'Operator / General cleaner' },
    { area: 'Blender', task: 'Brush, vacuum and disinfect after use',                        responsible: 'Operator' },
    { area: 'Bagging', task: 'Wipe surfaces on conveyor chute with disposable cloth',        responsible: 'Bagging operator' },
    { area: 'Bagging', task: 'Check and clean scale',                                        responsible: 'Bagging operator' },
  ],
  pasteuriser: [
    { area: 'Pasteuriser', task: 'Clean per PPM 13.4',                                       responsible: 'Operator / General worker' },
    { area: 'Pasteuriser', task: 'Vacuum dust and leaves from walls and floors',             responsible: 'Operator / General worker' },
    { area: 'Drying',      task: 'Remove funnel at dryer feed and wipe with disposable cloth', responsible: 'Operator / General worker' },
    { area: 'Drying',      task: 'Remove all hatches, brush and vacuum inside dryer',        responsible: 'Operator / General worker' },
    { area: 'Drying',      task: 'Brush down screw conveyor and chute',                      responsible: 'Operator / General worker' },
    { area: 'Drying',      task: 'Vacuum walls and floors',                                  responsible: 'Operator / General worker' },
    { area: 'Bagging',     task: 'Wipe surfaces on conveyor chute with disposable cloth',    responsible: 'Bagging operator' },
    { area: 'Bagging',     task: 'Brush down bagging machine',                               responsible: 'Bagging operator' },
    { area: 'Bagging',     task: 'Vacuum internal walls and floor',                          responsible: 'General cleaner' },
    { area: 'Bagging',     task: 'Check and clean scale',                                    responsible: 'Bagging operator' },
  ],
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CleanTask {
  id:           string
  area:         string
  task:         string
  responsible:  string
  done:         boolean
  doneAt:       string
  operatorName: string
}

interface Props {
  sectionId:   string
  locked:      boolean
  onProgress?: (done: number, total: number) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CleaningChecklist({ sectionId, locked, onProgress }: Props) {
  const [tasks, setTasks] = useState<CleanTask[]>(() =>
    (TASKS[sectionId] ?? []).map((t, i) => ({
      ...t,
      id:           `clean-${i}`,
      done:         false,
      doneAt:       '',
      operatorName: '',
    }))
  )

  // Report progress whenever tasks change
  const reportProgress = useCallback((ts: CleanTask[]) => {
    const done  = ts.filter(t => t.done).length
    onProgress?.(done, ts.length)
  }, [onProgress])

  useEffect(() => { reportProgress(tasks) }, [tasks, reportProgress])

  function toggle(id: string) {
    if (locked) return
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowDone = !t.done
      // Use a simple HH:MM string — avoids new Date() in workflow scripts
      const now = window.performance ? new window.Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      return { ...t, done: nowDone, doneAt: nowDone ? now : '' }
    }))
  }

  function setName(id: string, name: string) {
    if (locked) return
    setTasks(prev => prev.map(t => t.id === id ? { ...t, operatorName: name } : t))
  }

  const done  = tasks.filter(t => t.done).length
  const total = tasks.length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0
  const areas = [...new Set(tasks.map(t => t.area))]

  if (total === 0) return (
    <div className="text-center py-12 text-stone-400 text-[14px]">
      No cleaning tasks defined for this section yet.
    </div>
  )

  return (
    <div className="space-y-4">

      {/* Progress card */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-[15px] text-stone-700">Cleaning progress</span>
          <span className="font-mono font-bold text-[20px] text-brand">{done}/{total}</span>
        </div>
        <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#1A3A0E' }}
          />
        </div>
        {pct === 100 && (
          <div className="flex items-center gap-2 mt-2.5">
            <CheckCircle2 size={15} className="text-ok"/>
            <span className="text-[13px] text-ok font-medium">All cleaning tasks completed</span>
          </div>
        )}
      </div>

      {/* Task groups by area */}
      {areas.map(area => (
        <div key={area} className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
            <span className="font-semibold text-[13px] text-stone-600 uppercase tracking-wide">{area}</span>
          </div>
          <div className="divide-y divide-stone-100">
            {tasks.filter(t => t.area === area).map(task => (
              <div key={task.id} className={`px-4 py-4 transition-colors ${task.done ? 'bg-ok/4' : ''}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(task.id)}
                    disabled={locked}
                    className={`mt-0.5 w-7 h-7 rounded-xl border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      task.done ? 'bg-ok border-ok' : 'border-stone-300 bg-white'
                    } ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer active:scale-95'}`}
                  >
                    {task.done && <CheckCircle2 size={15} className="text-white"/>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] leading-snug ${task.done ? 'text-ok line-through opacity-70' : 'text-text'}`}>
                      {task.task}
                    </p>
                    <p className="text-[12px] text-stone-400 mt-0.5">{task.responsible}</p>
                    {task.done && (
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        <span className="font-mono text-[12px] text-ok font-medium">{task.doneAt}</span>
                        <input
                          value={task.operatorName}
                          onChange={e => setName(task.id, e.target.value)}
                          disabled={locked}
                          placeholder="Your name"
                          className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-ok/30 bg-ok/5 text-[13px] text-ok outline-none focus:border-ok min-h-[40px]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
