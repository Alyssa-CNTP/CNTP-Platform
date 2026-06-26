'use client'

// Company home — an app-style "about" landing for everyone. The whole page sits
// on the isometric cargo illustration (low opacity) with frosted-glass cards on
// top: a greeting, a short about, the company links (website as a rich preview,
// socials as branded cards), and a pretty isometric drawing of our factory.
// No KPIs or operational detail — those live in their own sections.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { LifeBuoy, ExternalLink, Leaf, Globe } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { HomeIsometric } from '@/components/home/HomeIsometric'
import { WeatherTile } from '@/components/production/WeatherTile'

const WEBSITE = 'https://rooibostea.co.za/'
const FACEBOOK = 'https://www.facebook.com/capenatural/'
const INSTAGRAM = 'https://instagram.com/capenatural'

const glass = {
  background: 'rgba(255,255,255,0.80)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.6)',
  boxShadow: '0 4px 24px rgba(20,40,14,0.08)',
} as const

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

  return (
    <div className="relative min-h-full">
      {/* Full-page login photo backdrop, low opacity so cards read clearly */}
      <div aria-hidden className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'url(/rooibos-hero.png)', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.16 }} />

      <div className="relative px-4 py-6 max-w-[1100px] mx-auto space-y-6">
        {/* Greeting + local weather */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <div className="md:col-span-2 rounded-3xl px-6 py-5 flex flex-col justify-center" style={glass}>
            <div className="flex items-center gap-1.5 text-brand mb-1">
              <Leaf size={15} />
              <span className="font-display font-semibold text-[13px]">Cape Natural Tea Products</span>
            </div>
            <h1 className="font-display font-bold text-[26px] text-[#1A2415]">{greeting}, {firstName}</h1>
            <p className="text-[12px] text-stone-600 mt-0.5">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
          </div>
          <WeatherTile />
        </div>

        {/* About */}
        <div className="rounded-3xl px-6 py-5" style={glass}>
          <h2 className="font-display font-bold text-[15px] text-[#1A2415] mb-1.5">About us</h2>
          <p className="text-[13.5px] text-stone-700 leading-relaxed">
            Cape Natural Tea Products grows, processes and packs premium organic rooibos and botanical teas in
            Blackheath, Western Cape — from raw leaf through sieving, refining, granulation and pasteurising to
            finished, quality-assured product shipped worldwide. This platform is our operations home: production,
            quality, maintenance, logistics and more, all in one place.
          </p>
        </div>

        {/* Pretty isometric drawing of the factory */}
        <div className="rounded-3xl px-4 py-4 sm:px-6 sm:py-5" style={glass}>
          <h2 className="font-display font-bold text-[15px] text-[#1A2415] mb-2">Our factory</h2>
          <HomeIsometric />
        </div>

        {/* Stay connected */}
        <div>
          <h3 className="font-display font-bold text-[13px] uppercase tracking-wide mb-3 text-[#1A2415]">Stay connected</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <a href={WEBSITE} target="_blank" rel="noreferrer"
              className="group rounded-2xl overflow-hidden hover:shadow-md transition-shadow flex flex-col" style={glass}>
              {preview?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.image} alt="" className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-24 flex items-center justify-center" style={{ background: '#1A3A0E' }}>
                  <Leaf size={26} className="text-white/90" />
                </div>
              )}
              <div className="p-4 flex-1">
                <div className="flex items-center gap-1.5 text-brand mb-1">
                  <Globe size={13} /> <span className="text-[11px] uppercase tracking-wide">{preview?.siteName ?? 'rooibostea.co.za'}</span>
                </div>
                <div className="font-semibold text-[14px] text-[#1A2415] line-clamp-1">{preview?.title ?? 'Cape Natural Tea Products'}</div>
                <p className="text-[12px] text-stone-600 mt-0.5 line-clamp-2">
                  {preview
                    ? (preview.description || 'Premium organic rooibos & botanical teas from the Cederberg.')
                    : (pvFailed ? 'Visit our website' : 'Loading preview…')}
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] text-brand mt-2 group-hover:underline">Open website <ExternalLink size={11} /></span>
              </div>
            </a>

            <SocialCard href={FACEBOOK} glyph={FacebookGlyph} color="#1877F2" name="Facebook" handle="/capenatural" />
            <SocialCard href={INSTAGRAM} glyph={InstagramGlyph} color="#E1306C" name="Instagram" handle="@capenatural" />
          </div>
        </div>

        {/* Help & support */}
        <div className="rounded-3xl px-6 py-5" style={glass}>
          <div className="flex items-center gap-2 mb-2">
            <LifeBuoy size={15} className="text-stone-500" />
            <span className="font-display font-bold text-[14px] text-[#1A2415]">Help &amp; support</span>
          </div>
          <p className="text-[13px] text-stone-700">
            Need something? Raise a request via <Link href="/axis/request" className="text-brand hover:underline">Submit Request</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}

function SocialCard({ href, glyph, color, name, handle }: { href: string; glyph: React.ReactNode; color: string; name: string; handle: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="group rounded-2xl p-4 hover:shadow-md transition-shadow flex items-center gap-3" style={glass}>
      <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0" style={{ background: `${color}1A`, color }}>
        {glyph}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[14px] text-[#1A2415]">{name}</div>
        <div className="text-[12px] text-stone-600">{handle}</div>
      </div>
      <ExternalLink size={14} className="text-stone-400 group-hover:text-brand transition-colors" />
    </a>
  )
}
