'use client'

import Link from 'next/link'
import { ArrowLeft, GraduationCap, Users2, ClipboardCheck, BarChart3, UserCheck2, BookOpenCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { HubCard, LockedCard } from '@/components/hr/HubCard'

export default function TrainingHubPage() {
  const { p } = useAuth()

  const canAuthor    = p('can_author_training')
  const canAssign    = p('can_assign_training')
  const canManageComp = p('can_manage_competencies')
  const canViewAll   = p('can_view_all_competency')

  return (
    <div className="px-4 py-6 max-w-[820px] mx-auto space-y-5">
      <Link href="/hr" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-brand">
        <ArrowLeft size={13} /> HR
      </Link>

      <div>
        <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2">
          <GraduationCap size={20} className="text-brand" /> Training
        </h1>
        <p className="text-[12px] text-text-muted mt-1">Video lessons and digital assessments — every course auto-updates the Skills Matrix on a pass.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <HubCard href="/training/my" label="My Training" icon={BookOpenCheck} accent="#1A3A0E"
          description="Your assigned and available courses — watch lessons, take the assessment." />

        {canAuthor ? (
          <HubCard href="/training/manage" label="Manage Courses" icon={GraduationCap} accent="#B85C0A"
            description="Author courses, lessons, questions and SOP mapping." />
        ) : (
          <LockedCard label="Manage Courses" icon={GraduationCap} description="Training-officer access required." />
        )}

        {canAssign ? (
          <HubCard href="/training/manage/assignments" label="Assignments" icon={Users2} accent="#2A7CB8"
            description="Assign a course to staff or a whole department, with due dates." />
        ) : (
          <LockedCard label="Assignments" icon={Users2} description="Training-officer access required." />
        )}

        {canManageComp ? (
          <HubCard href="/training/manage/review" label="Review Queue" icon={ClipboardCheck} accent="#6B4FA0"
            description="Grade the marker's-discretion questions and confirm final scores." />
        ) : (
          <LockedCard label="Review Queue" icon={ClipboardCheck} description="Competency-manager access required." />
        )}

        {canManageComp ? (
          <HubCard href="/training/signoff" label="Practical Sign-off" icon={UserCheck2} accent="#1A7A3C"
            description="Confirm hands-on competence for staff who passed the digital assessment." />
        ) : (
          <LockedCard label="Practical Sign-off" icon={UserCheck2} description="Competency-manager access required." />
        )}

        {canViewAll ? (
          <HubCard href="/training/competency" label="Competency Dashboard" icon={BarChart3} accent="#B81C1C"
            description="Cross-department competency coverage, overdue reviews and gaps." />
        ) : (
          <LockedCard label="Competency Dashboard" icon={BarChart3} description="HR / cross-department access required." />
        )}
      </div>
    </div>
  )
}
