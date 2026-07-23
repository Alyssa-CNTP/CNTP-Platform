import { redirect } from 'next/navigation'

// SOP Catalogue moved to Training (the qualification home), with supersession
// and a digital-course badge — see app/(app)/training/sops/page.tsx.
export default function SopCatalogueRedirect() {
  redirect('/training/sops')
}
