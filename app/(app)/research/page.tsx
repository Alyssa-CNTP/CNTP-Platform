'use client'

// app/(app)/research/page.tsx
// Alara — Rooibos Intelligence Engine

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Radio, Sparkles, Lock, Compass, Search, RefreshCw,
  ExternalLink, X, Upload, FileText, BarChart2, Globe,
  TrendingUp, Building2, Mail, Bell, Leaf, FlaskConical,
  Factory, Sun, Award, Flag, CheckCircle, Loader2,
  Coffee, Wheat, AlertTriangle, Zap,
  Link2, MessageSquare, ChevronRight, Info, UserPlus, Save,
  Bookmark, Map, List, ArrowUpRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section    = 'signals' | 'gap' | 'loopholes' | 'intel' | 'vault' | 'compass' | 'about'
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
  // Header (dark forest green)
  header:       '#0D1B09',
  headerSurface:'#152613',
  headerText:   '#F0EDE6',
  headerMuted:  '#7A9A72',
  headerBorder: 'rgba(255,255,255,0.08)',
  headerActive: '#6DB55A',
  // Page
  bg:          '#F0EDE6',
  surface:     '#FFFFFF',
  elevated:    '#F5F2EB',
  border:      '#E0D9CF',
  borderLight: '#EAE5DC',
  text:        '#1A1714',
  muted:       '#5A5248',
  faint:       '#988C82',
  // Brand (forest green — primary actions, save, active states)
  brand:       '#2D6B1E',
  brandLight:  '#3D8A2C',
  brandBg:     'rgba(45,107,30,0.08)',
  brandBorder: 'rgba(45,107,30,0.20)',
  // Semantic green (opportunity)
  green:       '#1E7A3F',
  greenBg:     '#E8F5EE',
  greenBorder: 'rgba(30,122,63,0.22)',
  // Terracotta (threat / alert)
  red:         '#B84B25',
  redLight:    '#D06040',
  redBg:       'rgba(184,75,37,0.07)',
  redBorder:   'rgba(184,75,37,0.18)',
  redBorderMd: 'rgba(184,75,37,0.32)',
  // Amber (loopholes / warning)
  amber:       '#A87010',
  amberBg:     'rgba(168,112,16,0.07)',
  amberBorder: 'rgba(168,112,16,0.22)',
}

// ─── Shared map (client-only) ─────────────────────────────────────────────────

const SignalMap = dynamic(() => import('@/components/intelligence/SignalMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, borderRadius: 10, background: '#0D1F0D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4a7a4a', letterSpacing: '0.08em' }}>Loading map…</span>
    </div>
  ),
})

// ─── Filter constants ─────────────────────────────────────────────────────────

const CLS_OPTIONS = ['all','opportunity','threat','competitor','regulation','relationship','neutral'] as const
type ClsFilter  = typeof CLS_OPTIONS[number]
type RelvBucket = 'all' | 'high' | 'medium' | 'low'
type SortMode   = 'newest' | 'score' | 'oldest'
const SIG_PAGE  = 50

// ─── Primitives ───────────────────────────────────────────────────────────────

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: color ?? C.brand }} />
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
  const map: Record<string, { bg: string; label: string }> = {
    youtube:            { bg: '#CC0000', label: 'YouTube'       },
    tiktok:             { bg: '#010101', label: 'TikTok'        },
    instagram:          { bg: '#C13584', label: 'Instagram'     },
    instagram_web:      { bg: '#C13584', label: 'Instagram'     },
    reddit:             { bg: '#FF4500', label: 'Reddit'        },
    linkedin:           { bg: '#0A66C2', label: 'LinkedIn'      },
    twitter:            { bg: '#000000', label: 'X'             },
    google_news:        { bg: '#4285F4', label: 'News'          },
    reuters:            { bg: '#FF8000', label: 'Reuters'       },
    ap_news:            { bg: '#CC0000', label: 'AP News'       },
    allafrica:          { bg: '#006400', label: 'AllAfrica'     },
    businesslive_sa:    { bg: '#002147', label: 'BusinessLive'  },
    daily_maverick:     { bg: '#1a1a1a', label: 'Daily Maverick'},
    foodnavigator:      { bg: '#2E7D32', label: 'FoodNav'       },
    foodnavigator_asia: { bg: '#1B5E20', label: 'FoodNav Asia'  },
    beveragedaily:      { bg: '#0277BD', label: 'BeverageDaily' },
    nutraingredients:   { bg: '#6A1B9A', label: 'NutraIng.'    },
    n8n:                { bg: '#EA4B71', label: 'Auto'          },
  }
  const s = map[type] ?? { bg: C.faint, label: type }
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

