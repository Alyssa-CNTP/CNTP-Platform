import { redirect } from 'next/navigation'

// Skills Matrix moved to Training (the qualification home) and merged with
// the former Competency Dashboard — see app/(app)/training/skills/page.tsx.
export default function SkillsMatrixRedirect() {
  redirect('/training/skills')
}
