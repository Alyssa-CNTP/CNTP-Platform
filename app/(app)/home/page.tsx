'use client'

// General-information landing — the company home page. Everyone lands here.
// A glass hero over the brand photo, a greeting, live company links (website
// shown as a WhatsApp-style rich preview, socials as branded cards), and a few
// quick links. The smart factory floor plan slots in here in a later phase.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Megaphone, LifeBuoy, ExternalLink, Leaf, ArrowRight,
  Globe, ClipboardList, Users, CalendarRange,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'

// lucide dropped brand glyphs, so inline the two we need.
const FacebookGlyph = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94Z" />
  </svg>
)
const InstagramGlyph = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

const WEBSITE = 'https://rooibostea.co.za/'
const FACEBOOK = 'https://www.facebook.com/capenatural/'
const INSTAGRAM = 'https://instagram.com/capenatural'

interface Preview { title: string; description: string; image: string | null; siteName: string; url: string }

export default function HomePage() {
  const { displayName } = useAuth()
  const firstName = (displayName ?? '').split(' ')[0] || 'there'
  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [pvFailed, setPvFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/link-preview?url=${encodeURIComponent(WEBSITE)}`)
      .then(r => r.json())
      .then(j => { if (!alive) return; j.error ? setPvFailed(true) : setPreview(j) })
      .catch(() => alive && setPvFailed(true))
    return () => { alive = false }
  }, [])

  const quickLinks = [
    { href: '/production/capture', label: 'Capture', desc: 'Record production for your shift', icon: ClipboardList },
    { href: '/supervisor', label: 'Supervisor Hub', desc: 'Sign-offs, timesheets & analytics', icon: Users },
    { href: '/production/roster', label: 'Roster', desc: 'Shift planning', icon: CalendarRange },
  ]

  return (
    <div className="px-4 py-6 max-w-[1100px] mx-auto space-y-6">
      {/* Glass hero over the brand photo */}
      <div className="relative overflow-hidden rounded-3xl min-h-[220px] flex items-end"
        style={{ backgroundImage: 'url(/rooibos-hero.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,40,14,0.05) 0%, rgba(20,40,14,0.55) 100%)' }} />
        <div className="relative m-4 sm:m-6 px-5 py-4 rounded-2xl w-full sm:w-auto"
          style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <div className="flex items-center gap-1.5 text-brand mb-1">
            <Leaf size={15} />
            <span className="font-display font-semibold text-[13px]">Cape Natural Tea Products</span>
          </div>
          <h1 className="font-display font-bold text-[24px] text-[#1A2415]">{greeting}, {firstName}</h1>
          <p className="text-[12px] text-stone-600 mt-0.5">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        </div>
      </div>

      {/* Announcements — placeholder */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <Megaphone size={15} className="text-brand" />
          <span className="font-display font-bold text-[14px] text-text">Announcements</span>
        </div>
        <p className="text-[13px] text-text-muted">Company news and updates will appear here.</p>
      </div>

      {/* Stay connected — website rich preview + social cards */}
      <div>
        <h3 className="font-display font-bold text-[13px] text-text-muted uppercase tracking-wide mb-3">Stay connected</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Website — live OG preview, with a branded fallback */}
          <a href={WEBSITE} target="_blank" rel="noreferrer"
            className="md:col-span-1 group bg-surface-card border border-surface-rule rounded-2xl overflow-hidden hover:border-brand/40 transition-colors flex flex-col">
            {preview?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.image} alt="" className="w-full h-32 object-cover" />
            )}
            <div className="p-4 flex-1">
              <div className="flex items-center gap-1.5 text-brand mb-1">
                <Globe size={13} /> <span className="text-[11px] uppercase tracking-wide">{preview?.siteName ?? 'rooibostea.co.za'}</span>
              </div>
              <div className="font-semibold text-[14px] text-text line-clamp-1">{preview?.title ?? 'Cape Natural Tea Products'}</div>
              <p className="text-[12px] text-text-muted mt-0.5 line-clamp-2">
                {preview?.description || (pvFailed ? 'Visit our website' : 'Loading preview…')}
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] text-brand mt-2 group-hover:underline">Open website <ExternalLink size={11} /></span>
            </div>
          </a>

          <SocialCard href={FACEBOOK} glyph={FacebookGlyph} color="#1877F2" name="Facebook" handle="/capenatural" />
          <SocialCard href={INSTAGRAM} glyph={InstagramGlyph} color="#E1306C" name="Instagram" handle="@capenatural" />
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="font-display font-bold text-[13px] text-text-muted uppercase tracking-wide mb-3">Quick links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickLinks.map(l => (
            <Link key={l.href} href={l.href}
              className="flex items-start gap-3 bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 hover:bg-surface transition-colors group">
              <l.icon size={18} className="text-brand mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-body font-semibold text-[14px] text-text">{l.label}</div>
                <div className="text-[12px] text-text-muted">{l.desc}</div>
              </div>
              <ArrowRight size={16} className="text-stone-300 group-hover:text-brand transition-colors mt-0.5" />
            </Link>
          ))}
        </div>
      </div>

      {/* Help & support */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <LifeBuoy size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">Help &amp; support</span>
        </div>
        <p className="text-[13px] text-text-muted">
          Need something? Raise a request via <Link href="/axis/request" className="text-brand hover:underline">Submit Request</Link>.
        </p>
      </div>
    </div>
  )
}

function SocialCard({ href, glyph, color, name, handle }: { href: string; glyph: React.ReactNode; color: string; name: string; handle: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="group bg-surface-card border border-surface-rule rounded-2xl p-4 hover:border-brand/40 transition-colors flex items-center gap-3">
      <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0" style={{ background: `${color}1A`, color }}>
        {glyph}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[14px] text-text">{name}</div>
        <div className="text-[12px] text-text-muted">{handle}</div>
      </div>
      <ExternalLink size={14} className="text-stone-300 group-hover:text-brand transition-colors" />
    </a>
  )
}