function AiResult({ text, loading, label = 'Alara Analysis', saveable = false, reportType = 'briefing' }: {
  text: string; loading: boolean; label?: string; saveable?: boolean; reportType?: string
}) {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const saveReport = async () => {
    if (saving || saved || !text) return
    setSaving(true)
    try {
      await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_report', title: label, report_type: reportType, body: text }),
      })
      setSaved(true)
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <Spinner />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint, letterSpacing: '0.05em' }}>Generating…</span>
    </div>
  )
  if (!text) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Leaf size={11} style={{ color: C.brand, opacity: 0.8 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.brand, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {label}
          </span>
        </div>
        {saveable && (
          <button
            onClick={saveReport}
            disabled={saving || saved}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 5, border: `1px solid ${saved ? C.greenBorder : C.border}`, background: saved ? C.greenBg : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9, color: saved ? C.green : C.faint, cursor: saved || saving ? 'default' : 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
          >
            {saved ? <><CheckCircle size={9} /> Saved</> : saving ? <><Spinner size={9} /> Saving…</> : <><Save size={9} /> Save to reports</>}
          </button>
        )}
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
  background: C.brand, color: '#fff',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const ghostBtn: React.CSSProperties = {
  ...primaryBtn, background: 'transparent', color: C.brand,
  border: `1px solid ${C.brandBorder}`,
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard({ signalCount, lastUpdated }: { signalCount: number; lastUpdated: Date | null }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      borderRadius: 14,
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #0D1B09 0%, #1E3B14 55%, #2D5A20 100%)',
      padding: '32px 36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
      minHeight: 180,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(109,181,90,0.18)', border: '1px solid rgba(109,181,90,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Leaf size={16} style={{ color: '#8BC47A' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8BC47A', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Rooibos Intelligence Engine
          </span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: '#F0EDE6', letterSpacing: '-0.03em', margin: '0 0 8px', lineHeight: 1 }}>
          Alara
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(240,237,230,0.65)', margin: '0 0 20px', maxWidth: 480, lineHeight: 1.65 }}>
          Live market intelligence for rooibos export — ranked signals from 15+ sources, updated daily at 06:00 SAST.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: 'rgba(109,181,90,0.12)', border: '1px solid rgba(109,181,90,0.22)', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8BC47A', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6DB55A', boxShadow: '0 0 6px #6DB55A', display: 'inline-block' }} />
            Engine active
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(240,237,230,0.55)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {signalCount > 0 ? signalCount.toLocaleString() : '—'} signals
          </span>
          {lastUpdated && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(240,237,230,0.55)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Updated {timeAgo(lastUpdated.toISOString())}
            </span>
          )}
        </div>
      </div>
      <div style={{ width: 130, height: 130, borderRadius: '50%', background: 'radial-gradient(circle, rgba(109,181,90,0.18) 0%, rgba(45,107,30,0.35) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 60px rgba(109,181,90,0.12)' }}>
        <Leaf size={52} style={{ color: 'rgba(109,181,90,0.55)' }} />
      </div>
    </div>
  )
}

// ─── Signal card ──────────────────────────────────────────────────────────────

const CLS_GRADIENT: Record<string, string> = {
  opportunity: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 100%)',
  threat:      'linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)',
  competitor:  'linear-gradient(135deg, #78350F 0%, #92400E 100%)',
  regulation:  'linear-gradient(135deg, #1E3A5F 0%, #1E40AF 100%)',
  relationship:'linear-gradient(135deg, #4A1942 0%, #6B21A8 100%)',
  neutral:     'linear-gradient(135deg, #1C1917 0%, #44403C 100%)',
}

