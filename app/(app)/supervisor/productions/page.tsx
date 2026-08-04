import { redirect } from 'next/navigation'

// Retired. This page was a second copy of /production/orders — the same session
// list, the same filters, a different layout — which is most of why production
// history felt inconsistent depending on where you opened it. Production Orders
// is now the single home for that list (with the KPIs and analytics it was
// missing), the "request a reopen" action lives on each record there, and the
// Production Manager's reopen DECISION queue moved to the Supervisor Hub's
// Sign-off tab with everything else awaiting a signature.
export default function SupervisorProductionsRedirect() {
  redirect('/production/orders')
}
