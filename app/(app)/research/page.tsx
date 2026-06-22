'use client'

// app/(app)/research/page.tsx
// Alara — Rooibos Intelligence Engine
// Tabs: Signals · Gap Finder · Loopholes · Intelligence · Vault · Compass

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Radio, Sparkles, Lock, Compass, Search, RefreshCw,
  ExternalLink, X, Upload, FileText, BarChart2, Globe,
  TrendingUp, Building2, Mail, Bell, Leaf, FlaskConical,
  Factory, Sun, Award, Flag, CheckCircle, Loader2,
  ArrowRight, Coffee, Wheat, AlertTriangle, Zap,
  Link2, MessageSquare, ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section    = 'signals' | 'gap' | 'loopholes' | 'intel' | 'vault' | 'compass'
type IntelTool  = 'briefing' | 'frontier' | 'competitors' | 'profiler' | 'pitch' | 'alerts'
type CompassVec = 'red_espresso' | 'k_beauty' | 'clinical' | 'functional_oem' | 'agriculture' | 'appellation' | 'japan'

interface Signal {
  id:               string
  source_type:      string
  title:            string
  summary_en:       string | null
  classification:   string
  relevance_score:  number
  region:           string | null
  media_url:        string | null
  source_url:       string | null
  source_domain:    string | null
  keyword_group:    string | null
  sections:         string[]
  created_at:       string
  audience_tags?:   string[]
  cultural_context?: string
  practice_tags?:   string[]
}

interface VaultFile {
  name:       string
  category:   string
  uploadedAt: string
  size:       number
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  red:         '#C4522A',
  redLight:    '#E8715A',
  redBg:       'rgba(196,82,42,0.07)',
  redBorder:   'rgba(196,82,42,0.18)',
  redBorderMd: 'rgba(196,82,42,0.3)',
  green:       '#5C7A4E',
  greenBg:     '#EDF3EA',
  greenBorder: 'rgba(92,122,78,0.25)',
  bg:          '#FAF8F5',
  surface:     '#FFFFFF',
  elevated:    '#F5F1ED',
  border:      '#E8E0D8',
  borderLight: '#F0EBE4',
  text:        '#1C1917',
  muted:       '#6B6058',
  faint:       '#A89E94',
  amber:       '#D97706',
  amberBg:     'rgba(217,119,6,0.07)',
  amberBorder: 'rgba(217,119,6,0.2)',
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: C.red }} />
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 8 ? C.red : score >= 5 ? C.amber : C.faint
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ flex: 1, height: 3, background: C.borderLight, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${(score / 10) * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.04em' }}>
        {score}/10
      </span>
    </div>
  )
}

