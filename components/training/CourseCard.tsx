'use client'

import Link from 'next/link'
import { PlayCircle, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { format, parseISO, isPast } from 'date-fns'

export interface CourseListItem {
  id: string; slug: string; title: string; description: string | null
  lesson_count: number; question_count: number
  assignment?: { due_date: string | null; status: string; reason: string | null } | null
  latest_attempt?: { final_score: number | null; auto_score: number | null; passed: boolean | null; needs_review: boolean } | null
  lessons_watched?: number
}

export function CourseCard({ course, employeeId }: { course: CourseListItem; employeeId?: string | null }) {
  const attempt = course.latest_attempt
  const overdue = course.assignment?.due_date && course.assignment.status !== 'completed' && isPast(parseISO(course.assignment.due_date))

  let statusBadge: { label: string; cls: string; icon: React.ElementType } = { label: 'Not started', cls: 'bg-stone-100 text-stone-400', icon: PlayCircle }
  if (attempt?.needs_review) statusBadge = { label: 'Pending review', cls: 'bg-warn/15 text-warn', icon: Clock }
  else if (attempt?.passed) statusBadge = { label: 'Completed', cls: 'bg-ok/15 text-ok', icon: CheckCircle2 }
  else if (attempt) statusBadge = { label: 'Retake needed', cls: 'bg-err/10 text-err', icon: AlertTriangle }
  else if (course.assignment) statusBadge = { label: overdue ? 'Overdue' : 'Assigned', cls: overdue ? 'bg-err/10 text-err' : 'bg-azure/15 text-azure', icon: Clock }

  const Icon = statusBadge.icon

  const href = employeeId ? `/training/course/${course.slug}?as=${employeeId}` : `/training/course/${course.slug}`

  return (
    <Link href={href}
      className="block bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-[14px] text-text">{course.title}</h3>
          {course.description && <p className="text-[12px] text-text-muted mt-1 line-clamp-2">{course.description}</p>}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted">
            <span>{course.lesson_count} lesson{course.lesson_count === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{course.question_count} question{course.question_count === 1 ? '' : 's'}</span>
            {course.assignment?.due_date && (
              <><span>·</span><span className={overdue ? 'text-err font-medium' : ''}>Due {format(parseISO(course.assignment.due_date), 'd MMM')}</span></>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${statusBadge.cls}`}>
          <Icon size={11} /> {statusBadge.label}
        </span>
      </div>
      {attempt && !attempt.needs_review && attempt.final_score != null && (
        <div className="mt-2 text-[11px] text-text-muted">Last score: <span className="font-semibold text-text">{Math.round(attempt.final_score * 100)}%</span></div>
      )}
    </Link>
  )
}
