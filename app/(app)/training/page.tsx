'use client'

import {
  GraduationCap, Users2, ClipboardCheck, BarChart3, UserCheck2, BookOpenCheck, BookOpen,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { HubCard, LockedCard } from '@/components/hr/HubCard'
import { PageInfoButton } from '@/components/hr/PageInfo'

const GROUP_TITLE = 'font-mono text-[10px] uppercase tracking-wide text-text-muted'

export default function TrainingHubPage() {
  const { p } = useAuth()

  const canAuthor      = p('can_author_training')
  const canAssign      = p('can_assign_training')
  const canManageComp  = p('can_manage_competencies')
  const canAccessHr    = p('can_access_hr')

  return (
    <div className="px-4 py-6 max-w-[820px] mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2">
            <GraduationCap size={20} className="text-brand" /> Training
          </h1>
          <PageInfoButton title="How Training connects to everything else">
            <p>Every course is tied to one or more <strong className="text-text">SOPs</strong> in the catalogue. Passing the assessment writes straight into that person's <strong className="text-text">Skills Matrix</strong> entry — no separate step, no re-entry.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Theory-only courses mark the SOP <strong className="text-text">Competent</strong> immediately.</li>
              <li>Hands-on machine SOPs mark it <strong className="text-text">Assessed</strong>, then wait for a supervisor's <strong className="text-text">sign-off</strong>.</li>
              <li>Everyone's own courses live under <strong className="text-text">My Training</strong> — reachable by PIN too, for floor operators without a login.</li>
            </ul>
          </PageInfoButton>
        </div>
        <p className="text-[12px] text-text-muted mt-1">Video lessons and digital assessments — every course auto-updates the Skills Matrix on a pass.</p>
      </div>

      {/* My learning — everyone */}
      <div className="space-y-2">
        <h2 className={GROUP_TITLE}>My learning</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HubCard href="/training/my" label="My Training" icon={BookOpenCheck} accent="#1A3A0E"
            description="Your assigned and available courses — watch lessons, take the assessment." />
        </div>
      </div>

      {/* Run training — the process a training officer / supervisor follows,
          in order: author it, assign it, grade it, sign it off. */}
      <div className="space-y-2">
        <h2 className={GROUP_TITLE}>Run training</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {canAuthor ? (
            <HubCard href="/training/manage" label="Courses" icon={GraduationCap} accent="#B85C0A"
              description="Author courses, lessons, questions and SOP mapping." />
          ) : (
            <LockedCard label="Courses" icon={GraduationCap} description="Training-officer access required." />
          )}

          {canAssign ? (
            <HubCard href="/training/manage/assignments" label="Assign training" icon={Users2} accent="#2A7CB8"
              description="Assign a course to staff or a whole department, with due dates." />
          ) : (
            <LockedCard label="Assign training" icon={Users2} description="Training-officer access required." />
          )}

          {canManageComp ? (
            <HubCard href="/training/manage/review" label="Review queue" icon={ClipboardCheck} accent="#6B4FA0"
              description="Grade the marker's-discretion questions and confirm final scores." />
          ) : (
            <LockedCard label="Review queue" icon={ClipboardCheck} description="Competency-manager access required." />
          )}

          {canManageComp ? (
            <HubCard href="/training/signoff" label="Sign-offs" icon={UserCheck2} accent="#1A7A3C"
              description="Confirm hands-on competence, and see who's still awaiting qualification by section." />
          ) : (
            <LockedCard label="Sign-offs" icon={UserCheck2} description="Competency-manager access required." />
          )}
        </div>
      </div>

      {/* Records & standards — the persistent registers everything above feeds. */}
      <div className="space-y-2">
        <h2 className={GROUP_TITLE}>Records & standards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {canAccessHr ? (
            <HubCard href="/training/skills" label="Skills Matrix" icon={BarChart3} accent="#B81C1C"
              description="Competency by person, by section, and any coverage gaps." />
          ) : (
            <LockedCard label="Skills Matrix" icon={BarChart3} description="HR access required." />
          )}

          {canAccessHr ? (
            <HubCard href="/training/sops" label="SOP Catalogue" icon={BookOpen} accent="#637056"
              description="Work instructions & SOPs — current revisions, superseded history, and which have a digital course." />
          ) : (
            <LockedCard label="SOP Catalogue" icon={BookOpen} description="HR access required." />
          )}
        </div>
      </div>
    </div>
  )
}
