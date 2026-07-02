'use client'

// app/(app)/marketing/page.tsx
// Marketing Hub — Dashboard · Campaigns · Audiences · Content
// Phase 3: full SignalCards, BriefingCards output, audience company matches.

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  TrendingUp, Swords, Users, Sparkles, Plus,
  BarChart2, Globe2, Loader2, RefreshCw,
  ChevronDown, ChevronUp, Check,
  Megaphone, Palette, ArrowRight, Building2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import SignalCard   from '@/components/intelligence/SignalCard'
import SignalDrawer from '@/components/intelligence/SignalDrawer'
import BriefingCards from '@/components/intelligence/BriefingCards'
import type { Signal } from '@/components/intelligence/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'dashboard' | 'campaigns' | 'audiences' | 'content'

interface Campaign {
  id:           string
  created_at:   string
  title:        string
  market:       string | null
  audience_tag: string | null
  status:       string
  brief:        string | null
  notes:        string | null
  channel:      string | null
  signal_ids:   string[]
}

interface Audience {
  id:           string
  tag:          string
  label:        string
  description:  string
  signal_count: number
}

interface CompanyProfile {
  company_name: string
  country:      string | null
  sector:       string | null
  pitch_angle:  string | null
  panjiva_data: { total_value_usd?: number; shipment_count?: number; current_supplier?: string } | null
  account_id:   string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Spinner() {
  return <Loader2 size={14} className="animate-spin text-accent" />
}

async function callMarketing(body: Record<string, unknown>): Promise<any> {
  const r = await fetch('/api/marketing', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  return r.json()
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60)   return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-surface border-surface-rule text-text-muted',
  active:    'bg-ok/10 border-ok/20 text-ok',
  completed: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
  paused:    'bg-warn/10 border-warn/20 text-warn',
}

// ─── Tab component ────────────────────────────────────────────────────────────

function Tab({ label, active, onClick, icon: Icon }: {
  label: string; active: boolean; onClick: () => void; icon: React.ElementType
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TAB
// ─────────────────────────────────────────────────────────────────────────────

const AUDIENCE_KEYWORD_GROUPS = new Set([
  'wellness','k_beauty','halal','kosher','vegan','sustainability',
  'organic','gen_z','consumer','lifestyle',
])

function DashboardTab() {
  const [signals,    setSignals]    = useState<Signal[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<Signal | null>(null)
  const [gridOpen,   setGridOpen]   = useState(false)

  // Audience companies (loaded lazily once audience signals are known)
  const [companies,     setCompanies]     = useState<CompanyProfile[]>([])
  const [companiesLoad, setCompaniesLoad] = useState(false)
  const [companiesFetched, setCompaniesFetched] = useState(false)
  const [savingAudience, setSavingAudience] = useState(false)
  const [audienceSaved,  setAudienceSaved]  = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/api/signals?limit=200')
      .then(r => r.json())
      .then(d => { setSignals(d.signals ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const opportunities   = useMemo(() =>
    signals.filter(s => s.classification === 'opportunity')
           .sort((a, b) => b.relevance_score - a.relevance_score),
    [signals])

  const socialTrends    = useMemo(() =>
    signals.filter(s => ['youtube','tiktok','instagram','reddit'].includes(s.source_type))
           .sort((a, b) => b.relevance_score - a.relevance_score),
    [signals])

  const audienceSignals = useMemo(() =>
    signals.filter(s =>
      s.classification === 'relationship' ||
      (s.keyword_group && AUDIENCE_KEYWORD_GROUPS.has(s.keyword_group))
    ).sort((a, b) => b.relevance_score - a.relevance_score),
    [signals])

  const regionData = useMemo(() => {
    const counts = new Map<string, number>()
    signals.forEach(s => { if (s.region) counts.set(s.region, (counts.get(s.region) ?? 0) + 1) })
    return Array.from(counts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [signals])

  // Audience signal regions → fetch matching company_profiles
  const audienceRegions = useMemo(() =>
    [...new Set(audienceSignals.map(s => s.region).filter(Boolean) as string[])],
    [audienceSignals])

  const loadCompanies = useCallback(async () => {
    if (companiesFetched || companiesLoad || audienceRegions.length === 0) return
    setCompaniesLoad(true)
    setCompaniesFetched(true)
    const d = await callMarketing({ action: 'audience_companies', regions: audienceRegions, limit: 12 })
    setCompanies(d.companies ?? [])
    setCompaniesLoad(false)
  }, [audienceRegions, companiesFetched, companiesLoad])

  async function saveAudience() {
    if (savingAudience || audienceSaved) return
    setSavingAudience(true)
    await fetch('/api/accounts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        `Audience — ${audienceRegions.slice(0, 3).join(', ') || 'global'}`,
        account_type:'audience',
        stage:       'lead',
        tags:        ['audience-signals'],
        signal_ids:  audienceSignals.slice(0, 20).map(s => s.id),
        notes:       `Built from ${audienceSignals.length} audience signals`,
      }),
    })
    // also save to sales.audiences via marketing API
    await callMarketing({
      action:      'save_report',
      title:       `Audience Signals — ${audienceRegions.slice(0,3).join(', ') || 'global'}`,
      report_type: 'audience',
      body:        audienceSignals.map(s => `• ${s.title}${s.sales_angle ? ` → ${s.sales_angle}` : ''}`).join('\n'),
    })
    setAudienceSaved(true)
    setSavingAudience(false)
  }

  return (
    <div className="space-y-6">

      {/* Market Pulse */}
      <div className="bg-surface-card border border-surface-rule rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display font-semibold text-[14px] text-text">Market Pulse</h2>
            <p className="text-[11px] text-text-muted mt-0.5">Signal volume by region — updated daily via n8n</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ok" style={{ boxShadow: '0 0 6px var(--color-ok)' }} />
            <span className="font-mono text-[9px] text-text-faint uppercase tracking-wider">Live</span>
          </div>
        </div>
        {loading ? (
          <div className="h-[180px] flex items-center justify-center text-text-faint text-[12px]">Loading…</div>
        ) : regionData.length === 0 ? (
          <div className="h-[180px] flex items-center justify-center text-text-faint text-[12px]">No regional data yet</div>
        ) : (
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={regionData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-rule)" vertical={false} />
                <XAxis dataKey="region" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-muted)' }} axisLine={{ stroke: 'var(--color-surface-rule)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface-card)', border: '1px solid var(--color-surface-rule)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  labelStyle={{ color: 'var(--color-text)' }}
                  cursor={{ fill: 'var(--color-surface)' }}
                />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 3-column signal view */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Opportunities — full SignalCard so recommended-action shows */}
        <SignalColumn
          icon={TrendingUp}
          title="Opportunities"
          accent="var(--color-ok)"
          signals={opportunities}
          loading={loading}
          onSelect={setSelected}
        />

        {/* Social Trends — full SignalCard with platform badges */}
        <SignalColumn
          icon={Globe2}
          title="Social Trends"
          accent="var(--color-info)"
          signals={socialTrends}
          loading={loading}
          onSelect={setSelected}
          emptyNote="Social platforms (YouTube, TikTok, Instagram) — signals appear here once n8n pipeline runs."
          showPlatform
        />

        {/* Audience Signals — with company matches + save-as-audience CTA */}
        <section className="bg-surface-card rounded-xl border border-surface-rule flex flex-col max-h-[700px]">
          <header className="flex items-center justify-between px-4 py-3 border-b border-surface-rule sticky top-0 bg-surface-card rounded-t-xl">
            <div className="flex items-center gap-2">
              <Users size={13} style={{ color: 'var(--color-accent)' }} />
              <h3 className="font-display font-semibold text-[13px] text-text">Audience Signals</h3>
            </div>
            <span className="font-mono text-[10px] font-medium px-2 py-0.5 rounded border border-surface-rule bg-surface" style={{ color: 'var(--color-accent)' }}>
              {audienceSignals.length}
            </span>
          </header>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="text-center text-text-faint text-[12px] py-6">Loading…</div>
            ) : audienceSignals.length === 0 ? (
              <div className="text-center text-text-faint text-[12px] py-6 px-3 leading-relaxed">
                No audience signals yet.
              </div>
            ) : (
              audienceSignals.slice(0, 12).map(s => (
                <SignalCard key={s.id} signal={s} onClick={setSelected} />
              ))
            )}

            {/* Company matches panel */}
            {audienceSignals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-surface-rule">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Building2 size={11} className="text-text-muted" />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      Matching buyers
                    </span>
                  </div>
                  {!companiesFetched && (
                    <button
                      onClick={loadCompanies}
                      className="font-mono text-[10px] text-accent hover:text-accent/80 transition-colors"
                    >
                      Load
                    </button>
                  )}
                </div>

                {companiesLoad && (
                  <div className="flex items-center gap-2 text-text-faint text-[11px] py-2">
                    <Loader2 size={11} className="animate-spin" /> Loading…
                  </div>
                )}

                {companies.length > 0 && (
                  <div className="space-y-1.5">
                    {companies.slice(0, 6).map(c => (
                      <div key={c.company_name} className="rounded-lg border border-surface-rule bg-surface p-2.5 text-[11px]">
                        <p className="font-medium text-text line-clamp-1">{c.company_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-text-faint font-mono text-[10px]">
                          {c.country && <span>{c.country}</span>}
                          {c.panjiva_data?.shipment_count != null && (
                            <><span>·</span><span>{c.panjiva_data.shipment_count} shipments</span></>
                          )}
                        </div>
                        {c.panjiva_data?.current_supplier && (
                          <p className="text-text-muted mt-0.5 line-clamp-1">From: {c.panjiva_data.current_supplier}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Save as audience */}
                {(companies.length > 0 || audienceSignals.length > 0) && (
                  <button
                    onClick={saveAudience}
                    disabled={savingAudience || audienceSaved}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 font-mono text-[11px] py-1.5 rounded-lg border transition-colors disabled:opacity-60"
                    style={audienceSaved
                      ? { background: 'var(--color-ok-bg)', color: 'var(--color-ok)', borderColor: 'rgba(21,128,61,0.22)' }
                      : { borderColor: 'var(--color-surface-rule)', color: 'var(--color-text-muted)' }}
                  >
                    {audienceSaved
                      ? <><Check size={11} /> Saved to pipeline</>
                      : savingAudience
                        ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                        : <>Save as audience</>
                    }
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Expand to full grid */}
      <div>
        <button
          onClick={() => setGridOpen(v => !v)}
          className="flex items-center gap-2 text-[12px] text-text-muted hover:text-text transition-colors font-mono tracking-wide"
        >
          {gridOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {gridOpen ? 'Collapse' : 'View all signals'}
          <span className="text-text-faint">({signals.length})</span>
        </button>

        {gridOpen && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {signals.map(s => (
              <SignalCard key={s.id} signal={s} onClick={setSelected} />
            ))}
          </div>
        )}
      </div>

      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function SignalColumn({ icon: Icon, title, accent, signals, loading, onSelect, emptyNote, showPlatform }: {
  icon: React.ElementType; title: string; accent: string
  signals: Signal[]; loading: boolean; onSelect: (s: Signal) => void
  emptyNote?: string; showPlatform?: boolean
}) {
  return (
    <section className="bg-surface-card rounded-xl border border-surface-rule flex flex-col max-h-[700px]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-surface-rule sticky top-0 bg-surface-card rounded-t-xl">
        <div className="flex items-center gap-2">
          <Icon size={13} style={{ color: accent }} />
          <h3 className="font-display font-semibold text-[13px] text-text">{title}</h3>
        </div>
        <span className="font-mono text-[10px] font-medium px-2 py-0.5 rounded border border-surface-rule bg-surface" style={{ color: accent }}>
          {signals.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center text-text-faint text-[12px] py-6">Loading…</div>
        ) : signals.length === 0 ? (
          <div className="text-center text-text-faint text-[12px] py-6 px-3 leading-relaxed">
            {emptyNote ?? 'No signals in this category yet.'}
          </div>
        ) : (
          signals.slice(0, 15).map(s => (
            <div key={s.id}>
              {showPlatform && (
                <div className="mb-1 px-1">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">{s.source_type}</span>
                </div>
              )}
              <SignalCard signal={s} onClick={onSelect} />
            </div>
          ))
        )}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGNS TAB
// ─────────────────────────────────────────────────────────────────────────────

const MARKETS   = ['South Korea','Germany','UAE','Japan','Netherlands','UK','Australia','Brazil','India','Poland']
const AUDIENCES = ['halal','kosher','vegan','gen_z','millennial','wellness','k_beauty','clinical','specialty_coffee']

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [brief,     setBrief]     = useState('')

  const [title,     setTitle]     = useState('')
  const [market,    setMarket]    = useState('')
  const [audience,  setAudience]  = useState('')
  const [channel,   setChannel]   = useState('')
  const [notes,     setNotes]     = useState('')
  const [signalIds, setSignalIds] = useState<string[]>([])

  useEffect(() => {
    callMarketing({ action: 'list_campaigns' })
      .then(d => setCampaigns(d.campaigns ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const generateBrief = async () => {
    if (!market || !audience) return
    setAiLoading(true); setBrief(''); setSignalIds([])
    const d = await callMarketing({ action: 'campaign_brief', market, audience_tag: audience })
    setBrief(d.response ?? '')
    setSignalIds(d.signal_ids ?? [])
    setAiLoading(false)
  }

  const saveCampaign = async () => {
    if (!title) return
    setLoading(true)
    await callMarketing({ action: 'save_campaign', title, market, audience_tag: audience, brief, notes, channel: channel || null, signal_ids: signalIds })
    const d = await callMarketing({ action: 'list_campaigns' })
    setCampaigns(d.campaigns ?? [])
    setCreating(false)
    setTitle(''); setMarket(''); setAudience(''); setChannel(''); setBrief(''); setNotes(''); setSignalIds([])
    setLoading(false)
  }

  return (
    <div className="space-y-5">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> New campaign brief
        </button>
      )}

      {creating && (
        <div className="bg-surface-card border border-surface-rule rounded-xl p-5 space-y-4">
          <h3 className="font-display font-bold text-[15px] text-text">New campaign</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Campaign title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Korea K-Beauty Q3 2026"
                className="w-full px-3 py-2 text-[13px] border border-surface-rule rounded-lg bg-surface text-text outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Target market</label>
              <select value={market} onChange={e => setMarket(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-surface-rule rounded-lg bg-surface text-text outline-none focus:border-accent">
                <option value="">Select market…</option>
                {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Audience segment</label>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map(a => (
                <button key={a} onClick={() => setAudience(a)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] border transition-colors capitalize ${audience === a ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-surface-rule bg-surface text-text-muted hover:text-text'}`}>
                  {a.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Channel (optional)</label>
            <div className="flex flex-wrap gap-2">
              {(['email','social','trade','event','other'] as const).map(c => (
                <button key={c} onClick={() => setChannel(ch => ch === c ? '' : c)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] border transition-colors capitalize ${channel === c ? 'border-accent bg-accent/10 text-accent font-semibold' : 'border-surface-rule bg-surface text-text-muted hover:text-text'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Context, objectives, or constraints…"
              className="w-full px-3 py-2 text-[13px] border border-surface-rule rounded-lg bg-surface text-text outline-none focus:border-accent resize-none" />
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={generateBrief}
              disabled={!market || !audience || aiLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
            >
              {aiLoading ? <Spinner /> : <Sparkles size={13} />}
              Generate AI brief
            </button>
            <button
              onClick={saveCampaign}
              disabled={!title}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-rule text-[13px] text-text-muted hover:text-text disabled:opacity-40"
            >
              <Check size={13} /> Save campaign
            </button>
            <button onClick={() => { setCreating(false); setBrief('') }} className="px-4 py-2 text-[13px] text-text-faint hover:text-text">
              Cancel
            </button>
          </div>

          {(brief || aiLoading) && (
            <BriefingCards
              text={brief}
              loading={aiLoading}
              label="Campaign Brief"
              reportTitle={title || `${market} — ${audience} campaign brief`}
              reportType="campaign_brief"
            />
          )}
        </div>
      )}

      {loading && !creating ? (
        <div className="flex items-center gap-2 text-text-faint text-[13px]"><Spinner /> Loading campaigns…</div>
      ) : campaigns.length === 0 && !creating ? (
        <div className="bg-surface-card border border-surface-rule rounded-xl p-10 text-center">
          <Megaphone size={24} className="mx-auto mb-3 text-text-faint" />
          <p className="font-display font-semibold text-[14px] text-text-muted">No campaigns yet</p>
          <p className="text-[12px] text-text-faint mt-1">Create a campaign brief to track your marketing approach by market and audience.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map(c => (
            <div key={c.id} className="bg-surface-card border border-surface-rule rounded-xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-display font-semibold text-[14px] text-text leading-tight">{c.title}</h4>
                <span className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider shrink-0 ${STATUS_COLORS[c.status] ?? STATUS_COLORS.draft}`}>
                  {c.status}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {c.market       && <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface border border-surface-rule text-text-muted">{c.market}</span>}
                {c.audience_tag && <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface border border-surface-rule text-text-muted capitalize">{c.audience_tag.replace(/_/g, ' ')}</span>}
                {c.channel      && <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-surface border border-surface-rule text-text-muted capitalize">{c.channel}</span>}
                {c.signal_ids?.length > 0 && <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent">{c.signal_ids.length} signals</span>}
              </div>
              {c.brief && (
                <p className="text-[12px] text-text-muted leading-relaxed line-clamp-3">{c.brief}</p>
              )}
              <p className="font-mono text-[10px] text-text-faint">{timeAgo(c.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIENCES TAB
// ─────────────────────────────────────────────────────────────────────────────

function AudiencesTab() {
  const [audiences,  setAudiences]  = useState<Audience[]>([])
  const [selected,   setSelected]   = useState<Audience | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [briefLoad,  setBriefLoad]  = useState(false)
  const [brief,      setBrief]      = useState('')

  useEffect(() => {
    callMarketing({ action: 'list_audiences' })
      .then(d => setAudiences(d.audiences ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const selectAudience = async (a: Audience) => {
    if (selected?.tag === a.tag) { setSelected(null); setBrief(''); return }
    setSelected(a); setBrief(''); setBriefLoad(true)
    const d = await callMarketing({ action: 'audience_brief', audience_tag: a.tag })
    setBrief(d.response ?? '')
    setBriefLoad(false)
  }

  const ACCENT_COLORS = [
    'bg-pink-500/10 border-pink-500/20',
    'bg-purple-500/10 border-purple-500/20',
    'bg-blue-500/10 border-blue-500/20',
    'bg-ok/10 border-ok/20',
    'bg-accent/10 border-accent/20',
    'bg-warn/10 border-warn/20',
    'bg-teal-500/10 border-teal-500/20',
    'bg-orange-500/10 border-orange-500/20',
    'bg-indigo-500/10 border-indigo-500/20',
  ]

  return (
    <div className="space-y-5">
      <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
        <p className="text-[13px] text-text-muted leading-relaxed">
          Each segment represents a buyer or consumer profile. Click one to get a full intelligence brief — what they want, how to reach them, and what content works.
          Signal counts update as n8n pulls tagged signals. Briefs are saved to reports automatically.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-faint text-[13px]"><Spinner /> Loading audiences…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {audiences.map((a, i) => {
            const isActive = selected?.tag === a.tag
            return (
              <button
                key={a.tag}
                onClick={() => selectAudience(a)}
                className={`rounded-xl border p-4 text-left transition-all ${
                  isActive ? 'border-accent bg-accent/10 shadow-sm' : `${ACCENT_COLORS[i % ACCENT_COLORS.length]} hover:shadow-sm`
                }`}
              >
                <p className={`font-display font-semibold text-[13px] mb-1 ${isActive ? 'text-accent' : 'text-text'}`}>
                  {a.label}
                </p>
                <p className="text-[11px] text-text-muted leading-snug line-clamp-2">{a.description}</p>
                {a.signal_count > 0 && (
                  <p className="font-mono text-[10px] text-text-faint mt-2">{a.signal_count} signals</p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            <h3 className="font-display font-semibold text-[14px] text-text">{selected.label}</h3>
            <ArrowRight size={12} className="text-text-faint" />
            <span className="text-[12px] text-text-muted">Intelligence brief</span>
          </div>
          <BriefingCards
            text={brief}
            loading={briefLoad}
            label={`${selected.label} — Audience Brief`}
            reportTitle={`${selected.label} audience brief`}
            reportType="audience_brief"
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TAB
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORMS = [
  { value: 'linkedin',      label: 'LinkedIn',      desc: 'B2B buyers, distributors, trade relationships' },
  { value: 'instagram',     label: 'Instagram',     desc: 'Consumer brand, lifestyle, visual storytelling' },
  { value: 'tiktok',        label: 'TikTok',        desc: 'Gen Z, short-form, trend-led content' },
  { value: 'email',         label: 'Email',         desc: 'Direct to trade buyers — structured outreach' },
  { value: 'press_release', label: 'Press Release', desc: 'Trade media, industry publications' },
]

function ContentTab() {
  const [platform, setPlatform] = useState('')
  const [market,   setMarket]   = useState('')
  const [audience, setAudience] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState('')

  const generate = async () => {
    if (!platform || !market) return
    setLoading(true); setResult('')
    const d = await callMarketing({ action: 'content_angles', platform, market, audience_tag: audience || undefined })
    setResult(d.response ?? '')
    setLoading(false)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
        <p className="text-[13px] text-text-muted leading-relaxed">
          Tell Alara your platform, market, and audience — it generates 5 specific content angles with hooks, formats, and CTAs. The angles pull from live signals so they reflect what's actually happening in the market.
        </p>
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-xl p-5 space-y-4">
        <div>
          <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Platform</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {PLATFORMS.map(p => (
              <button
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`px-3 py-2.5 rounded-lg border text-left transition-all ${
                  platform === p.value ? 'border-accent bg-accent/10' : 'border-surface-rule bg-surface hover:border-text-muted'
                }`}
              >
                <p className={`font-semibold text-[12px] ${platform === p.value ? 'text-accent' : 'text-text'}`}>{p.label}</p>
                <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Target market</label>
            <select value={market} onChange={e => setMarket(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-surface-rule rounded-lg bg-surface text-text outline-none focus:border-accent">
              <option value="">Select market…</option>
              {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Audience (optional)</label>
            <select value={audience} onChange={e => setAudience(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-surface-rule rounded-lg bg-surface text-text outline-none focus:border-accent">
              <option value="">All audiences</option>
              {AUDIENCES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={generate}
          disabled={!platform || !market || loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {loading ? <Spinner /> : <Palette size={13} />}
          Generate content angles
        </button>
      </div>

      <BriefingCards
        text={result}
        loading={loading}
        label="Content Angles"
        reportTitle={`${platform} content angles — ${market}`}
        reportType="content_angles"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROOT
// ─────────────────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'dashboard', label: 'Dashboard',  icon: BarChart2 },
  { key: 'campaigns', label: 'Campaigns',  icon: Megaphone },
  { key: 'audiences', label: 'Audiences',  icon: Users     },
  { key: 'content',   label: 'Content',    icon: Palette   },
]

export default function MarketingPage() {
  const [tab, setTab] = useState<TabKey>('dashboard')

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="bg-surface-card border-b border-surface-rule px-6 py-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="font-display font-bold text-[20px] text-text">Marketing</h1>
            <p className="text-[12px] text-text-muted mt-0.5">
              Market pulse · Campaign intelligence · Audience briefs · Content angles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ok" style={{ boxShadow: '0 0 6px var(--color-ok)' }} />
            <span className="font-mono text-[9px] text-text-faint uppercase tracking-wider">Signals live</span>
          </div>
        </div>
      </div>

      <div className="bg-surface-card border-b border-surface-rule px-6 flex gap-0 overflow-x-auto">
        {TABS.map(t => <Tab key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} icon={t.icon} />)}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto p-6">
          {tab === 'dashboard' && <DashboardTab />}
          {tab === 'campaigns' && <CampaignsTab />}
          {tab === 'audiences' && <AudiencesTab />}
          {tab === 'content'   && <ContentTab />}
        </div>
      </div>
    </div>
  )
}
