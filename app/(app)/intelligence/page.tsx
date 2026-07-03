import { redirect } from 'next/navigation'

// Signal Engine has been merged into Alara. Redirect to the Signal Feed tab.
export default function IntelligenceRedirect() {
  redirect('/research')
}
