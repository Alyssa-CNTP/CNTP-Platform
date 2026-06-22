'use client'

import { Network, Users, Briefcase, Building2, Bell, Sparkles } from 'lucide-react'

export default function IntelligenceLinkedInPage() {
  return (
    <div className="px-4 md:px-6 py-6 max-w-[900px] mx-auto">
      <header className="flex flex-wrap items-baseline gap-3 mb-5">
        <Network size={20} className="self-center" style={{ color: 'var(--color-info)' }} />
        <h1 className="font-display font-bold text-[22px] text-text">LinkedIn Intelligence</h1>
        <span
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border self-center"
          style={{
            background:  'rgba(120,72,200,0.10)',
            color:       '#7C3AED',
            borderColor: 'rgba(120,72,200,0.25)',
          }}
        >
          Phase 2 — Coming soon
        </span>
      </header>

      {/* Hero card */}
      <section className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-6 mb-5">
        <div className="flex items-start gap-4">
          <div
            className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--color-info-bg)' }}
          >
            <Network size={22} style={{ color: 'var(--color-info)' }} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-[18px] text-text leading-tight">
              Decision-maker intelligence
            </h2>
            <p className="text-[13px] text-text-muted mt-1.5 leading-relaxed">
              Track the people, companies, and conversations that move our market. LinkedIn
              Intelligence will let the sales and exec teams follow named accounts in real
              time, catch leadership changes early, and surface conversations relevant to
              our brand and category.
            </p>
          </div>
        </div>
      </section>

      {/* Feature preview grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <FeatureCard
          icon={<Users size={16} />}
          title="Decision-maker tracking"
          description="Follow key buyers, distributors, and category leaders. Get notified when they change roles or post about our space."
          accent="var(--color-info)"
        />
        <FeatureCard
          icon={<Building2 size={16} />}
          title="Company profiles"
          description="Live profiles for every target account — headcount changes, leadership moves, recent posts, and product launches."
          accent="var(--color-accent)"
        />
        <FeatureCard
          icon={<Briefcase size={16} />}
          title="Job title monitoring"
          description="Alert when target companies post jobs in procurement, sourcing, or product — early signal of new business motion."
          accent="var(--color-warn)"
        />
        <FeatureCard
          icon={<Bell size={16} />}
          title="Conversation alerts"
          description="Real-time mentions of rooibos, our brands, and competitor brands in posts from people that matter."
          accent="var(--color-ok)"
        />
      </section>

      {/* Status block */}
      <section
        className="rounded-xl border p-5 flex items-start gap-3"
        style={{ background: 'var(--color-info-bg)', borderColor: 'rgba(29,78,216,0.22)' }}
      >
        <Sparkles size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--color-info)' }} />
        <div>
          <h3 className="font-display font-semibold text-[13px]" style={{ color: 'var(--color-info)' }}>
            Planned for Phase 2
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            LinkedIn requires a dedicated ingestion layer and approved data-access partner.
            We&apos;ll switch this surface on once the connector is in place — at which point
            existing Signal Engine filters and the slide-over drawer will work the same way
            here as they do across the rest of the Intelligence module.
          </p>
        </div>
      </section>
    </div>
  )
}

function FeatureCard({
  icon, title, description, accent,
}: {
  icon:        React.ReactNode
  title:       string
  description: string
  accent:      string
}) {
  return (
    <div className="bg-surface-card rounded-xl border border-surface-rule shadow-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
          style={{ background: 'var(--color-surface)', color: accent }}
        >
          {icon}
        </span>
        <h3 className="font-display font-semibold text-[13px] text-text">{title}</h3>
      </div>
      <p className="text-[12px] text-text-muted leading-relaxed">{description}</p>
    </div>
  )
}
