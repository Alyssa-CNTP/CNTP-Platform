'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, GraduationCap, Users2, ClipboardCheck, BarChart3, UserCheck2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useMyEmployee } from '@/lib/training/use-my-employee'
import { CourseCard, type CourseListItem } from '@/components/training/CourseCard'
import { PinSwitchModal } from '@/components/training/PinSwitchModal'

export default function TrainingHomePage() {
  const { userId, p, displayName } = useAuth()
  const { employeeId: myEmployeeId, employeeName: myName, loading: employeeLoading } = useMyEmployee(userId)

  const [activeEmployeeId, setActiveEmployeeId] = useState<string | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [showSwitch, setShowSwitch] = useState(false)
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!employeeLoading && !activeEmployeeId) { setActiveEmployeeId(myEmployeeId); setActiveName(myName) }
  }, [employeeLoading, myEmployeeId, myName, activeEmployeeId])

  useEffect(() => {
    if (!activeEmployeeId) { setLoading(false); return }
    setLoading(true)
    fetch(`/api/training/courses?employeeId=${activeEmployeeId}`)
      .then(r => r.json())
      .then(d => setCourses(d.courses ?? []))
      .finally(() => setLoading(false))
  }, [activeEmployeeId])

  const canManage = p('can_author_training') || p('can_assign_training') || p('can_manage_competencies') || p('can_view_all_competency')

  const assigned   = courses.filter(c => c.assignment)
  const available  = courses.filter(c => !c.assignment)

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2">
            <GraduationCap size={20} className="text-brand" /> Training
          </h1>
          <p className="text-[12px] text-text-muted mt-1">
            {activeEmployeeId === myEmployeeId
              ? `Signed in as ${displayName}`
              : <>Taking training as <span className="font-medium text-text">{activeName}</span> · <button onClick={() => { setActiveEmployeeId(myEmployeeId); setActiveName(myName) }} className="text-brand hover:underline">switch back</button></>}
          </p>
        </div>
        <button onClick={() => setShowSwitch(true)}
          className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand border border-stone-200 rounded-xl px-3 py-2 transition-colors shrink-0">
          <UserCheck2 size={13} /> Take training as someone else
        </button>
      </div>

      {canManage && (
        <div className="flex items-center gap-2 flex-wrap">
          {(p('can_author_training')) && (
            <Link href="/training/manage" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand border border-brand/20 bg-brand/8 rounded-xl px-3 py-2 hover:bg-brand/12 transition-colors">
              <GraduationCap size={13} /> Manage courses
            </Link>
          )}
          {(p('can_assign_training')) && (
            <Link href="/training/manage/assignments" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted border border-stone-200 rounded-xl px-3 py-2 hover:border-stone-300 transition-colors">
              <Users2 size={13} /> Assignments
            </Link>
          )}
          {(p('can_manage_competencies')) && (
            <>
              <Link href="/training/manage/review" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted border border-stone-200 rounded-xl px-3 py-2 hover:border-stone-300 transition-colors">
                <ClipboardCheck size={13} /> Review queue
              </Link>
              <Link href="/training/signoff" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted border border-stone-200 rounded-xl px-3 py-2 hover:border-stone-300 transition-colors">
                <UserCheck2 size={13} /> Practical sign-off
              </Link>
            </>
          )}
          {(p('can_view_all_competency')) && (
            <Link href="/training/competency" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted border border-stone-200 rounded-xl px-3 py-2 hover:border-stone-300 transition-colors">
              <BarChart3 size={13} /> Competency dashboard
            </Link>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
      ) : !activeEmployeeId ? (
        <div className="bg-surface-card border border-surface-rule rounded-2xl p-6 text-center text-[13px] text-text-muted">
          Your account isn't linked to a Staff Directory profile yet — ask your supervisor to link it, or use "Take training as someone else" on a shared tablet.
        </div>
      ) : (
        <>
          {assigned.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Assigned to you</h2>
              <div className="space-y-2">{assigned.map(c => <CourseCard key={c.id} course={c} employeeId={activeEmployeeId} />)}</div>
            </div>
          )}
          <div className="space-y-2">
            <h2 className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
              {assigned.length > 0 ? 'Other available courses' : 'Available courses'}
            </h2>
            {available.length === 0 ? (
              <p className="text-[12px] text-text-muted py-4">No other courses available right now.</p>
            ) : (
              <div className="space-y-2">{available.map(c => <CourseCard key={c.id} course={c} employeeId={activeEmployeeId} />)}</div>
            )}
          </div>
        </>
      )}

      {showSwitch && (
        <PinSwitchModal
          onClose={() => setShowSwitch(false)}
          onSwitched={(id, name, pin) => {
            try { sessionStorage.setItem(`training_pin_${id}`, pin) } catch { /* ignore */ }
            setActiveEmployeeId(id); setActiveName(name); setShowSwitch(false)
          }}
        />
      )}
    </div>
  )
}
