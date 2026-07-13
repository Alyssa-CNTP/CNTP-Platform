'use client'

import { Building2, Users, BarChart2, BookOpen, CalendarRange, GraduationCap, KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { HubCard, LockedCard } from '@/components/hr/HubCard'
import { PageInfoButton } from '@/components/hr/PageInfo'

export default function HrHubPage() {
  const { p, isIT, isFullAdmin } = useAuth()

  const canRoster = p('can_view_roster')
  const canUsers  = p('can_manage_users')
  const canAudit  = isIT || isFullAdmin

  return (
    <div className="px-4 py-6 max-w-[820px] mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="font-display font-bold text-[20px] text-text flex items-center gap-2">
            <Building2 size={20} className="text-brand" /> HR
          </h1>
          <PageInfoButton title="How the pieces fit together">
            <p>Every person has <strong className="text-text">one profile</strong> — their Staff Directory record. Everything else is a separate identity that links back to it:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li><strong className="text-text">Staff Directory</strong> — the canonical person: name, department, contact details, leave.</li>
              <li><strong className="text-text">PIN sign-in</strong> (Capture floor app) — assigned from a person's profile, always linked to it.</li>
              <li><strong className="text-text">Login sign-in</strong> (Microsoft account) — created in <strong className="text-text">Users &amp; Roles</strong> (IT-only), which is also where a person's login gets linked back to their Staff Directory profile.</li>
              <li><strong className="text-text">Training</strong> — courses and assessments, tied to the profile; a pass auto-updates the <strong className="text-text">Skills Matrix</strong>.</li>
              <li><strong className="text-text">Shift Rosters</strong> — schedules Staff Directory people into sections and shifts.</li>
            </ul>
            <p>Open any person's profile in Staff Directory to see all of this in one place — their PIN, login, training and competency.</p>
          </PageInfoButton>
        </div>
        <p className="text-[12px] text-text-muted mt-1">People, skills, training and access — everything for managing staff in one place.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <HubCard href="/production/staff" label="Staff Directory" icon={Users} accent="#1A3A0E"
          description="Every employee, department, contact details and leave." />
        <HubCard href="/production/staff/matrix" label="Skills Matrix" icon={BarChart2} accent="#2A7CB8"
          description="Competency status for every staff member against every SOP." />
        <HubCard href="/production/staff/sops" label="SOP Catalogue" icon={BookOpen} accent="#6B4FA0"
          description="The work-instruction & SOP library staff are trained and assessed against." />
        <HubCard href="/training" label="Training" icon={GraduationCap} accent="#B85C0A"
          description="Video lessons and digital assessments — courses, assignments and sign-off." />

        {canRoster ? (
          <HubCard href="/production/roster" label="Shift Rosters" icon={CalendarRange} accent="#1A7A3C"
            description="Who's rostered where, every shift, across every section." />
        ) : (
          <LockedCard label="Shift Rosters" icon={CalendarRange} description="Ask your supervisor for roster access." />
        )}

        {canUsers ? (
          <HubCard href="/users" label="Users & Roles" icon={KeyRound} accent="#B81C1C"
            description="Login accounts, departments, roles and permission toggles." />
        ) : (
          <LockedCard label="Users & Roles" icon={KeyRound} description="IT-managed — ask IT for account changes." />
        )}

        {canAudit ? (
          <HubCard href="/users" label="Audit Trail" icon={ShieldCheck} accent="#637056"
            description="Who changed what, when — via the Audit Log tab in Users & Roles." />
        ) : (
          <LockedCard label="Audit Trail" icon={ShieldCheck} description="Visible to IT — via Users & Roles." />
        )}
      </div>
    </div>
  )
}