function Tag({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
      padding: '2px 7px', borderRadius: 4,
      background: color ? `${color}12` : `${C.faint}18`,
      color: color ?? C.faint,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function PlatformTag({ type }: { type: string }) {
  const map: Record<string, { bg: string; label: string; live?: boolean }> = {
    youtube:            { bg: '#CC0000', label: 'YouTube',       live: false },
    tiktok:             { bg: '#010101', label: 'TikTok',        live: false },
    instagram:          { bg: '#C13584', label: 'Instagram',     live: false },
    instagram_web:      { bg: '#C13584', label: 'Instagram',     live: false },
    reddit:             { bg: '#FF4500', label: 'Reddit',        live: false },
    linkedin:           { bg: '#0A66C2', label: 'LinkedIn',      live: false },
    twitter:            { bg: '#000000', label: 'X',             live: false },
    google_news:        { bg: '#4285F4', label: 'News',          live: true  },
    reuters:            { bg: '#FF8000', label: 'Reuters',       live: true  },
    ap_news:            { bg: '#CC0000', label: 'AP News',       live: true  },
    allafrica:          { bg: '#006400', label: 'AllAfrica',     live: true  },
    businesslive_sa:    { bg: '#002147', label: 'BusinessLive',  live: true  },
    daily_maverick:     { bg: '#1a1a1a', label: 'Daily Maverick',live: true  },
    foodnavigator:      { bg: '#2E7D32', label: 'FoodNav',       live: true  },
    foodnavigator_asia: { bg: '#1B5E20', label: 'FoodNav Asia',  live: true  },
    beveragedaily:      { bg: '#0277BD', label: 'BeverageDaily', live: true  },
    nutraingredients:   { bg: '#6A1B9A', label: 'NutraIng.',    live: true  },
    n8n:                { bg: '#EA4B71', label: 'Auto',          live: true  },
  }
  const s = map[type] ?? { bg: C.faint, label: type, live: false }
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
      padding: '2px 7px', borderRadius: 4,
      background: s.bg, color: '#fff',
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}

function ClsTag({ cls }: { cls: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    opportunity:  { bg: '#E8F5E9', color: '#2E7D32', label: 'Opportunity' },
    threat:       { bg: '#FFEBEE', color: '#C62828', label: 'Threat'      },
    competitor:   { bg: '#FFF3E0', color: '#E65100', label: 'Competitor'  },
    regulation:   { bg: '#E8EAF6', color: '#283593', label: 'Regulation'  },
    relationship: { bg: '#F3E5F5', color: '#6A1B9A', label: 'Relationship'},
    neutral:      { bg: C.elevated, color: C.muted,  label: 'Neutral'    },
  }
  const s = map[cls] ?? map.neutral
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
      padding: '2px 7px', borderRadius: 4,
      background: s.bg, color: s.color,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}

function AiResult({ text, loading, label = 'Alara Analysis' }: { text: string; loading: boolean; label?: string }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <Spinner />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint, letterSpacing: '0.05em' }}>Generating…</span>
    </div>
  )
  if (!text) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Leaf size={11} style={{ color: C.red, opacity: 0.8 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.red, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.text, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
          {text}
        </p>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

async function callSales(body: Record<string, unknown>): Promise<string> {
  const r = await fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await r.json()
  return d.response ?? d.error ?? 'No response.'
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7,
  border: `1px solid ${C.border}`,
  fontSize: 13, fontFamily: 'var(--font-body)',
  background: C.surface, color: C.text, outline: 'none',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
  color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase',
  display: 'block', marginBottom: 5,
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 7, border: 'none',
  background: C.red, color: '#fff',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const ghostBtn: React.CSSProperties = {
  ...primaryBtn, background: 'transparent', color: C.red,
  border: `1px solid ${C.redBorder}`,
}

// ─── Signal card ──────────────────────────────────────────────────────────────

function SignalCard({ signal, onClick }: { signal: Signal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '14px 16px',
        cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.redBorderMd; e.currentTarget.style.boxShadow = `0 2px 12px ${C.redBg}` }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        <PlatformTag type={signal.source_type} />
        <ClsTag cls={signal.classification} />
        {signal.cultural_context && <Tag label={signal.cultural_context} color={C.red} />}
        {(signal.audience_tags ?? []).slice(0, 1).map(t => <Tag key={t} label={t} color={C.green} />)}
      </div>
      <p style={{
        fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
        color: C.text, lineHeight: 1.45, marginBottom: 6, flex: 1,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {signal.title}
      </p>
      {signal.summary_en && (
        <p style={{
          fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {signal.summary_en}
        </p>
      )}
      <div style={{ marginBottom: 10 }}><ScoreBar score={signal.relevance_score} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em' }}>
          {[signal.region, timeAgo(signal.created_at)].filter(Boolean).join(' · ')}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.red, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}>
          Analyse <ArrowRight size={9} />
        </span>
      </div>
    </button>
  )
}

// ─── Signal drawer with source-fetch + ask-about-this-source ─────────────────

function SignalDrawer({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  const [analysis,      setAnalysis]      = useState('')
  const [analysisLoad,  setAnalysisLoad]  = useState(false)
  const [sourceText,    setSourceText]    = useState('')
  const [sourceTitle,   setSourceTitle]   = useState('')
  const [sourceFetching,setSourceFetching]= useState(false)
  const [sourceError,   setSourceError]   = useState('')
  const [sourceFetched, setSourceFetched] = useState(false)
  const [question,      setQuestion]      = useState('')
  const [sourceAnswer,  setSourceAnswer]  = useState('')
  const [sourceAsking,  setSourceAsking]  = useState(false)

  useEffect(() => {
    if (!signal) return
    setAnalysis(''); setAnalysisLoad(true)
    setSourceText(''); setSourceTitle(''); setSourceError(''); setSourceFetched(false)
    setQuestion(''); setSourceAnswer('')
    callSales({
      action: 'agent',
      query: `Analyse this market signal: "${signal.title}". ${signal.summary_en ?? ''} What is the specific commercial implication and the single best next action for a rooibos bulk exporter?`,
    }).then(r => { setAnalysis(r); setAnalysisLoad(false) })
  }, [signal?.id])

  const fetchSource = async () => {
    if (!signal?.source_url) return
    setSourceFetching(true); setSourceError(''); setSourceText(''); setSourceTitle('')
    try {
      const r = await fetch(`/api/source-fetch?url=${encodeURIComponent(signal.source_url)}`)
      const d = await r.json()
      if (d.error && !d.text) { setSourceError(d.error); return }
      setSourceTitle(d.title || signal.title)
      setSourceText(d.text || '')
      setSourceFetched(true)
    } catch { setSourceError('Could not fetch source.') }
    finally { setSourceFetching(false) }
  }

  const askAboutSource = async () => {
    if (!question.trim() || !sourceText || sourceAsking) return
    setSourceAsking(true); setSourceAnswer('')
    const ans = await callSales({
      action: 'source_analysis',
      source_title: sourceTitle || signal?.title || '',
      source_domain: signal?.source_domain || '',
      source_text: sourceText,
      question: question.trim(),
    })
    setSourceAnswer(ans)
    setSourceAsking(false)
  }

  if (!signal) return null

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(28,25,23,0.35)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 101,
        width: 500, background: C.bg, display: 'flex', flexDirection: 'column',
        boxShadow: '-6px 0 40px rgba(0,0,0,0.14)',
        animation: 'slideInRight 0.18s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <PlatformTag type={signal.source_type} />
            <ClsTag cls={signal.classification} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: C.muted, borderRadius: 6, display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.background = C.elevated)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <X size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Title + meta */}
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.4, marginBottom: 8 }}>
              {signal.title}
            </h2>
            {signal.summary_en && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 10 }}>
                {signal.summary_en}
              </p>
            )}
            <div style={{ marginBottom: 10 }}><ScoreBar score={signal.relevance_score} /></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {signal.keyword_group && <Tag label={signal.keyword_group} color={C.red} />}
              {signal.region && <Tag label={signal.region} />}
              {(signal.audience_tags ?? []).map(t => <Tag key={t} label={t} color={C.green} />)}
              {(signal.practice_tags ?? []).map(t => <Tag key={t} label={t} color={C.amber} />)}
            </div>
          </div>

          {/* Alara auto-analysis */}
          <AiResult text={analysis} loading={analysisLoad} label="Alara Analysis" />

          {/* Source panel */}
          {signal.source_url && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {/* Source header row */}
              <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <Link2 size={11} style={{ color: C.faint, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {signal.source_domain}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {/* Open in browser */}
                  <a
                    href={signal.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.muted, textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    Open <ExternalLink size={9} />
                  </a>
                  {/* Read source for AI */}
                  {!sourceFetched && (
                    <button
                      onClick={fetchSource}
                      disabled={sourceFetching}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.redBorder}`, background: C.redBg, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.red, cursor: sourceFetching ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {sourceFetching ? <><Spinner size={10} /> Reading…</> : <>Read for AI <ChevronRight size={9} /></>}
                    </button>
                  )}
                  {sourceFetched && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, background: C.greenBg, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.green }}>
                      <CheckCircle size={9} /> Loaded
                    </span>
                  )}
                </div>
              </div>

              {sourceError && (
                <div style={{ padding: '10px 14px', fontFamily: 'var(--font-body)', fontSize: 12, color: C.amber }}>
                  {sourceError} — try opening the source directly.
                </div>
              )}

              {/* Source text preview */}
              {sourceFetched && sourceText && (
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.borderLight}` }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: C.faint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Source content
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0,
                    display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {sourceText}
                  </p>
                </div>
              )}

              {/* Ask about this source */}
              {sourceFetched && (
                <div style={{ padding: '12px 14px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={10} style={{ color: C.red }} /> Ask about this source
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && askAboutSource()}
                      placeholder="e.g. Who is the supplier mentioned? What's the pricing?"
                      style={{ ...inputStyle, fontSize: 12, padding: '7px 10px' }}
                    />
                    <button
                      onClick={askAboutSource}
                      disabled={!question.trim() || sourceAsking}
                      style={{ ...primaryBtn, padding: '7px 12px', fontSize: 12, opacity: question.trim() && !sourceAsking ? 1 : 0.4, cursor: question.trim() && !sourceAsking ? 'pointer' : 'default' }}
                    >
                      {sourceAsking ? <Spinner size={12} /> : 'Ask'}
                    </button>
                  </div>
                  {/* Quick question chips */}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: sourceAnswer ? 12 : 0 }}>
                    {[
                      'Who are the suppliers named?',
                      'What are the pricing signals?',
                      'What is the competitive implication?',
                      'What should we do with this?',
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => setQuestion(q)}
                        style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, fontFamily: 'var(--font-body)', fontSize: 10, color: C.muted, cursor: 'pointer' }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  {(sourceAnswer || sourceAsking) && (
                    <div style={{ marginTop: 10 }}>
                      <AiResult text={sourceAnswer} loading={sourceAsking} label="Source Answer" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer meta */}
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em', margin: 0 }}>
            {[signal.source_domain, timeAgo(signal.created_at)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <style>{`@keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS SECTION
// ─────────────────────────────────────────────────────────────────────────────

// n8n active sources — news pipelines running at 06:00 daily
const N8N_LIVE_SOURCES = new Set([
  'google_news','reuters','ap_news','allafrica','businesslive_sa',
  'daily_maverick','foodnavigator','foodnavigator_asia','beveragedaily','nutraingredients','n8n',
])
const SOCIAL_COMING_SOON = ['YouTube','Reddit','TikTok','Instagram','LinkedIn','X']

function SignalsSection() {
  const [signals,  setSignals]  = useState<Signal[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<Signal | null>(null)
  const [platform, setPlatform] = useState('all')
  const [cls,      setCls]      = useState('all')
  const [region,   setRegion]   = useState('all')
  const [search,   setSearch]   = useState('')
  const lastFetch = useRef(0)

  const platformMap: Record<string, string[]> = {
    news:   [...N8N_LIVE_SOURCES],
    social: ['youtube','tiktok','instagram','instagram_web','reddit','twitter','linkedin'],
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ limit: '150' })
      if (platformMap[platform]) p.set('source_type', platformMap[platform].join(','))
      if (cls !== 'all') p.set('classification', cls)
      const r = await fetch(`/api/signals?${p}`)
      const d = await r.json()
      setSignals(d.signals ?? [])
    } finally { setLoading(false); lastFetch.current = Date.now() }
  }, [platform, cls])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(() => { if (Date.now() - lastFetch.current > 290000) load() }, 60000)
    return () => clearInterval(id)
  }, [load])

  const filtered = signals.filter(s => {
    if (region !== 'all' && !(s.region ?? '').toUpperCase().includes(region.toUpperCase())) return false
    if (search) {
      const q = search.toLowerCase()
      return (s.title + (s.summary_en ?? '') + (s.source_domain ?? '')).toLowerCase().includes(q)
    }
    return true
  })

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
    fontSize: 12, fontFamily: 'var(--font-body)',
    background: C.surface, color: C.text, cursor: 'pointer', outline: 'none',
  }

  return (
    <div>
      {/* n8n status banner */}
      <div style={{ padding: '8px 28px', background: C.greenBg, borderBottom: `1px solid ${C.greenBorder}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}80` }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            n8n · News pipeline active · 06:00 daily
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, letterSpacing: '0.04em' }}>
          Social coming soon: {SOCIAL_COMING_SOON.join(' · ')}
        </span>
      </div>

      {/* Filter bar */}
      <div style={{ position: 'sticky', top: 84, zIndex: 5, padding: '10px 28px', background: C.bg, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 280 }}>
          <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search signals…"
            style={{ width: '100%', padding: '6px 10px 6px 28px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-body)', background: C.surface, color: C.text, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={selectStyle}>
          <option value="all">All platforms</option>
          <option value="news">News (live)</option>
          <option value="social">Social (coming soon)</option>
        </select>
        <select value={cls} onChange={e => setCls(e.target.value)} style={selectStyle}>
          <option value="all">All signals</option>
          <option value="opportunity">Opportunity</option>
          <option value="threat">Threat</option>
          <option value="competitor">Competitor</option>
          <option value="regulation">Regulation</option>
        </select>
        <select value={region} onChange={e => setRegion(e.target.value)} style={selectStyle}>
          <option value="all">All regions</option>
          {['ZA','GB','DE','JP','KR','AE','US','CN','AU','SG','IN'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
          <RefreshCw size={11} style={{ color: loading ? C.red : C.faint, animation: loading ? 'spin 1s linear infinite' : undefined }} />
          Refresh
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.04em', marginLeft: 'auto' }}>
          {loading ? '…' : `${filtered.length.toLocaleString()} signals`}
        </span>
      </div>

      <div style={{ padding: '22px 28px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Spinner /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint }}>Loading signals…</span></div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <Radio size={28} style={{ color: C.border, margin: '0 auto 12px' }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: C.muted }}>No signals match your filters</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))', gap: 12, alignItems: 'start' }}>
            {filtered.map(sig => <SignalCard key={sig.id} signal={sig} onClick={() => setSelected(sig)} />)}
          </div>
        )}
      </div>
      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GAP FINDER SECTION
// ─────────────────────────────────────────────────────────────────────────────

function GapSection() {
  const [mode,    setMode]    = useState<'gap' | 'variance'>('gap')
  const [market,  setMarket]  = useState('')
  const [product, setProduct] = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')

  const run = async () => {
    if (!market || loading) return
    setLoading(true); setResult('')
    const body = mode === 'gap'
      ? { action: 'gap_finder', market, product: product || 'rooibos tea' }
      : { action: 'variance_finder', market }
    const r = await callSales(body)
    setResult(r); setLoading(false)
  }

  const chipBtn = (val: string, current: string, setter: (v: string) => void): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${current === val ? C.red : C.border}`,
    background: current === val ? C.redBg : C.surface,
    color: current === val ? C.red : C.muted,
    fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>

      {/* Mode toggle */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
        {([
          { id: 'gap' as const, label: 'Gap Finder', icon: Zap, desc: 'Who is the middleman? What can\'t they do? Where do we fit?' },
          { id: 'variance' as const, label: 'Variance Finder', icon: Sparkles, desc: 'What doesn\'t exist yet in this market that we could bring?' },
        ] as const).map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setResult('') }}
            style={{
              padding: '14px 16px', borderRadius: 10,
              border: `1px solid ${mode === id ? C.red : C.border}`,
              background: mode === id ? C.redBg : C.surface,
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
            }}
          >
            <Icon size={15} style={{ color: mode === id ? C.red : C.faint, marginBottom: 7 }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: mode === id ? C.red : C.text, margin: '0 0 3px' }}>{label}</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
        {mode === 'gap' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Target market</label>
                <input value={market} onChange={e => setMarket(e.target.value)} placeholder="e.g. Germany, South Korea…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Product / category</label>
                <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. rooibos bulk, herbal tea blends…" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['Germany','South Korea','UAE','Japan','Netherlands','UK','Australia'].map(m => (
                <button key={m} onClick={() => setMarket(m)} style={chipBtn(m, market, setMarket)}>{m}</button>
              ))}
            </div>
            <div style={{ background: C.elevated, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                Alara will map who is currently supplying this market, what structural limitations they have, and the exact gap CNTP can exploit — including what they physically cannot do.
              </p>
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Target market</label>
            <input value={market} onChange={e => setMarket(e.target.value)} placeholder="e.g. Germany, South Korea…" style={{ ...inputStyle, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['Germany','South Korea','UAE','Japan','Netherlands','UK','Australia'].map(m => (
                <button key={m} onClick={() => setMarket(m)} style={chipBtn(m, market, setMarket)}>{m}</button>
              ))}
            </div>
            <div style={{ background: C.elevated, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                Alara identifies product formats, positions, and claims that don't yet exist in this market — whitespace CNTP is positioned to fill.
              </p>
            </div>
          </>
        )}
        <button
          onClick={run}
          disabled={!market || loading}
          style={{ ...primaryBtn, opacity: market && !loading ? 1 : 0.4, cursor: market && !loading ? 'pointer' : 'default' }}
        >
          {loading ? <><Spinner size={13} /> Analysing…</> : mode === 'gap' ? <><Zap size={13} /> Find the gap</> : <><Sparkles size={13} /> Find variances</>}
        </button>
      </div>

      <AiResult text={result} loading={loading} label={mode === 'gap' ? 'Gap Analysis' : 'Variance Map'} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOPHOLES SECTION
// ─────────────────────────────────────────────────────────────────────────────

function LoopholesSection() {
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')
  const [keyword, setKeyword] = useState('')

  const scan = async () => {
    setLoading(true); setResult('')
    const r = await callSales({ action: 'loophole_scan', keyword: keyword || undefined })
    setResult(r); setLoading(false)
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24, padding: '16px 18px', background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 10 }}>
        <AlertTriangle size={16} style={{ color: C.amber, flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>
            The Bad News Layer
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
            Most intelligence tools only surface good news. This tab actively hunts for competitor weaknesses, supply chain disruptions, quality recalls, and market exits — because someone else's problem is your opportunity window.
          </p>
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
        <label style={labelStyle}>Focus keyword (optional)</label>
        <input
          value={keyword} onChange={e => setKeyword(e.target.value)}
          placeholder="e.g. rooibos quality, Martin Bauer, Germany supply chain…"
          style={{ ...inputStyle, marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
          {['rooibos shortage','competitor recall','price dumping','supply disruption','market exit'].map(k => (
            <button
              key={k}
              onClick={() => setKeyword(k)}
              style={{
                padding: '4px 10px', borderRadius: 5,
                border: `1px solid ${keyword === k ? C.amber : C.border}`,
                background: keyword === k ? C.amberBg : C.surface,
                color: keyword === k ? C.amber : C.muted,
                fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            { label: 'Competitor weaknesses', desc: 'Quality, supply, credibility issues' },
            { label: 'Supply chain gaps',      desc: 'Disruptions in competing origins' },
            { label: 'Regulatory openings',    desc: 'New standards competitors haven\'t met' },
            { label: 'Unmet buyer demand',      desc: 'Markets looking for what we have' },
          ].map(({ label, desc }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', background: C.elevated, borderRadius: 7 }}>
              <CheckCircle size={11} style={{ color: C.green, flexShrink: 0 }} />
              <div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: C.text, margin: 0 }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: C.faint, margin: 0 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button onClick={scan} disabled={loading} style={{ ...primaryBtn, background: C.amber, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? <><Spinner size={13} /> Scanning…</> : <><AlertTriangle size={13} /> Scan for loopholes</>}
        </button>
      </div>

      <AiResult text={result} loading={loading} label="Loophole Scan" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEL SECTION (unchanged tools, same as before)
// ─────────────────────────────────────────────────────────────────────────────

const INTEL_TOOLS: { id: IntelTool; label: string; Icon: React.ElementType; desc: string }[] = [
  { id: 'briefing',    Icon: BarChart2,  label: 'Market Briefing',  desc: 'Daily global snapshot + action'               },
  { id: 'frontier',    Icon: Globe,      label: 'Frontier Scout',   desc: 'Country entry + cultural brief'               },
  { id: 'competitors', Icon: TrendingUp, label: 'Competitor Watch', desc: 'Gaps, advantages, outflanking moves'          },
  { id: 'profiler',    Icon: Building2,  label: 'Company Profiler', desc: 'Buyer dossier + approach strategy'            },
  { id: 'pitch',       Icon: Mail,       label: 'Pitch Structurer', desc: 'You know the buyer — we structure the pitch'  },
  { id: 'alerts',      Icon: Bell,       label: 'Alerts',           desc: '5 urgent signals + opportunity windows'       },
]

function IntelSection() {
  const [tool,    setTool]    = useState<IntelTool>('briefing')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')
  const [f1, setF1] = useState('')
  const [f2, setF2] = useState('')
  const [f3, setF3] = useState('')

  const call = async (body: Record<string, unknown>) => {
    setLoading(true); setResult('')
    callSales(body).then(r => { setResult(r); setLoading(false) })
  }
  const changeTool = (t: IntelTool) => { setTool(t); setResult(''); setF1(''); setF2(''); setF3('') }

  const chipBtn = (val: string, current: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${current === val ? C.red : C.border}`,
    background: current === val ? C.redBg : C.surface,
    color: current === val ? C.red : C.muted,
    fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer',
  })

  const renderForm = () => {
    switch (tool) {
      case 'briefing':
        return (
          <div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
              Daily market snapshot — top opportunities, risks to watch, and one concrete action before Friday.
            </p>
            <button onClick={() => call({ action: 'briefing' })} style={primaryBtn}><BarChart2 size={13} /> Generate today's briefing</button>
          </div>
        )
      case 'frontier':
        return (
          <div>
            <label style={labelStyle}>Target country</label>
            <input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. South Korea, UAE, Poland…" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['South Korea','UAE','Germany','Brazil','India','Netherlands','Poland','Australia'].map(c => (
                <button key={c} onClick={() => setF1(c)} style={chipBtn(c, f1)}>{c}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => f1 && call({ action: 'market_entry', country: f1 })} disabled={!f1} style={{ ...primaryBtn, opacity: f1 ? 1 : 0.4 }}><Globe size={13} /> Scout market</button>
              <button onClick={() => f1 && call({ action: 'cultural_scout', country: f1 })} disabled={!f1} style={{ ...ghostBtn, opacity: f1 ? 1 : 0.4 }}>Cultural brief</button>
            </div>
          </div>
        )
      case 'competitors':
        return (
          <div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
              Rooibos Ltd, Cape Natural Tea, Carmién, Khoisan, and emerging players — full competitive landscape with exploitable gaps.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => call({ action: 'competitor_scan' })} style={primaryBtn}><TrendingUp size={13} /> Full scan</button>
              <button onClick={() => call({ action: 'competitor_gaps' })} style={ghostBtn}>Exploit gaps</button>
            </div>
          </div>
        )
      case 'profiler':
        return (
          <div>
            <label style={labelStyle}>Company name</label>
            <input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. T2 Tea, Pukka Herbs, Teekanne…" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Audience tag (optional)</label>
            <input value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. halal, women, gen_z, kosher…" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['halal','kosher','vegan','women','gen_z','millennial'].map(t => (
                <button key={t} onClick={() => setF2(t)} style={chipBtn(t, f2)}>{t}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => f1 && call({ action: 'company_profile', company: f1 })} disabled={!f1} style={{ ...primaryBtn, opacity: f1 ? 1 : 0.4 }}><Building2 size={13} /> Build dossier</button>
              {f2 && <button onClick={() => call({ action: 'audience_signals', audience_tag: f2 })} style={ghostBtn}>Audience signals</button>}
            </div>
          </div>
        )
      case 'pitch':
        return (
          <div>
            <div style={{ background: C.elevated, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                You bring the knowledge. Alara structures the approach. Fill in what you know about the buyer — the AI does the rest.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Target market</label>
                <input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. Germany, South Korea…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Buyer type</label>
                <input value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. K-beauty brand, tea distributor…" style={inputStyle} />
              </div>
            </div>
            <label style={labelStyle}>Product format</label>
            <input value={f3} onChange={e => setF3(e.target.value)} placeholder="e.g. bulk loose leaf, RTD concentrate…" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['bulk loose leaf','rooibos extract','RTD concentrate','private label','OEM blend'].map(fmt => (
                <button key={fmt} onClick={() => setF3(fmt)} style={chipBtn(fmt, f3)}>{fmt}</button>
              ))}
            </div>
            <button
              onClick={() => f1 && f2 && f3 && call({ action: 'pitch_builder', target_market: f1, buyer_type: f2, product_format: f3 })}
              disabled={!f1 || !f2 || !f3}
              style={{ ...primaryBtn, opacity: f1 && f2 && f3 ? 1 : 0.4 }}
            >
              <Mail size={13} /> Structure my pitch
            </button>
          </div>
        )
      case 'alerts':
        return (
          <div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
              5 urgent alerts — competitor moves, demand signals, regulatory changes, and time-sensitive windows.
            </p>
            <button onClick={() => call({ action: 'alerts' })} style={primaryBtn}><Bell size={13} /> Generate alerts</button>
          </div>
        )
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 24 }}>
        {INTEL_TOOLS.map(({ id, label, Icon, desc }) => {
          const active = tool === id
          return (
            <button key={id} onClick={() => changeTool(id)} style={{ padding: '12px 14px', borderRadius: 9, border: `1px solid ${active ? C.red : C.border}`, background: active ? C.redBg : C.surface, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}>
              <Icon size={14} style={{ color: active ? C.red : C.faint, marginBottom: 6 }} />
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: active ? C.red : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {(() => { const t = INTEL_TOOLS.find(t => t.id === tool)!; return <t.Icon size={14} style={{ color: C.red }} /> })()}
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: C.text }}>
            {INTEL_TOOLS.find(t => t.id === tool)?.label}
          </span>
        </div>
        {renderForm()}
      </div>
      <AiResult text={result} loading={loading} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT SECTION
// ─────────────────────────────────────────────────────────────────────────────

function VaultSection() {
  const [files,     setFiles]     = useState<VaultFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [query,     setQuery]     = useState('')
  const [answer,    setAnswer]    = useState('')
  const [querying,  setQuerying]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    setUploading(true); setUploadMsg(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const r = await fetch('/api/vault/upload', { method: 'POST', body: form })
      const d = await r.json()
      if (d.success) {
        setUploadMsg({ ok: true, text: `"${d.filename}" indexed — ${d.category_detected} · ~${d.estimated_chunks} chunks` })
        setFiles(prev => [{ name: d.filename, category: d.category_detected, uploadedAt: new Date().toISOString(), size: file.size }, ...prev])
      } else {
        setUploadMsg({ ok: false, text: d.error ?? 'Upload failed.' })
      }
    } catch { setUploadMsg({ ok: false, text: 'Upload failed.' }) }
    finally { setUploading(false) }
  }

  const runQuery = async () => {
    if (!query.trim() || querying) return
    setQuerying(true); setAnswer('')
    try {
      const r = await fetch('/api/vault/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const d = await r.json()
      setAnswer(d.answer ?? d.error ?? 'No answer.')
    } catch { setAnswer('Query failed.') }
    finally { setQuerying(false) }
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Leaf size={13} style={{ color: C.red, flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
          Everything you add here trains Alara's responses. Trip reports, pricing history, contracts, and competitor intel all improve Gap Finder, Pitch Structurer, and Loophole Scan results over time.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Add to vault</p>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f) }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${C.border}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: uploading ? C.redBg : C.surface, marginBottom: 12, transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!uploading) (e.currentTarget as HTMLElement).style.borderColor = C.redBorderMd }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border }}
          >
            <Upload size={20} style={{ color: uploading ? C.red : C.faint, margin: '0 auto 8px', display: 'block' }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: uploading ? C.red : C.text, margin: '0 0 3px' }}>
              {uploading ? 'Uploading…' : 'Drop a file or click to browse'}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, margin: 0, letterSpacing: '0.03em' }}>
              PDF · PPTX · XLSX · DOCX · CSV · TXT · Max 50MB
            </p>
            <input ref={fileRef} type="file" accept=".pdf,.pptx,.xlsx,.docx,.csv,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
          </div>
          {uploadMsg && (
            <div style={{ padding: '9px 14px', borderRadius: 7, marginBottom: 14, background: uploadMsg.ok ? C.greenBg : '#FFEBEE', border: `1px solid ${uploadMsg.ok ? C.greenBorder : 'rgba(198,40,40,0.2)'}`, fontFamily: 'var(--font-body)', fontSize: 12, color: uploadMsg.ok ? C.green : '#C62828' }}>
              {uploadMsg.text}
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: C.faint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Indexed this session</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7 }}>
                    <FileText size={13} style={{ color: C.faint, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, color: C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</p>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, margin: 0 }}>{(f.size / 1024).toFixed(0)} KB · {timeAgo(f.uploadedAt)}</p>
                    </div>
                    <Tag label={f.category} color={C.red} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Query the vault</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.faint, marginBottom: 14, lineHeight: 1.6 }}>
            Alara synthesises answers from your private documents. Raw content is never returned.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runQuery()} placeholder="e.g. What did we quote Germany last year?" style={{ flex: 1, padding: '8px 12px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'var(--font-body)', background: C.surface, color: C.text, outline: 'none' }} />
            <button onClick={runQuery} disabled={!query.trim() || querying} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, border: 'none', background: query.trim() && !querying ? C.red : C.border, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: query.trim() && !querying ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
              {querying ? <Spinner /> : 'Ask'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
            {['Any Korea trip reports?','Latest Germany pricing?','Japan volume commitments?','Pending contracts?'].map(q => (
              <button key={q} onClick={() => setQuery(q)} style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer' }}>{q}</button>
            ))}
          </div>
          <AiResult text={answer} loading={querying} label="Vault Answer" />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPASS SECTION
// ─────────────────────────────────────────────────────────────────────────────

const VECTORS: { id: CompassVec; label: string; Icon: React.ElementType; desc: string; tag: string }[] = [
  { id: 'red_espresso',   label: 'Red Espresso',    Icon: Coffee,       desc: 'Barista trend, specialty coffee applications',  tag: 'Beverage'  },
  { id: 'k_beauty',       label: 'K / J Beauty',    Icon: FlaskConical, desc: 'Aspalathin cosmetics, skincare launches',       tag: 'Cosmetics' },
  { id: 'clinical',       label: 'Clinical',        Icon: Sun,          desc: 'Hospital nutrition, medical dietary channel',   tag: 'Health'    },
  { id: 'functional_oem', label: 'Functional OEM',  Icon: Factory,      desc: 'Manufacturers seeking SA hero ingredient',      tag: 'B2B'       },
  { id: 'agriculture',    label: 'Agriculture',     Icon: Wheat,        desc: 'Cederberg harvest, weather, cooperative news',  tag: 'Supply'    },
  { id: 'appellation',    label: 'Appellation',     Icon: Award,        desc: 'Aspalathus linearis grown outside SA?',         tag: 'Legal'     },
  { id: 'japan',          label: 'Japan Deepening', Icon: Flag,         desc: 'Volume growth, new lines, machinery JV',        tag: 'Strategic' },
]

function CompassSection() {
  const [vec,     setVec]     = useState<CompassVec>('red_espresso')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')
  const selected = VECTORS.find(v => v.id === vec)!

  const generate = async () => {
    setLoading(true); setResult('')
    callSales({ action: 'expansion_briefing', vector: vec }).then(r => { setResult(r); setLoading(false) })
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 8, marginBottom: 24 }}>
        {VECTORS.map(({ id, label, Icon, desc, tag }) => {
          const active = vec === id
          return (
            <button key={id} onClick={() => { setVec(id); setResult('') }} style={{ padding: '13px 14px', borderRadius: 9, border: `1px solid ${active ? C.red : C.border}`, background: active ? C.redBg : C.surface, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                <Icon size={14} style={{ color: active ? C.red : C.faint }} />
                <Tag label={tag} color={active ? C.red : undefined} />
              </div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: active ? C.red : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <selected.Icon size={16} style={{ color: C.red }} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{selected.label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: '2px 0 0' }}>{selected.desc}</p>
            </div>
          </div>
          <button onClick={generate} disabled={loading} style={{ ...primaryBtn, background: loading ? C.border : C.red, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? <><Spinner size={13} /> Generating…</> : <><Sparkles size={13} /> Get briefing</>}
          </button>
        </div>
      </div>
      {result && <AiResult text={result} loading={false} label={`${selected.label} Briefing`} />}
      {!result && !loading && (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <Compass size={26} style={{ color: C.border, margin: '0 auto 10px', display: 'block' }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.faint }}>Select an expansion vector and click "Get briefing".</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROOT
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: 'signals',   label: 'Signal Feed',   Icon: Radio         },
  { id: 'gap',       label: 'Gap Finder',    Icon: Zap           },
  { id: 'loopholes', label: 'Loopholes',     Icon: AlertTriangle },
  { id: 'intel',     label: 'Intelligence',  Icon: Sparkles      },
  { id: 'vault',     label: 'Vault',         Icon: Lock          },
  { id: 'compass',   label: 'Compass',       Icon: Compass       },
]

export default function ResearchPage() {
  const [section, setSection] = useState<Section>('signals')

  return (
    <div style={{ background: C.bg, minHeight: '100%', fontFamily: 'var(--font-body)' }}>

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: C.bg }}>
        <div style={{ padding: '11px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.borderLight}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: `linear-gradient(135deg, ${C.red}, ${C.redLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 8px ${C.redBg}` }}>
              <Leaf size={13} style={{ color: '#fff' }} />
            </div>
            <div>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>Alara</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, letterSpacing: '0.1em', marginLeft: 8, textTransform: 'uppercase' }}>Rooibos Intelligence Engine</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}80` }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Engine active</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', padding: '0 20px', background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          {SECTIONS.map(({ id, label, Icon }) => {
            const active = section === id
            const isLoophole = id === 'loopholes'
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: active ? `2px solid ${isLoophole ? C.amber : C.red}` : '2px solid transparent',
                  color: active ? (isLoophole ? C.amber : C.red) : C.faint,
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 600 : 400,
                  transition: 'color 0.1s, border-color 0.1s', marginBottom: -1,
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {section === 'signals'   && <SignalsSection   />}
      {section === 'gap'       && <GapSection       />}
      {section === 'loopholes' && <LoopholesSection />}
      {section === 'intel'     && <IntelSection     />}
      {section === 'vault'     && <VaultSection     />}
      {section === 'compass'   && <CompassSection   />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