function SignalCard({ signal, onClick, onSendTo }: {
  signal: Signal
  onClick: () => void
  onSendTo: (section: 'gap' | 'loopholes', term: string) => void
}) {
  const [bookmarked,  setBookmarked]  = useState(false)
  const [promoted,    setPromoted]    = useState(false)
  const [bookmarking, setBookmarking] = useState(false)
  const [promoting,   setPromoting]   = useState(false)

  const bookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (bookmarked || bookmarking) return
    setBookmarking(true)
    try {
      await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bookmark_signal', signal_id: signal.id, title: signal.title }),
      })
      setBookmarked(true)
    } finally { setBookmarking(false) }
  }

  const promote = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (promoted || promoting) return
    setPromoting(true)
    try {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             signal.title.slice(0, 120),
          source_signal_id: signal.id,
          signal_ids:       [signal.id],
          signal_title:     signal.title,
          stage:            'lead',
          notes:            signal.summary_en ?? '',
        }),
      })
      setPromoted(true)
    } finally { setPromoting(false) }
  }

  return (
    <div
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.15s, box-shadow 0.15s', cursor: 'pointer' }}
      onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.brandBorder; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px ${C.brandBg}` }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
    >
      {/* Image / gradient area */}
      <div style={{ height: 148, background: signal.media_url ? undefined : (CLS_GRADIENT[signal.classification] ?? CLS_GRADIENT.neutral), overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
        {signal.media_url && (
          <img src={signal.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!signal.media_url && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Leaf size={44} style={{ color: 'rgba(255,255,255,0.18)' }} />
          </div>
        )}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <PlatformTag type={signal.source_type} />
        </div>
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <ClsTag cls={signal.classification} />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 9 }}><ScoreBar score={signal.relevance_score} /></div>

        <p style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.4, margin: '0 0 7px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {signal.title}
        </p>

        {signal.summary_en && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, lineHeight: 1.65, margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
            {signal.summary_en}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em' }}>
            {[signal.region, timeAgo(signal.created_at)].filter(Boolean).join(' · ')}
          </span>
          {signal.source_url && (
            <a
              href={signal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, textDecoration: 'none' }}
            >
              Source <ArrowUpRight size={9} />
            </a>
          )}
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 5, borderTop: `1px solid ${C.borderLight}`, paddingTop: 10 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={bookmark}
            title="Save for later"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 0', borderRadius: 6, border: `1px solid ${bookmarked ? C.brandBorder : C.border}`, background: bookmarked ? C.brandBg : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9, color: bookmarked ? C.brand : C.faint, cursor: 'pointer', letterSpacing: '0.04em' }}
          >
            {bookmarking ? <Spinner size={9} /> : <Bookmark size={9} fill={bookmarked ? C.brand : 'none'} />} Save
          </button>
          <button
            onClick={promote}
            title="Add to lead pipeline"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 0', borderRadius: 6, border: `1px solid ${promoted ? C.greenBorder : C.border}`, background: promoted ? C.greenBg : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9, color: promoted ? C.green : C.faint, cursor: 'pointer', letterSpacing: '0.04em' }}
          >
            {promoting ? <Spinner size={9} /> : <UserPlus size={9} />} Lead
          </button>
          <button
            onClick={() => onSendTo('gap', signal.keyword_group ?? signal.title.slice(0, 50))}
            title="Analyse as market gap"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 0', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, cursor: 'pointer', letterSpacing: '0.04em', transition: 'border-color 0.1s, color 0.1s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.brandBorder; (e.currentTarget as HTMLElement).style.color = C.brand }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.faint }}
          >
            <Zap size={9} /> Gap
          </button>
          <button
            onClick={() => onSendTo('loopholes', signal.keyword_group ?? signal.title.slice(0, 50))}
            title="Check for loopholes"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 0', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, cursor: 'pointer', letterSpacing: '0.04em', transition: 'border-color 0.1s, color 0.1s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.amberBorder; (e.currentTarget as HTMLElement).style.color = C.amber }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.faint }}
          >
            <AlertTriangle size={9} /> Loophole
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Signal drawer ────────────────────────────────────────────────────────────

function SignalDrawer({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  const [analysis,       setAnalysis]       = useState('')
  const [analysisLoad,   setAnalysisLoad]   = useState(false)
  const [sourceText,     setSourceText]     = useState('')
  const [sourceTitle,    setSourceTitle]    = useState('')
  const [sourceFetching, setSourceFetching] = useState(false)
  const [sourceError,    setSourceError]    = useState('')
  const [sourceFetched,  setSourceFetched]  = useState(false)
  const [question,       setQuestion]       = useState('')
  const [sourceAnswer,   setSourceAnswer]   = useState('')
  const [sourceAsking,   setSourceAsking]   = useState(false)
  const [promoting,      setPromoting]      = useState(false)
  const [promoted,       setPromoted]       = useState(false)

  useEffect(() => {
    if (!signal) return
    setAnalysis(''); setAnalysisLoad(false)
    setSourceText(''); setSourceTitle(''); setSourceError(''); setSourceFetched(false)
    setQuestion(''); setSourceAnswer('')
    setPromoted(false)
  }, [signal?.id])

  const runAnalysis = async () => {
    if (!signal || analysisLoad) return
    setAnalysisLoad(true); setAnalysis('')
    const r = await callSales({
      action: 'agent',
      query: `Analyse this market signal: "${signal.title}". ${signal.summary_en ?? ''} What is the specific commercial implication and the single best next action for a rooibos bulk exporter?`,
    })
    setAnalysis(r); setAnalysisLoad(false)
  }

  const promoteToLead = async () => {
    if (!signal || promoting || promoted) return
    setPromoting(true)
    try {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             signal.title.slice(0, 120),
          source_signal_id: signal.id,
          signal_ids:       [signal.id],
          signal_title:     signal.title,
          stage:            'lead',
          notes:            signal.summary_en ?? '',
        }),
      })
      setPromoted(true)
    } finally { setPromoting(false) }
  }

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
      source_title:  sourceTitle || signal?.title || '',
      source_domain: signal?.source_domain || '',
      source_text:   sourceText,
      question:      question.trim(),
    })
    setSourceAnswer(ans)
    setSourceAsking(false)
  }

  if (!signal) return null

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(28,25,23,0.35)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 101, width: 500, background: C.bg, display: 'flex', flexDirection: 'column', boxShadow: '-6px 0 40px rgba(0,0,0,0.14)', animation: 'slideInRight 0.18s ease' }}>

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
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Title + meta */}
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.4, marginBottom: 8 }}>
              {signal.title}
            </h2>
            {signal.summary_en && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 10 }}>
                {signal.summary_en}
              </p>
            )}
            <div style={{ marginBottom: 10 }}><ScoreBar score={signal.relevance_score} /></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {signal.keyword_group && <Tag label={signal.keyword_group} color={C.brand} />}
              {signal.region && <Tag label={signal.region} />}
              {(signal.audience_tags ?? []).map(t => <Tag key={t} label={t} color={C.green} />)}
              {(signal.practice_tags ?? []).map(t => <Tag key={t} label={t} color={C.amber} />)}
            </div>
          </div>

          {/* Analyse button */}
          {!analysis && !analysisLoad && (
            <button
              onClick={runAnalysis}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.brandBorder}`, background: C.brandBg, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: C.brand, cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              <Leaf size={14} /> Analyse with Alara
            </button>
          )}
          {(analysis || analysisLoad) && (
            <AiResult text={analysis} loading={analysisLoad} label="Alara Analysis" />
          )}

          {/* Promote to Lead */}
          <button
            onClick={promoteToLead}
            disabled={promoting || promoted}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, border: `1px solid ${promoted ? C.greenBorder : C.brandBorder}`, background: promoted ? C.greenBg : C.brandBg, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: promoted ? C.green : C.brand, cursor: promoting || promoted ? 'default' : 'pointer', opacity: promoting ? 0.6 : 1, alignSelf: 'flex-start' }}
          >
            {promoted
              ? <><CheckCircle size={13} /> Added to Lead Pipeline</>
              : promoting
                ? <><Spinner size={13} /> Promoting…</>
                : <><UserPlus size={13} /> Promote to Lead</>
            }
          </button>

          {/* Source panel */}
          {signal.source_url && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <Link2 size={11} style={{ color: C.faint, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {signal.source_domain}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <a href={signal.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.muted, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Open <ExternalLink size={9} />
                  </a>
                  {!sourceFetched && (
                    <button onClick={fetchSource} disabled={sourceFetching}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.brandBorder}`, background: C.brandBg, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.brand, cursor: sourceFetching ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
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

              {sourceFetched && sourceText && (
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.borderLight}` }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: C.faint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Source content</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {sourceText}
                  </p>
                </div>
              )}

              {sourceFetched && (
                <div style={{ padding: '12px 14px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.brand, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={10} /> Ask about this source
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAboutSource()}
                      placeholder="e.g. Who is the supplier mentioned? What's the pricing?"
                      style={{ ...inputStyle, fontSize: 12, padding: '7px 10px' }} />
                    <button onClick={askAboutSource} disabled={!question.trim() || sourceAsking}
                      style={{ ...primaryBtn, padding: '7px 12px', fontSize: 12, opacity: question.trim() && !sourceAsking ? 1 : 0.4, cursor: question.trim() && !sourceAsking ? 'pointer' : 'default' }}>
                      {sourceAsking ? <Spinner size={12} /> : 'Ask'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: sourceAnswer ? 12 : 0 }}>
                    {['Who are the suppliers named?','What are the pricing signals?','What is the competitive implication?','What should we do with this?'].map(q => (
                      <button key={q} onClick={() => setQuestion(q)}
                        style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, fontFamily: 'var(--font-body)', fontSize: 10, color: C.muted, cursor: 'pointer' }}>
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

          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.03em', margin: 0 }}>
            {[signal.source_domain, timeAgo(signal.created_at)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <style>{`@keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
    </>
  )
}

// ─── Signals section ──────────────────────────────────────────────────────────

function SignalsSection({ onSendTo }: { onSendTo: (s: 'gap' | 'loopholes', term: string) => void }) {
  const [signals,     setSignals]     = useState<Signal[]>([])
  const [totalCount,  setTotalCount]  = useState<number | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Signal | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showMap,     setShowMap]     = useState(false)

  const [search,       setSearch]       = useState('')
  const [clsFilter,    setClsFilter]    = useState<ClsFilter>('all')
  const [regionFilter, setRegionFilter] = useState('all')
  const [groupFilter,  setGroupFilter]  = useState('all')
  const [relevance,    setRelevance]    = useState<RelvBucket>('all')
  const [sort,         setSort]         = useState<SortMode>('newest')
  const [visible,      setVisible]      = useState(SIG_PAGE)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sigRes, cntRes] = await Promise.all([
        fetch('/api/signals?limit=300'),
        fetch('/api/signals?count=true'),
      ])
      const { signals: data } = await sigRes.json()
      setSignals(data ?? [])
      if (cntRes.ok) { const { count } = await cntRes.json(); setTotalCount(count ?? 0) }
      setLastUpdated(new Date())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const regions = useMemo(() => {
    const s = new Set<string>(); signals.forEach(sig => { if (sig.region) s.add(sig.region) }); return Array.from(s).sort()
  }, [signals])

  const groups = useMemo(() => {
    const s = new Set<string>(); signals.forEach(sig => { if (sig.keyword_group) s.add(sig.keyword_group) }); return Array.from(s).sort()
  }, [signals])

  const stats = useMemo(() => ({
    opps:    signals.filter(s => s.classification === 'opportunity').length,
    threats: signals.filter(s => s.classification === 'threat').length,
    avg:     signals.length ? Math.round(signals.reduce((a, s) => a + s.relevance_score, 0) / signals.length * 10) / 10 : 0,
  }), [signals])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = signals.filter(s => {
      if (clsFilter !== 'all' && s.classification !== clsFilter) return false
      if (regionFilter !== 'all' && s.region !== regionFilter) return false
      if (groupFilter !== 'all' && s.keyword_group !== groupFilter) return false
      if (relevance === 'high' && s.relevance_score < 7) return false
      if (relevance === 'medium' && (s.relevance_score < 4 || s.relevance_score > 6)) return false
      if (relevance === 'low' && s.relevance_score > 3) return false
      if (q && !(s.title + (s.summary_en ?? '') + (s.source_domain ?? '')).toLowerCase().includes(q)) return false
      return true
    })
    list = [...list].sort((a, b) => {
      if (sort === 'score') return b.relevance_score - a.relevance_score
      if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return list
  }, [signals, search, clsFilter, regionFilter, groupFilter, relevance, sort])

  useEffect(() => { setVisible(SIG_PAGE) }, [search, clsFilter, regionFilter, groupFilter, relevance, sort])

  const visibleSignals = filtered.slice(0, visible)

  const selStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: `1px solid ${C.border}`, fontSize: 12,
    fontFamily: 'var(--font-body)', background: C.surface,
    color: C.text, outline: 'none',
  }

  const filterChip = (active: boolean, color = C.brand): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${active ? color : C.border}`,
    background: active ? `${color}12` : 'transparent',
    color: active ? color : C.muted,
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 88px)' }}>

      {/* Left sidebar */}
      <div style={{
        width: 264,
        flexShrink: 0,
        position: 'sticky',
        top: 88,
        height: 'calc(100vh - 88px)',
        overflowY: 'auto',
        borderRight: `1px solid ${C.border}`,
        background: C.surface,
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>
        {/* Search */}
        <div>
          <label style={labelStyle}>Search</label>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Keywords, source, region…"
              style={{ ...selStyle, paddingLeft: 28 }}
            />
          </div>
        </div>

        {/* Classification */}
        <div>
          <label style={labelStyle}>Classification</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {CLS_OPTIONS.map(c => (
              <button key={c} onClick={() => setClsFilter(c)}
                style={{ ...filterChip(clsFilter === c), display: 'flex', width: '100%', textAlign: 'left' }}>
                {c === 'all' ? 'All types' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Relevance */}
        <div>
          <label style={labelStyle}>Relevance score</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {([['all','All scores'],['high','High (7–10)'],['medium','Medium (4–6)'],['low','Low (1–3)']] as [RelvBucket, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setRelevance(v)}
                style={{ ...filterChip(relevance === v, C.amber), display: 'flex', width: '100%', textAlign: 'left' }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Region */}
        <div>
          <label style={labelStyle}>Region</label>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={selStyle}>
            <option value="all">All regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Keyword group */}
        <div>
          <label style={labelStyle}>Keyword group</label>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} style={selStyle}>
            <option value="all">All groups</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Sort */}
        <div>
          <label style={labelStyle}>Sort by</label>
          <select value={sort} onChange={e => setSort(e.target.value as SortMode)} style={selStyle}>
            <option value="newest">Newest first</option>
            <option value="score">Highest score</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        {/* Refresh */}
        <button onClick={load}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)', marginTop: 'auto' }}>
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          Refresh feed
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, padding: '24px 28px' }}>

        {/* Status banner */}
        <div style={{ padding: '7px 14px', background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}` }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              n8n · News pipeline · 06:00 daily
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint }}>
            Social coming soon: YouTube · Reddit · TikTok · Instagram · LinkedIn · X
          </span>
          {lastUpdated && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.faint, marginLeft: 'auto' }}>
              {totalCount != null ? totalCount.toLocaleString() : '—'} total signals
            </span>
          )}
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
          {([
            { label: 'Total signals', value: signals.length.toLocaleString(), color: C.text,  suffix: '' },
            { label: 'Opportunities', value: stats.opps.toLocaleString(),     color: C.green, suffix: '' },
            { label: 'Threats',       value: stats.threats.toLocaleString(),  color: C.red,   suffix: '' },
            { label: 'Avg relevance', value: stats.avg.toFixed(1),            color: C.amber, suffix: '/10' },
          ]).map(({ label, value, suffix, color }) => (
            <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: C.faint, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color, margin: 0, lineHeight: 1 }}>
                {value}{suffix && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint, marginLeft: 3 }}>{suffix}</span>}
              </p>
            </div>
          ))}
        </div>

        {/* Map toggle */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowMap(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: `1px solid ${showMap ? C.brandBorder : C.border}`, background: showMap ? C.brandBg : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 10, color: showMap ? C.brand : C.faint, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: showMap ? 12 : 0 }}
          >
            <Map size={11} /> {showMap ? 'Hide map' : 'Show map'}
          </button>
          {showMap && (
            <SignalMap
              signals={signals as any}
              selectedRegion={regionFilter === 'all' ? null : regionFilter}
              onRegionSelect={code => setRegionFilter(code ?? 'all')}
            />
          )}
        </div>

        {/* Result count */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 2px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.04em' }}>
            {loading ? 'Loading…' : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'signal' : 'signals'}`}
          </span>
          {filtered.length > visible && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint }}>
              Showing {visible} of {filtered.length}
            </span>
          )}
        </div>

        {/* Card grid */}
        {loading && signals.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Spinner /><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint }}>Loading signals…</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <Radio size={28} style={{ color: C.border, margin: '0 auto 12px', display: 'block' }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 10 }}>No signals match your filters</p>
            <button onClick={() => { setSearch(''); setClsFilter('all'); setRegionFilter('all'); setGroupFilter('all'); setRelevance('all') }}
              style={{ ...ghostBtn, fontSize: 12, padding: '6px 14px' }}>
              Reset filters
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <HeroCard signalCount={signals.length} lastUpdated={lastUpdated} />
              {visibleSignals.map(s => (
                <SignalCard key={s.id} signal={s} onClick={() => setSelected(s)} onSendTo={onSendTo} />
              ))}
            </div>
            {filtered.length > visible && (
              <button onClick={() => setVisible(v => v + SIG_PAGE)}
                style={{ marginTop: 16, width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontFamily: 'var(--font-body)', fontSize: 13, cursor: 'pointer' }}>
                Load {Math.min(SIG_PAGE, filtered.length - visible)} more signals
              </button>
            )}
          </>
        )}
      </div>

      <SignalDrawer signal={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

// ─── Gap finder ───────────────────────────────────────────────────────────────

function GapSection({ preload }: { preload?: string }) {
  const [mode,    setMode]    = useState<'gap' | 'variance'>('gap')
  const [market,  setMarket]  = useState('')
  const [product, setProduct] = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')
  const prevPreload = useRef('')

  useEffect(() => {
    if (!preload || preload === prevPreload.current) return
    prevPreload.current = preload
    setMarket(preload)
    setLoading(true); setResult('')
    callSales({ action: 'gap_finder', market: preload, product: 'rooibos tea' })
      .then(r => { setResult(r); setLoading(false) })
  }, [preload])

  const run = async () => {
    if (!market || loading) return
    setLoading(true); setResult('')
    const body = mode === 'gap'
      ? { action: 'gap_finder', market, product: product || 'rooibos tea' }
      : { action: 'variance_finder', market }
    const r = await callSales(body)
    setResult(r); setLoading(false)
  }

  const chipBtn = (val: string, current: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${current === val ? C.brand : C.border}`,
    background: current === val ? C.brandBg : C.surface,
    color: current === val ? C.brand : C.muted,
    fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
        {([
          { id: 'gap' as const,      label: 'Gap Finder',      icon: Zap,      desc: 'Who is the middleman? What can\'t they do? Where do we fit?' },
          { id: 'variance' as const, label: 'Variance Finder', icon: Sparkles, desc: 'What doesn\'t exist yet in this market that we could bring?' },
        ] as const).map(({ id, label, icon: Icon, desc }) => (
          <button key={id} onClick={() => { setMode(id); setResult('') }}
            style={{ padding: '14px 16px', borderRadius: 10, border: `1px solid ${mode === id ? C.brand : C.border}`, background: mode === id ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}>
            <Icon size={15} style={{ color: mode === id ? C.brand : C.faint, marginBottom: 7 }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: mode === id ? C.brand : C.text, margin: '0 0 3px' }}>{label}</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
          </button>
        ))}
      </div>

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
                <button key={m} onClick={() => setMarket(m)} style={chipBtn(m, market)}>{m}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label style={labelStyle}>Target market</label>
            <input value={market} onChange={e => setMarket(e.target.value)} placeholder="e.g. Germany, South Korea…" style={{ ...inputStyle, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
              {['Germany','South Korea','UAE','Japan','Netherlands','UK','Australia'].map(m => (
                <button key={m} onClick={() => setMarket(m)} style={chipBtn(m, market)}>{m}</button>
              ))}
            </div>
          </>
        )}
        <button onClick={run} disabled={!market || loading}
          style={{ ...primaryBtn, opacity: market && !loading ? 1 : 0.4, cursor: market && !loading ? 'pointer' : 'default' }}>
          {loading ? <><Spinner size={13} /> Analysing…</> : mode === 'gap' ? <><Zap size={13} /> Find the gap</> : <><Sparkles size={13} /> Find variances</>}
        </button>
      </div>

      <AiResult text={result} loading={loading} label={mode === 'gap' ? 'Gap Analysis' : 'Variance Map'} saveable reportType="gap_analysis" />
    </div>
  )
}

// ─── Loopholes ────────────────────────────────────────────────────────────────

function LoopholesSection({ preload }: { preload?: string }) {
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState('')
  const [keyword, setKeyword] = useState('')
  const prevPreload = useRef('')

  useEffect(() => {
    if (!preload || preload === prevPreload.current) return
    prevPreload.current = preload
    setKeyword(preload)
    setLoading(true); setResult('')
    callSales({ action: 'loophole_scan', keyword: preload })
      .then(r => { setResult(r); setLoading(false) })
  }, [preload])

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
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>The Bad News Layer</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
            Most intelligence tools only surface good news. This tab actively hunts for competitor weaknesses, supply chain disruptions, quality recalls, and market exits — because someone else's problem is your opportunity window.
          </p>
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
        <label style={labelStyle}>Focus keyword (optional)</label>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. rooibos quality, Martin Bauer, Germany supply chain…"
          style={{ ...inputStyle, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
          {['rooibos shortage','competitor recall','price dumping','supply disruption','market exit'].map(k => (
            <button key={k} onClick={() => setKeyword(k)}
              style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${keyword === k ? C.amber : C.border}`, background: keyword === k ? C.amberBg : C.surface, color: keyword === k ? C.amber : C.muted, fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer' }}>
              {k}
            </button>
          ))}
        </div>
        <button onClick={scan} disabled={loading}
          style={{ ...primaryBtn, background: C.amber, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? <><Spinner size={13} color="#fff" /> Scanning…</> : <><AlertTriangle size={13} /> Scan for loopholes</>}
        </button>
      </div>

      <AiResult text={result} loading={loading} label="Loophole Scan" saveable reportType="loophole_scan" />
    </div>
  )
}

