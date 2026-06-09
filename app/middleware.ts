// middleware.ts
//
// Runs on every request BEFORE the page loads.
// Only job: redirect unauthenticated users to /login.
//
// NOTE: Department/permission guards are enforced in app/(app)/layout.tsx via ROUTE_GUARDS,
// which fires after the auth context loads department + permissions from app_roles.
// The Sidebar also hides nav items client-side as a UX layer on top of this.
// Middleware stays lightweight (session only) to avoid a DB call on every request.

import { createServerClient } from '@supabase/ssr'
import { NextResponse }       from 'next/server'
import type { NextRequest }   from 'next/server'

// Routes that don't require authentication
// /scan is the public customer-facing unit lookup page (multi-language).
const PUBLIC_ROUTES = ['/login', '/reset-password', '/forgot-password', '/scan']

// Routes that are always allowed (Next.js internals, static files)
const ALWAYS_ALLOW = ['/_next', '/favicon', '/api/upload', '/api/outstanding', '/api/logistics/public']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public routes and Next.js internals
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) return NextResponse.next()
  if (ALWAYS_ALLOW.some(r => pathname.startsWith(r)))   return NextResponse.next()

  // Check for Supabase session
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll:  () => req.cookies.getAll(),
        setAll:  (cs) => cs.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return res
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}