// ─── Intelligence ─────────────────────────────────────────────────────────────

const INTEL_TOOLS: { id: IntelTool; label: string; Icon: React.ElementType; desc: string }[] = [
  { id: 'briefing',    Icon: BarChart2,  label: 'Market Briefing',  desc: 'Daily global snapshot + action'              },
  { id: 'frontier',    Icon: Globe,      label: 'Frontier Scout',   desc: 'Country entry + cultural brief'              },
  { id: 'competitors', Icon: TrendingUp, label: 'Competitor Watch', desc: 'Gaps, advantages, outflanking moves'         },
  { id: 'profiler',    Icon: Building2,  label: 'Company Profiler', desc: 'Buyer dossier + approach strategy'           },
  { id: 'pitch',       Icon: Mail,       label: 'Pitch Structurer', desc: 'You know the buyer — we structure the pitch' },
  { id: 'alerts',      Icon: Bell,       label: 'Alerts',           desc: '5 urgent signals + opportunity windows'      },
]

function IntelSection() {
  const [tool,       setTool]       = useState<IntelTool>('briefing')
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState('')
  const [resultTool, setResultTool] = useState<IntelTool>('briefing')
  const [f1, setF1] = useState('')
  const [f2, setF2] = useState('')
  const [f3, setF3] = useState('')

  const call = async (body: Record<string, unknown>) => {
    const activeTool = tool
    setLoading(true); setResult('')
    const r = await callSales(body)
    setResult(r); setResultTool(activeTool); setLoading(false)
    if (activeTool === 'profiler' && f1) {
      void fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f1, stage: 'lead', notes: r.slice(0, 500), signal_title: f1 }),
      })
    }
  }

  const changeTool = (t: IntelTool) => { setTool(t); setResult(''); setF1(''); setF2(''); setF3('') }

  const chipBtn = (val: string, current: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5,
    border: `1px solid ${current === val ? C.brand : C.border}`,
    background: current === val ? C.brandBg : C.surface,
    color: current === val ? C.brand : C.muted,
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
            <button onClick={() => f1 && f2 && f3 && call({ action: 'pitch_builder', target_market: f1, buyer_type: f2, product_format: f3 })}
              disabled={!f1 || !f2 || !f3} style={{ ...primaryBtn, opacity: f1 && f2 && f3 ? 1 : 0.4 }}>
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
            <button key={id} onClick={() => changeTool(id)}
              style={{ padding: '12px 14px', borderRadius: 9, border: `1px solid ${active ? C.brand : C.border}`, background: active ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}>
              <Icon size={14} style={{ color: active ? C.brand : C.faint, marginBottom: 6 }} />
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: active ? C.brand : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {(() => { const t = INTEL_TOOLS.find(t => t.id === tool)!; return <t.Icon size={14} style={{ color: C.brand }} /> })()}
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: C.text }}>
            {INTEL_TOOLS.find(t => t.id === tool)?.label}
          </span>
        </div>
        {renderForm()}
      </div>
      <AiResult text={result} loading={loading} label={INTEL_TOOLS.find(t => t.id === resultTool)?.label ?? 'Intelligence'} saveable reportType="intelligence" />
    </div>
  )
}

// ─── Vault ────────────────────────────────────────────────────────────────────

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
        <Leaf size={13} style={{ color: C.brand, flexShrink: 0, marginTop: 1 }} />
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
            style={{ border: `2px dashed ${C.border}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: uploading ? C.brandBg : C.surface, marginBottom: 12, transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!uploading) (e.currentTarget as HTMLElement).style.borderColor = C.brand }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border }}
          >
            <Upload size={20} style={{ color: uploading ? C.brand : C.faint, margin: '0 auto 8px', display: 'block' }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: uploading ? C.brand : C.text, margin: '0 0 3px' }}>
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
                    <Tag label={f.category} color={C.brand} />
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
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runQuery()}
              placeholder="e.g. What did we quote Germany last year?"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'var(--font-body)', background: C.surface, color: C.text, outline: 'none' }} />
            <button onClick={runQuery} disabled={!query.trim() || querying}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, border: 'none', background: query.trim() && !querying ? C.brand : C.border, color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: query.trim() && !querying ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
              {querying ? <Spinner color="#fff" /> : 'Ask'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
            {['Any Korea trip reports?','Latest Germany pricing?','Japan volume commitments?','Pending contracts?'].map(q => (
              <button key={q} onClick={() => setQuery(q)}
                style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontFamily: 'var(--font-body)', fontSize: 11, cursor: 'pointer' }}>{q}</button>
            ))}
          </div>
          <AiResult text={answer} loading={querying} label="Vault Answer" />
        </div>
      </div>
    </div>
  )
}

// ─── Compass ──────────────────────────────────────────────────────────────────

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
            <button key={id} onClick={() => { setVec(id); setResult('') }}
              style={{ padding: '13px 14px', borderRadius: 9, border: `1px solid ${active ? C.brand : C.border}`, background: active ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                <Icon size={14} style={{ color: active ? C.brand : C.faint }} />
                <Tag label={tag} color={active ? C.brand : undefined} />
              </div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: active ? C.brand : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <selected.Icon size={16} style={{ color: C.brand }} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{selected.label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: '2px 0 0' }}>{selected.desc}</p>
            </div>
          </div>
          <button onClick={generate} disabled={loading}
            style={{ ...primaryBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? <><Spinner size={13} color="#fff" /> Generating…</> : <><Sparkles size={13} /> Get briefing</>}
          </button>
        </div>
      </div>
      {result && <AiResult text={result} loading={false} label={`${selected.label} Briefing`} saveable reportType="expansion_briefing" />}
      {!result && !loading && (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <Compass size={26} style={{ color: C.border, margin: '0 auto 10px', display: 'block' }} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: C.faint }}>Select an expansion vector and click "Get briefing".</p>
        </div>
      )}
    </div>
  )
}

// ─── About ────────────────────────────────────────────────────────────────────

const SIGNAL_SCHEDULE = [
  { day: 'Monday',    region: 'Europe',           detail: 'DE · NL · FR · UK + EU hashtags'       },
  { day: 'Tuesday',   region: 'Asia',             detail: 'JP · KR · CN · IN'                     },
  { day: 'Wednesday', region: 'Americas',         detail: 'US · BR · MX · CA'                     },
  { day: 'Thursday',  region: 'Africa + ME',      detail: 'ZA · AE + competitor watch'            },
  { day: 'Friday',    region: 'Global themes',    detail: 'wellness · skincare · clinical · white-space' },
  { day: 'Sat / Sun', region: 'Light',            detail: 'News only, or rest'                    },
]

function AboutSection({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const caps: { id: Section; label: string; Icon: React.ElementType; desc: string }[] = [
    { id: 'signals',   label: 'Signal Feed',   Icon: Radio,         desc: 'Live intelligence from 15+ sources — social, news, trade. Ranked by relevance to rooibos export.' },
    { id: 'gap',       label: 'Gap Finder',    Icon: Zap,           desc: 'Market gap and variance analysis. Where demand exists that isn\'t being met.' },
    { id: 'loopholes', label: 'Loopholes',     Icon: AlertTriangle, desc: 'Competitor weaknesses, recalls, supply disruptions — someone else\'s problem is your window.' },
    { id: 'intel',     label: 'Intelligence',  Icon: Sparkles,      desc: 'Market briefings, frontier scouting, competitor scans, company dossiers, pitch builder, and alerts.' },
    { id: 'vault',     label: 'Vault',         Icon: Lock,          desc: 'Upload your own documents — contracts, trade reports, buyer specs — and ask Alara questions about them.' },
    { id: 'compass',   label: 'Compass',       Icon: Compass,       desc: '7 strategic expansion vectors. Get a structured briefing on any growth direction.' },
  ]

  return (
    <div style={{ padding: '32px 28px', maxWidth: 860 }}>

      {/* Hero identity card */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 32, padding: '24px 28px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, #0D1B09, #2D5A20)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 16px rgba(13,27,9,0.25)' }}>
          <Leaf size={24} style={{ color: '#8BC47A' }} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: '-0.03em' }}>Alara</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: C.faint, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Rooibos Intelligence Engine</span>
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: C.muted, lineHeight: 1.7, margin: '0 0 14px', maxWidth: 560 }}>
            A living market intelligence system built for CNTP — turning raw signals from global trade, social platforms, and news into ranked, actionable intelligence for the rooibos export team.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: C.brandBg, border: `1px solid ${C.brandBorder}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.brand, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}`, display: 'inline-block' }} /> Engine active
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: C.elevated, border: `1px solid ${C.border}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              15+ live sources
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: C.elevated, border: `1px solid ${C.border}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Gemini-powered
            </span>
          </div>
        </div>
      </div>

      {/* Etymology */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Name</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { part: 'Ala', origin: 'Aspalathus linearis', desc: 'The botanical name of the rooibos plant. The first three letters anchor this engine to the source.' },
            { part: 'ra',  origin: 'Rooibos · Intelligence', desc: 'The intelligence designation — named for the ability to range, detect, and act on what others miss.' },
          ].map(({ part, origin, desc }) => (
            <div key={part} style={{ padding: '16px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: C.brand, letterSpacing: '-0.03em', display: 'block', marginBottom: 4 }}>{part}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.brand, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>{origin}</span>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Signal schedule */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Signal schedule</p>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {SIGNAL_SCHEDULE.map((row, i) => (
            <div key={row.day} style={{ display: 'grid', gridTemplateColumns: '100px 140px 1fr', gap: 0, borderBottom: i < SIGNAL_SCHEDULE.length - 1 ? `1px solid ${C.borderLight}` : undefined, padding: '11px 18px', alignItems: 'center', background: i % 2 === 0 ? 'transparent' : C.elevated }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: C.text, letterSpacing: '0.04em' }}>{row.day}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: C.brand, letterSpacing: '0.04em' }}>{row.region}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted }}>{row.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Capabilities</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
          {caps.map(({ id, label, Icon, desc }) => (
            <button key={id} onClick={() => onNavigate(id)}
              style={{ padding: '14px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s, box-shadow 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.brandBorder; (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 10px ${C.brandBg}` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}>
              <Icon size={13} style={{ color: C.brand, marginBottom: 8 }} />
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: C.text, margin: '0 0 5px' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: C.muted, lineHeight: 1.5, margin: 0 }}>{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Creator */}
      <div style={{ padding: '14px 18px', background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Info size={13} style={{ color: C.faint, flexShrink: 0 }} />
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6 }}>
          Built by <strong style={{ color: C.text }}>Alyssa Krishna</strong> for CNTP's export and sales intelligence operations. Alara is a living system — new sources, vectors, and tools are added as the business evolves.
        </p>
      </div>
    </div>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

const SECTIONS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: 'signals',   label: 'Signal Feed',  Icon: Radio         },
  { id: 'gap',       label: 'Gap Finder',   Icon: Zap           },
  { id: 'loopholes', label: 'Loopholes',    Icon: AlertTriangle },
  { id: 'intel',     label: 'Intelligence', Icon: Sparkles      },
  { id: 'vault',     label: 'Vault',        Icon: Lock          },
  { id: 'compass',   label: 'Compass',      Icon: Compass       },
]

export default function ResearchPage() {
  const [section,          setSection]          = useState<Section>('signals')
  const [gapPreload,       setGapPreload]       = useState<string | undefined>()
  const [loopholePreload,  setLoopholePreload]  = useState<string | undefined>()

  const handleSendTo = (dest: 'gap' | 'loopholes', term: string) => {
    if (dest === 'gap') { setGapPreload(term); setSection('gap') }
    else                { setLoopholePreload(term); setSection('loopholes') }
  }

  return (
    <div style={{ background: C.bg, minHeight: '100%', fontFamily: 'var(--font-body)' }}>

      {/* Sticky dark header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: C.header }}>

        {/* Top bar */}
        <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.headerBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(109,181,90,0.15)', border: '1px solid rgba(109,181,90,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Leaf size={14} style={{ color: '#8BC47A' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: C.headerText, letterSpacing: '-0.02em' }}>Alara</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.headerMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Rooibos Intelligence Engine</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6DB55A', boxShadow: '0 0 6px rgba(109,181,90,0.8)', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: C.headerMuted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Engine active</span>
            </div>
            <button
              onClick={() => setSection('about')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 6, background: section === 'about' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)', border: `1px solid ${section === 'about' ? 'rgba(255,255,255,0.2)' : C.headerBorder}`, fontFamily: 'var(--font-mono)', fontSize: 10, color: section === 'about' ? C.headerText : C.headerMuted, cursor: 'pointer', letterSpacing: '0.06em' }}
            >
              <Info size={11} /> About
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px' }}>
          {SECTIONS.map(({ id, label, Icon }) => {
            const active = section === id
            return (
              <button key={id} onClick={() => setSection(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: active ? `2px solid ${C.headerActive}` : '2px solid transparent',
                  color: active ? C.headerText : C.headerMuted,
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: active ? 600 : 400,
                  transition: 'color 0.1s, border-color 0.1s', marginBottom: -1, whiteSpace: 'nowrap',
                }}>
                <Icon size={12} />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Section content */}
      {section === 'signals'   && <SignalsSection   onSendTo={handleSendTo} />}
      {section === 'gap'       && <GapSection       preload={gapPreload} />}
      {section === 'loopholes' && <LoopholesSection preload={loopholePreload} />}
      {section === 'intel'     && <IntelSection     />}
      {section === 'vault'     && <VaultSection     />}
      {section === 'compass'   && <CompassSection   />}
      {section === 'about'     && <AboutSection     onNavigate={setSection} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
