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
  Coffee, Wheat, AlertTriangle, Zap, Link2, MessageSquare,
  ChevronRight, Info, UserPlus, Save, Bookmark, Map, ArrowUpRight,
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

// ─── Design tokens — aligned with globals.css design system ──────────────────

const C = {
  surface:      '#FFFFFF',
  surfaceDim:   '#EEF0F3',
  surfaceRaised:'#FAFBFC',
  border:       '#E4E7EC',
  borderLight:  'rgba(228,231,236,0.55)',
  text:         '#1A2415',
  muted:        '#637056',
  faint:        '#96A88A',
  // Brand greens
  brand:        '#1A3A0E',
  brandMid:     '#2A5416',
  brandLight:   '#5A8A2A',
  brandBg:      '#EFF6E6',
  brandBorder:  'rgba(90,138,42,0.25)',
  // Status
  green:        '#1A7A3C',
  greenBg:      '#EDFAF3',
  greenBorder:  'rgba(26,122,60,0.20)',
  red:          '#B81C1C',
  redBg:        '#FEF2F2',
  redBorder:    'rgba(184,28,28,0.18)',
  amber:        '#B85C0A',
  amberBg:      '#FEF5ED',
  amberBorder:  'rgba(184,92,10,0.18)',
  // Shadows (from --shadow-card in globals)
  shadow:       '0 2px 8px rgba(0,0,0,0.09), 0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(26,58,14,0.06)',
  shadowHover:  '0 6px 24px rgba(0,0,0,0.11), 0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(26,58,14,0.10)',
  shadowMenu:   '0 12px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
}

// ─── Shared map ───────────────────────────────────────────────────────────────

const SignalMap = dynamic(() => import('@/components/intelligence/SignalMap'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 300, borderRadius: 12, background: '#0D1F0D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#4a7a4a' }}>Loading map…</span>
    </div>
  ),
})

// ─── Filter constants ─────────────────────────────────────────────────────────

const CLS_OPTIONS = ['all','opportunity','threat','competitor','regulation','relationship','neutral'] as const
type ClsFilter  = typeof CLS_OPTIONS[number]
type RelvBucket = 'all' | 'high' | 'medium' | 'low'
type SortMode   = 'newest' | 'score' | 'oldest'
const SIG_PAGE  = 50

// ─── Shared primitives ────────────────────────────────────────────────────────

function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return <Loader2 size={size} style={{ animation: 'spin 1s linear infinite', color: color ?? C.brandLight }} />
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 8 ? C.red : score >= 5 ? C.amber : C.faint
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score * 10}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.faint, minWidth: 28 }}>{score}/10</span>
    </div>
  )
}

function ClsBadge({ cls }: { cls: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    opportunity:  { bg: '#EDFAF3', color: '#1A7A3C', label: 'Opportunity' },
    threat:       { bg: '#FEF2F2', color: '#B81C1C', label: 'Threat'      },
    competitor:   { bg: '#FEF5ED', color: '#B85C0A', label: 'Competitor'  },
    regulation:   { bg: '#EBF4FB', color: '#2A7CB8', label: 'Regulation'  },
    relationship: { bg: '#F5F0FB', color: '#7C3AED', label: 'Relationship'},
    neutral:      { bg: C.surfaceDim, color: C.muted, label: 'Neutral'   },
  }
  const s = map[cls] ?? map.neutral
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, letterSpacing: '0.01em' }}>
      {s.label}
    </span>
  )
}

function PlatformBadge({ type }: { type: string }) {
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
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 5, background: s.bg, color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
      {s.label}
    </span>
  )
}

function AiResult({ text, loading, label = 'Alara', saveable = false, reportType = 'briefing' }: {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: C.brandBg, border: `1px solid ${C.brandBorder}`, borderRadius: 12 }}>
      <Spinner />
      <span style={{ fontSize: 13, color: C.brandMid }}>Generating…</span>
    </div>
  )
  if (!text) return null

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: C.shadow }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.brandBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Leaf size={12} style={{ color: C.brandLight }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: C.brandMid, letterSpacing: '0.02em' }}>{label}</span>
        </div>
        {saveable && (
          <button onClick={saveReport} disabled={saving || saved}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${saved ? C.greenBorder : C.brandBorder}`, background: saved ? C.greenBg : 'rgba(255,255,255,0.7)', fontSize: 12, color: saved ? C.green : C.muted, cursor: saved || saving ? 'default' : 'pointer' }}>
            {saved ? <><CheckCircle size={11} /> Saved</> : saving ? <><Spinner size={11} /> Saving…</> : <><Save size={11} /> Save to reports</>}
          </button>
        )}
      </div>
      <div style={{ padding: '16px 18px' }}>
        <p style={{ fontSize: 14, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', margin: 0 }}>{text}</p>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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

// ─── Shared style objects ─────────────────────────────────────────────────────

const inputCss: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 14,
  background: C.surface, color: C.text, outline: 'none',
  boxSizing: 'border-box', lineHeight: 1.5,
  transition: 'border-color 0.15s',
}

const labelCss: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: C.muted, marginBottom: 5, letterSpacing: '0.01em',
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: C.brand, color: '#fff',
  fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
}

const outlineBtn: React.CSSProperties = {
  ...primaryBtn, background: 'transparent', color: C.brandMid,
  border: `1px solid ${C.brandBorder}`,
}

// ─── Alara logo mark (user's botanical SVG logo) ─────────────────────────────

function AlaraLogoMark({ size = 30, stemColor = '#8B3020', ringColor = '#C9A840' }: {
  size?: number; stemColor?: string; ringColor?: string
}) {
  const c = stemColor
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg" fill="none" aria-label="Alara">
      <circle cx="50" cy="46" r="38" stroke={ringColor} strokeWidth="1.4"/>
      {/* Main stems */}
      <path d="M50 80C48 70 43 58 37 46C33 38 30 30 28 20" stroke={c} strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M50 78C54 70 59 60 65 50C69 42 71 34 72 24" stroke={c} strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M51 80C57 74 63 66 68 58C70 54 72 50 72 46" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M47 76C42 74 37 70 32 64C29 60 27 56 26 52" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
      {/* Sub-branches left stem */}
      <path d="M43 58C40 54 37 50 35 44" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      <path d="M40 50C37 46 35 42 33 36" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      <path d="M36 42C33 38 31 34 30 28" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      {/* Sub-branches right stem */}
      <path d="M57 62C60 58 63 54 64 50" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      <path d="M62 54C65 50 67 46 68 42" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      <path d="M66 46C68 42 70 38 71 34" stroke={c} strokeWidth="1" strokeLinecap="round"/>
      {/* Needle clusters — left stem */}
      <path d="M46 67L42 65 M46 67L48 63 M43 60L39 58 M43 60L45 56 M40 53L36 51 M40 53L42 49 M37 46L33 44 M37 46L39 42 M34 39L30 37 M34 39L36 35 M31 32L27 30 M31 32L33 28 M29 25L25 23 M29 25L31 21" stroke={c} strokeWidth="0.9" strokeLinecap="round"/>
      {/* Needle clusters — right stem */}
      <path d="M54 70L56 66 M54 70L51 67 M58 62L60 58 M58 62L55 59 M63 54L65 50 M63 54L60 51 M66 47L68 43 M66 47L63 44 M69 40L71 36 M69 40L66 37 M70 34L72 30 M70 34L67 31 M71 28L73 24 M71 28L68 25" stroke={c} strokeWidth="0.9" strokeLinecap="round"/>
      {/* Needle clusters — far-right sub-branch */}
      <path d="M55 76L57 72 M55 76L52 73 M60 68L62 64 M60 68L57 65 M65 60L67 56 M65 60L62 57 M69 53L71 49 M69 53L66 50" stroke={c} strokeWidth="0.9" strokeLinecap="round"/>
      {/* Needle clusters — lower-left branch */}
      <path d="M43 73L40 70 M43 73L44 69 M38 69L35 66 M38 69L39 65 M33 65L30 62 M33 65L34 61 M28 60L25 57 M28 60L29 56" stroke={c} strokeWidth="0.9" strokeLinecap="round"/>
      {/* Base convergence */}
      <path d="M50 80L47 77 M50 80L53 77 M50 80L45 79 M50 80L55 79" stroke={c} strokeWidth="1" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard({ signalCount, lastUpdated }: { signalCount: number; lastUpdated: Date | null }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      borderRadius: 16,
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #1A3A0E 0%, #2A5416 55%, #3D7A20 100%)',
      padding: '28px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
      boxShadow: C.shadowMenu,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Leaf size={16} style={{ color: '#8BC47A' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(139,196,122,0.9)', letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
            Rooibos Intelligence Engine
          </span>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#F0F7EE', letterSpacing: '-0.03em', margin: '0 0 6px', lineHeight: 1 }}>
          Alara
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(240,247,238,0.65)', margin: '0 0 18px', lineHeight: 1.6, maxWidth: 440 }}>
          Live market intelligence for rooibos export — signals from 15+ sources, ranked by relevance, updated daily at 06:00 SAST.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(139,196,122,0.15)', border: '1px solid rgba(139,196,122,0.25)', fontSize: 12, fontWeight: 600, color: '#8BC47A' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6DB55A', boxShadow: '0 0 6px #6DB55A', display: 'inline-block' }} />
            Engine active
          </span>
          {signalCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12, color: 'rgba(240,247,238,0.6)' }}>
              {signalCount.toLocaleString()} signals
            </span>
          )}
          {lastUpdated && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12, color: 'rgba(240,247,238,0.6)' }}>
              Updated {timeAgo(lastUpdated.toISOString())}
            </span>
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0, opacity: 0.55 }}>
        <AlaraLogoMark size={100} stemColor="rgba(255,240,220,0.9)" ringColor="rgba(201,168,64,0.7)" />
      </div>
    </div>
  )
}

// ─── Signal card ──────────────────────────────────────────────────────────────

const CLS_GRADIENT: Record<string, string> = {
  opportunity: 'linear-gradient(150deg, #0F2D1A 0%, #1E4D2E 100%)',
  threat:      'linear-gradient(150deg, #2D0A0A 0%, #5C1A1A 100%)',
  competitor:  'linear-gradient(150deg, #2D1A0A 0%, #5C3A14 100%)',
  regulation:  'linear-gradient(150deg, #0A1A2D 0%, #14305C 100%)',
  relationship:'linear-gradient(150deg, #1A0A2D 0%, #3A145C 100%)',
  neutral:     'linear-gradient(150deg, #1A1A1A 0%, #363636 100%)',
}

function SignalCard({ signal, onClick, onSendTo }: {
  signal: Signal
  onClick: () => void
  onSendTo: (s: 'gap' | 'loopholes', term: string) => void
}) {
  const [bookmarked,  setBookmarked]  = useState(false)
  const [promoted,    setPromoted]    = useState(false)
  const [bookmarking, setBookmarking] = useState(false)
  const [promoting,   setPromoting]   = useState(false)
  const [promoteErr,  setPromoteErr]  = useState(false)

  const bookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (bookmarked || bookmarking) return
    setBookmarking(true)
    try {
      const r = await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bookmark_signal', signal_id: signal.id, title: signal.title }),
      })
      if (r.ok) setBookmarked(true)
    } finally { setBookmarking(false) }
  }

  const promote = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (promoted || promoting) return
    setPromoting(true); setPromoteErr(false)
    try {
      const r = await fetch('/api/accounts', {
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
      if (r.ok) setPromoted(true)
      else setPromoteErr(true)
    } catch { setPromoteErr(true) }
    finally { setPromoting(false) }
  }

  const term = signal.keyword_group ?? signal.region ?? signal.title.slice(0, 60)

  return (
    <div
      style={{ background: C.surface, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: C.shadow, cursor: 'pointer', transition: 'box-shadow 0.18s, transform 0.18s' }}
      onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = C.shadowHover; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = C.shadow; (e.currentTarget as HTMLElement).style.transform = 'none' }}
    >
      {/* Image / gradient area */}
      <div style={{ height: 136, background: CLS_GRADIENT[signal.classification] ?? CLS_GRADIENT.neutral, position: 'relative', flexShrink: 0, overflow: 'hidden' }}>
        {signal.media_url && (
          <img src={signal.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        )}
        {!signal.media_url && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Leaf size={36} style={{ color: 'rgba(255,255,255,0.14)' }} />
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 8, left: 10, display: 'flex', gap: 5 }}>
          <PlatformBadge type={signal.source_type} />
          <ClsBadge cls={signal.classification} />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 10 }}><ScoreBar score={signal.relevance_score} /></div>

        <p style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.4, margin: '0 0 7px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {signal.title}
        </p>

        {signal.summary_en && (
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, margin: '0 0 12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
            {signal.summary_en}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: C.faint }}>
            {[signal.region, timeAgo(signal.created_at)].filter(Boolean).join(' · ')}
          </span>
          {signal.source_url && (
            <a href={signal.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: C.faint, textDecoration: 'none' }}>
              Source <ArrowUpRight size={11} />
            </a>
          )}
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 5, borderTop: `1px solid ${C.border}`, paddingTop: 10 }} onClick={e => e.stopPropagation()}>
          <ActionBtn
            onClick={bookmark}
            active={bookmarked}
            loading={bookmarking}
            icon={<Bookmark size={11} />}
            label="Save"
            activeColor={C.brandLight}
            activeBg={C.brandBg}
            activeBorder={C.brandBorder}
          />
          <ActionBtn
            onClick={promote}
            active={promoted}
            loading={promoting}
            error={promoteErr}
            icon={<UserPlus size={11} />}
            label={promoted ? 'Added' : promoteErr ? 'Failed' : 'Lead'}
            activeColor={C.green}
            activeBg={C.greenBg}
            activeBorder={C.greenBorder}
          />
          <ActionBtn
            onClick={e => { e.stopPropagation(); onSendTo('gap', term) }}
            icon={<Zap size={11} />}
            label="Gap"
            activeColor={C.brandMid}
            activeBg={C.brandBg}
            activeBorder={C.brandBorder}
          />
          <ActionBtn
            onClick={e => { e.stopPropagation(); onSendTo('loopholes', term) }}
            icon={<AlertTriangle size={11} />}
            label="Loophole"
            activeColor={C.amber}
            activeBg={C.amberBg}
            activeBorder={C.amberBorder}
          />
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ onClick, active = false, loading = false, error = false, icon, label, activeColor, activeBg, activeBorder }: {
  onClick: (e: React.MouseEvent) => void
  active?: boolean; loading?: boolean; error?: boolean
  icon: React.ReactNode; label: string
  activeColor: string; activeBg: string; activeBorder: string
}) {
  const isActive = active || error
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        padding: '5px 4px', borderRadius: 7,
        border: `1px solid ${isActive ? (error ? C.redBorder : activeBorder) : C.border}`,
        background: isActive ? (error ? C.redBg : activeBg) : 'transparent',
        fontSize: 11, fontWeight: 500,
        color: isActive ? (error ? C.red : activeColor) : C.muted,
        cursor: active ? 'default' : 'pointer',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap' as const,
      }}
      onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = C.surfaceDim; (e.currentTarget as HTMLElement).style.color = C.text } }}
      onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = C.muted } }}
    >
      {loading ? <Spinner size={10} color={activeColor} /> : icon}
      {label}
    </button>
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
  const [promoteErr,     setPromoteErr]     = useState(false)

  useEffect(() => {
    if (!signal) return
    setAnalysis(''); setAnalysisLoad(false)
    setSourceText(''); setSourceTitle(''); setSourceError(''); setSourceFetched(false)
    setQuestion(''); setSourceAnswer(''); setPromoted(false); setPromoteErr(false)
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
    setPromoting(true); setPromoteErr(false)
    try {
      const r = await fetch('/api/accounts', {
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
      if (r.ok) setPromoted(true)
      else setPromoteErr(true)
    } catch { setPromoteErr(true) }
    finally { setPromoting(false) }
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
    setSourceAnswer(ans); setSourceAsking(false)
  }

  if (!signal) return null

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(26,36,21,0.4)', backdropFilter: 'blur(3px)' }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 101, width: 500, background: C.surfaceRaised, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 48px rgba(0,0,0,0.18)', animation: 'slideInRight 0.2s ease' }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <PlatformBadge type={signal.source_type} />
            <ClsBadge cls={signal.classification} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: C.muted, borderRadius: 7 }}
            onMouseEnter={e => (e.currentTarget.style.background = C.surfaceDim)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.4, margin: '0 0 8px' }}>{signal.title}</h2>
            {signal.summary_en && (
              <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: '0 0 12px' }}>{signal.summary_en}</p>
            )}
            <div style={{ marginBottom: 12 }}><ScoreBar score={signal.relevance_score} /></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {signal.keyword_group && <span style={{ padding: '2px 8px', borderRadius: 6, background: C.brandBg, border: `1px solid ${C.brandBorder}`, fontSize: 12, color: C.brandMid }}>{signal.keyword_group}</span>}
              {signal.region && <span style={{ padding: '2px 8px', borderRadius: 6, background: C.surfaceDim, fontSize: 12, color: C.muted }}>{signal.region}</span>}
            </div>
          </div>

          {/* Analyse button */}
          {!analysis && !analysisLoad && (
            <button onClick={runAnalysis}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.brandBorder}`, background: C.brandBg, fontSize: 14, fontWeight: 600, color: C.brandMid, cursor: 'pointer', alignSelf: 'flex-start' }}>
              <Leaf size={14} style={{ color: C.brandLight }} /> Analyse with Alara
            </button>
          )}
          {(analysis || analysisLoad) && <AiResult text={analysis} loading={analysisLoad} label="Alara Analysis" />}

          {/* Promote */}
          <button onClick={promoteToLead} disabled={promoting || promoted}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: `1px solid ${promoted ? C.greenBorder : promoteErr ? C.redBorder : C.brandBorder}`, background: promoted ? C.greenBg : promoteErr ? C.redBg : C.brandBg, fontSize: 13, fontWeight: 600, color: promoted ? C.green : promoteErr ? C.red : C.brandMid, cursor: promoting || promoted ? 'default' : 'pointer', opacity: promoting ? 0.6 : 1, alignSelf: 'flex-start' }}>
            {promoted ? <><CheckCircle size={14} /> Added to lead pipeline</>
              : promoting ? <><Spinner size={14} /> Adding…</>
              : promoteErr ? <>Failed — check permissions</>
              : <><UserPlus size={14} /> Add to lead pipeline</>}
          </button>

          {/* Source panel */}
          {signal.source_url && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <Link2 size={12} style={{ color: C.faint, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signal.source_domain}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <a href={signal.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted, textDecoration: 'none' }}>
                    Open <ExternalLink size={10} />
                  </a>
                  {!sourceFetched && (
                    <button onClick={fetchSource} disabled={sourceFetching}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.brandBorder}`, background: C.brandBg, fontSize: 12, color: C.brandMid, cursor: sourceFetching ? 'default' : 'pointer' }}>
                      {sourceFetching ? <><Spinner size={11} /> Reading…</> : <>Read for AI <ChevronRight size={10} /></>}
                    </button>
                  )}
                  {sourceFetched && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: C.greenBg, fontSize: 12, color: C.green }}>
                      <CheckCircle size={10} /> Loaded
                    </span>
                  )}
                </div>
              </div>
              {sourceError && <div style={{ padding: '10px 14px', fontSize: 13, color: C.amber }}>{sourceError} — try opening directly.</div>}
              {sourceFetched && sourceText && (
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.borderLight}` }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>Source preview</p>
                  <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sourceText}</p>
                </div>
              )}
              {sourceFetched && (
                <div style={{ padding: '12px 14px' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: C.brandMid, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={12} /> Ask about this source
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAboutSource()}
                      placeholder="e.g. Who is the supplier mentioned?"
                      style={{ ...inputCss, fontSize: 13, padding: '7px 10px' }} />
                    <button onClick={askAboutSource} disabled={!question.trim() || sourceAsking}
                      style={{ ...primaryBtn, padding: '7px 14px', fontSize: 13, opacity: question.trim() && !sourceAsking ? 1 : 0.4 }}>
                      {sourceAsking ? <Spinner size={13} color="#fff" /> : 'Ask'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {['Who are the suppliers named?','What are the pricing signals?','What is the competitive implication?'].map(q => (
                      <button key={q} onClick={() => setQuestion(q)}
                        style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', fontSize: 12, color: C.muted, cursor: 'pointer' }}>
                        {q}
                      </button>
                    ))}
                  </div>
                  {(sourceAnswer || sourceAsking) && <div style={{ marginTop: 12 }}><AiResult text={sourceAnswer} loading={sourceAsking} label="Source Answer" /></div>}
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>
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

  const selCss: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, background: C.surface, color: C.text, outline: 'none' }

  const filterPill = (active: boolean, color = C.brandLight): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20,
    border: `1px solid ${active ? color : C.border}`,
    background: active ? `${color}14` : 'transparent',
    color: active ? color : C.muted,
    fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const,
    transition: 'all 0.12s',
  })

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 88px)' }}>

      {/* Left filter sidebar */}
      <aside style={{
        width: 260, flexShrink: 0,
        position: 'sticky', top: 88, height: 'calc(100vh - 88px)', overflowY: 'auto',
        background: C.surface, borderRight: `1px solid ${C.border}`,
        padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 22,
      }}>
        {/* Search */}
        <div>
          <label style={labelCss}>Search</label>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Keywords, region, source…"
              style={{ ...selCss, paddingLeft: 30 }} />
          </div>
        </div>

        {/* Classification */}
        <div>
          <label style={labelCss}>Type</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {CLS_OPTIONS.map(c => (
              <button key={c} onClick={() => setClsFilter(c)} style={{ ...filterPill(clsFilter === c), display: 'flex', textAlign: 'left' }}>
                {c === 'all' ? 'All types' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Relevance */}
        <div>
          <label style={labelCss}>Relevance</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {([['all','All scores'],['high','High (7–10)'],['medium','Medium (4–6)'],['low','Low (1–3)']] as [RelvBucket, string][]).map(([v, l]) => (
              <button key={v} onClick={() => setRelevance(v)} style={{ ...filterPill(relevance === v, C.amber), display: 'flex', textAlign: 'left' }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Region */}
        <div>
          <label style={labelCss}>Region</label>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={selCss}>
            <option value="all">All regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Group */}
        <div>
          <label style={labelCss}>Keyword group</label>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} style={selCss}>
            <option value="all">All groups</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Sort */}
        <div>
          <label style={labelCss}>Sort by</label>
          <select value={sort} onChange={e => setSort(e.target.value as SortMode)} style={selCss}>
            <option value="newest">Newest first</option>
            <option value="score">Highest score</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <button onClick={load} style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, fontSize: 13, cursor: 'pointer' }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} /> Refresh
        </button>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0, padding: '24px 28px' }}>

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '8px 14px', background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>n8n · News pipeline · 06:00 daily</span>
          <span style={{ fontSize: 12, color: C.faint }}>Social coming soon: YouTube · Reddit · TikTok · Instagram · LinkedIn · X</span>
          {totalCount != null && <span style={{ fontSize: 12, color: C.faint, marginLeft: 'auto' }}>{totalCount.toLocaleString()} total</span>}
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {([
            { label: 'Total signals', value: signals.length.toLocaleString(), color: C.text       },
            { label: 'Opportunities', value: stats.opps.toLocaleString(),     color: C.green      },
            { label: 'Threats',       value: stats.threats.toLocaleString(),  color: C.red        },
            { label: 'Avg relevance', value: `${stats.avg.toFixed(1)}/10`,   color: C.amber      },
          ]).map(({ label, value, color }) => (
            <div key={label} style={{ background: C.surface, borderRadius: 12, padding: '14px 16px', boxShadow: C.shadow }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '0 0 6px' }}>{label}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color, margin: 0, lineHeight: 1 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Map toggle */}
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => setShowMap(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, border: `1px solid ${showMap ? C.brandBorder : C.border}`, background: showMap ? C.brandBg : 'transparent', fontSize: 12, fontWeight: 500, color: showMap ? C.brandMid : C.muted, cursor: 'pointer', marginBottom: showMap ? 12 : 0 }}>
            <Map size={12} /> {showMap ? 'Hide map' : 'Show world map'}
          </button>
          {showMap && (
            <SignalMap signals={signals as any} selectedRegion={regionFilter === 'all' ? null : regionFilter} onRegionSelect={code => setRegionFilter(code ?? 'all')} />
          )}
        </div>

        {/* Result count */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 13, color: C.faint }}>{loading ? 'Loading…' : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'signal' : 'signals'}`}</span>
          {filtered.length > visible && <span style={{ fontSize: 13, color: C.faint }}>Showing {visible} of {filtered.length}</span>}
        </div>

        {/* Grid */}
        {loading && signals.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Spinner /><span style={{ fontSize: 14, color: C.faint }}>Loading signals…</span></div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <Radio size={28} style={{ color: C.border, margin: '0 auto 12px', display: 'block' }} />
            <p style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 12 }}>No signals match your filters</p>
            <button onClick={() => { setSearch(''); setClsFilter('all'); setRegionFilter('all'); setGroupFilter('all'); setRelevance('all') }}
              style={{ ...outlineBtn, fontSize: 13, padding: '7px 16px' }}>Reset filters</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <HeroCard signalCount={signals.length} lastUpdated={lastUpdated} />
              {visibleSignals.map(s => (
                <SignalCard key={s.id} signal={s} onClick={() => setSelected(s)} onSendTo={onSendTo} />
              ))}
            </div>
            {filtered.length > visible && (
              <button onClick={() => setVisible(v => v + SIG_PAGE)}
                style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 14, cursor: 'pointer', boxShadow: C.shadow }}>
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
    setResult(await callSales(body)); setLoading(false)
  }

  const pill = (val: string, cur: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 13,
    border: `1px solid ${cur === val ? C.brandBorder : C.border}`,
    background: cur === val ? C.brandBg : 'transparent',
    color: cur === val ? C.brandMid : C.muted, cursor: 'pointer',
  })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 860 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {([
          { id: 'gap' as const, label: 'Gap Finder', icon: Zap, desc: 'Who is the middleman? What can\'t they do? Where do we fit?' },
          { id: 'variance' as const, label: 'Variance Finder', icon: Sparkles, desc: 'What doesn\'t exist yet in this market that we could bring?' },
        ] as const).map(({ id, label, icon: Icon, desc }) => (
          <button key={id} onClick={() => { setMode(id); setResult('') }}
            style={{ padding: '16px 18px', borderRadius: 12, border: `1px solid ${mode === id ? C.brandBorder : C.border}`, background: mode === id ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', boxShadow: mode === id ? undefined : C.shadow, transition: 'all 0.12s' }}>
            <Icon size={16} style={{ color: mode === id ? C.brandLight : C.faint, marginBottom: 8 }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: mode === id ? C.brandMid : C.text, margin: '0 0 4px' }}>{label}</p>
            <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.5 }}>{desc}</p>
          </button>
        ))}
      </div>

      <div style={{ background: C.surface, borderRadius: 12, padding: '22px 24px', marginBottom: 20, boxShadow: C.shadow }}>
        {mode === 'gap' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div><label style={labelCss}>Target market</label><input value={market} onChange={e => setMarket(e.target.value)} placeholder="e.g. Germany, South Korea…" style={inputCss} /></div>
              <div><label style={labelCss}>Product / category</label><input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. rooibos bulk, herbal tea blends…" style={inputCss} /></div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {['Germany','South Korea','UAE','Japan','Netherlands','UK','Australia'].map(m => (
                <button key={m} onClick={() => setMarket(m)} style={pill(m, market)}>{m}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label style={labelCss}>Target market</label>
            <input value={market} onChange={e => setMarket(e.target.value)} placeholder="e.g. Germany, South Korea…" style={{ ...inputCss, marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {['Germany','South Korea','UAE','Japan','Netherlands','UK','Australia'].map(m => (
                <button key={m} onClick={() => setMarket(m)} style={pill(m, market)}>{m}</button>
              ))}
            </div>
          </>
        )}
        <button onClick={run} disabled={!market || loading} style={{ ...primaryBtn, opacity: market && !loading ? 1 : 0.4, cursor: market && !loading ? 'pointer' : 'default' }}>
          {loading ? <><Spinner size={14} color="#fff" /> Analysing…</> : mode === 'gap' ? <><Zap size={14} /> Find the gap</> : <><Sparkles size={14} /> Find variances</>}
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
    setResult(await callSales({ action: 'loophole_scan', keyword: keyword || undefined }))
    setLoading(false)
  }

  const kpill = (k: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 13,
    border: `1px solid ${keyword === k ? C.amberBorder : C.border}`,
    background: keyword === k ? C.amberBg : 'transparent',
    color: keyword === k ? C.amber : C.muted, cursor: 'pointer',
  })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 860 }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, padding: '16px 18px', background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 12 }}>
        <AlertTriangle size={17} style={{ color: C.amber, flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>The Bad News Layer</p>
          <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
            Most intelligence tools only surface good news. This tab actively hunts for competitor weaknesses, supply chain disruptions, quality recalls, and market exits — because someone else's problem is your opportunity window.
          </p>
        </div>
      </div>

      <div style={{ background: C.surface, borderRadius: 12, padding: '22px 24px', marginBottom: 20, boxShadow: C.shadow }}>
        <label style={labelCss}>Focus keyword (optional)</label>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. rooibos quality, Martin Bauer, Germany supply chain…"
          style={{ ...inputCss, marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
          {['rooibos shortage','competitor recall','price dumping','supply disruption','market exit'].map(k => (
            <button key={k} onClick={() => setKeyword(k)} style={kpill(k)}>{k}</button>
          ))}
        </div>
        <button onClick={scan} disabled={loading}
          style={{ ...primaryBtn, background: C.amber, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? <><Spinner size={14} color="#fff" /> Scanning…</> : <><AlertTriangle size={14} /> Scan for loopholes</>}
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
      void fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f1, stage: 'lead', notes: r.slice(0, 500), signal_title: f1 }) })
    }
  }

  const changeTool = (t: IntelTool) => { setTool(t); setResult(''); setF1(''); setF2(''); setF3('') }

  const pill = (val: string, cur: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 13,
    border: `1px solid ${cur === val ? C.brandBorder : C.border}`,
    background: cur === val ? C.brandBg : 'transparent',
    color: cur === val ? C.brandMid : C.muted, cursor: 'pointer',
  })

  const renderForm = () => {
    switch (tool) {
      case 'briefing': return (
        <div>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>Daily market snapshot — top opportunities, risks to watch, and one concrete action before Friday.</p>
          <button onClick={() => call({ action: 'briefing' })} style={primaryBtn}><BarChart2 size={14} /> Generate today's briefing</button>
        </div>
      )
      case 'frontier': return (
        <div>
          <label style={labelCss}>Target country</label>
          <input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. South Korea, UAE, Poland…" style={{ ...inputCss, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {['South Korea','UAE','Germany','Brazil','India','Netherlands','Poland','Australia'].map(c => <button key={c} onClick={() => setF1(c)} style={pill(c, f1)}>{c}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => f1 && call({ action: 'market_entry', country: f1 })} disabled={!f1} style={{ ...primaryBtn, opacity: f1 ? 1 : 0.4 }}><Globe size={14} /> Scout market</button>
            <button onClick={() => f1 && call({ action: 'cultural_scout', country: f1 })} disabled={!f1} style={{ ...outlineBtn, opacity: f1 ? 1 : 0.4 }}>Cultural brief</button>
          </div>
        </div>
      )
      case 'competitors': return (
        <div>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>Rooibos Ltd, Cape Natural Tea, Carmién, Khoisan, and emerging players — full competitive landscape with exploitable gaps.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => call({ action: 'competitor_scan' })} style={primaryBtn}><TrendingUp size={14} /> Full scan</button>
            <button onClick={() => call({ action: 'competitor_gaps' })} style={outlineBtn}>Exploit gaps</button>
          </div>
        </div>
      )
      case 'profiler': return (
        <div>
          <label style={labelCss}>Company name</label>
          <input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. T2 Tea, Pukka Herbs, Teekanne…" style={{ ...inputCss, marginBottom: 12 }} />
          <label style={labelCss}>Audience tag (optional)</label>
          <input value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. halal, women, gen_z, kosher…" style={{ ...inputCss, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {['halal','kosher','vegan','women','gen_z','millennial'].map(t => <button key={t} onClick={() => setF2(t)} style={pill(t, f2)}>{t}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => f1 && call({ action: 'company_profile', company: f1 })} disabled={!f1} style={{ ...primaryBtn, opacity: f1 ? 1 : 0.4 }}><Building2 size={14} /> Build dossier</button>
            {f2 && <button onClick={() => call({ action: 'audience_signals', audience_tag: f2 })} style={outlineBtn}>Audience signals</button>}
          </div>
        </div>
      )
      case 'pitch': return (
        <div>
          <div style={{ background: C.surfaceDim, borderRadius: 9, padding: '12px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>You bring the knowledge. Alara structures the approach.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
            <div><label style={labelCss}>Target market</label><input value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. Germany, South Korea…" style={inputCss} /></div>
            <div><label style={labelCss}>Buyer type</label><input value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. K-beauty brand, tea distributor…" style={inputCss} /></div>
          </div>
          <label style={labelCss}>Product format</label>
          <input value={f3} onChange={e => setF3(e.target.value)} placeholder="e.g. bulk loose leaf, RTD concentrate…" style={{ ...inputCss, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {['bulk loose leaf','rooibos extract','RTD concentrate','private label','OEM blend'].map(fmt => <button key={fmt} onClick={() => setF3(fmt)} style={pill(fmt, f3)}>{fmt}</button>)}
          </div>
          <button onClick={() => f1 && f2 && f3 && call({ action: 'pitch_builder', target_market: f1, buyer_type: f2, product_format: f3 })}
            disabled={!f1 || !f2 || !f3} style={{ ...primaryBtn, opacity: f1 && f2 && f3 ? 1 : 0.4 }}>
            <Mail size={14} /> Structure my pitch
          </button>
        </div>
      )
      case 'alerts': return (
        <div>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>5 urgent alerts — competitor moves, demand signals, regulatory changes, and time-sensitive windows.</p>
          <button onClick={() => call({ action: 'alerts' })} style={primaryBtn}><Bell size={14} /> Generate alerts</button>
        </div>
      )
    }
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 860 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
        {INTEL_TOOLS.map(({ id, label, Icon, desc }) => {
          const active = tool === id
          return (
            <button key={id} onClick={() => changeTool(id)}
              style={{ padding: '14px 14px', borderRadius: 12, border: `1px solid ${active ? C.brandBorder : C.border}`, background: active ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', boxShadow: active ? undefined : C.shadow, transition: 'all 0.12s' }}>
              <Icon size={15} style={{ color: active ? C.brandLight : C.faint, marginBottom: 7 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: active ? C.brandMid : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontSize: 12, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, borderRadius: 12, padding: '22px 24px', marginBottom: 20, boxShadow: C.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          {(() => { const t = INTEL_TOOLS.find(t => t.id === tool)!; return <t.Icon size={15} style={{ color: C.brandLight }} /> })()}
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{INTEL_TOOLS.find(t => t.id === tool)?.label}</span>
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
    const form = new FormData(); form.append('file', file)
    try {
      const r = await fetch('/api/vault/upload', { method: 'POST', body: form })
      const d = await r.json()
      if (d.success) {
        setUploadMsg({ ok: true, text: `"${d.filename}" indexed — ${d.category_detected} · ~${d.estimated_chunks} chunks` })
        setFiles(prev => [{ name: d.filename, category: d.category_detected, uploadedAt: new Date().toISOString(), size: file.size }, ...prev])
      } else setUploadMsg({ ok: false, text: d.error ?? 'Upload failed.' })
    } catch { setUploadMsg({ ok: false, text: 'Upload failed.' }) }
    finally { setUploading(false) }
  }

  const runQuery = async () => {
    if (!query.trim() || querying) return
    setQuerying(true); setAnswer('')
    try {
      const r = await fetch('/api/vault/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const d = await r.json(); setAnswer(d.answer ?? d.error ?? 'No answer.')
    } catch { setAnswer('Query failed.') }
    finally { setQuerying(false) }
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ background: C.brandBg, border: `1px solid ${C.brandBorder}`, borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Leaf size={14} style={{ color: C.brandLight, flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.65 }}>
          Everything you add here trains Alara's responses. Trip reports, pricing history, contracts, and competitor intel all improve Gap Finder, Pitch Structurer, and Loophole Scan results over time.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12 }}>Add to vault</p>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f) }}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: uploading ? C.brandBg : C.surface, marginBottom: 12, transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!uploading) (e.currentTarget as HTMLElement).style.borderColor = C.brandLight }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border }}
          >
            <Upload size={22} style={{ color: uploading ? C.brandLight : C.faint, margin: '0 auto 10px', display: 'block' }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: uploading ? C.brandMid : C.text, margin: '0 0 4px' }}>
              {uploading ? 'Uploading…' : 'Drop a file or click to browse'}
            </p>
            <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>PDF · PPTX · XLSX · DOCX · CSV · TXT · Max 50MB</p>
            <input ref={fileRef} type="file" accept=".pdf,.pptx,.xlsx,.docx,.csv,.txt" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
          </div>
          {uploadMsg && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: uploadMsg.ok ? C.greenBg : C.redBg, border: `1px solid ${uploadMsg.ok ? C.greenBorder : C.redBorder}`, fontSize: 13, color: uploadMsg.ok ? C.green : C.red }}>
              {uploadMsg.text}
            </div>
          )}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: C.shadow }}>
                  <FileText size={14} style={{ color: C.faint, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                    <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>{(f.size / 1024).toFixed(0)} KB · {timeAgo(f.uploadedAt)}</p>
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: 6, background: C.brandBg, color: C.brandMid, fontSize: 12, fontWeight: 500 }}>{f.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12 }}>Query the vault</p>
          <p style={{ fontSize: 13, color: C.faint, marginBottom: 16, lineHeight: 1.6 }}>Alara synthesises answers from your private documents. Raw content is never returned.</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runQuery()}
              placeholder="e.g. What did we quote Germany last year?"
              style={{ ...inputCss, flex: 1 }} />
            <button onClick={runQuery} disabled={!query.trim() || querying}
              style={{ ...primaryBtn, opacity: query.trim() && !querying ? 1 : 0.4, cursor: query.trim() && !querying ? 'pointer' : 'default' }}>
              {querying ? <Spinner size={14} color="#fff" /> : 'Ask'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
            {['Any Korea trip reports?','Latest Germany pricing?','Japan volume commitments?','Pending contracts?'].map(q => (
              <button key={q} onClick={() => setQuery(q)}
                style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${C.border}`, background: 'transparent', fontSize: 13, color: C.muted, cursor: 'pointer' }}>{q}</button>
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
    setResult(await callSales({ action: 'expansion_briefing', vector: vec }))
    setLoading(false)
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
        {VECTORS.map(({ id, label, Icon, desc, tag }) => {
          const active = vec === id
          return (
            <button key={id} onClick={() => { setVec(id); setResult('') }}
              style={{ padding: '14px 16px', borderRadius: 12, border: `1px solid ${active ? C.brandBorder : C.border}`, background: active ? C.brandBg : C.surface, cursor: 'pointer', textAlign: 'left', boxShadow: active ? undefined : C.shadow, transition: 'all 0.12s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Icon size={15} style={{ color: active ? C.brandLight : C.faint }} />
                <span style={{ padding: '2px 7px', borderRadius: 5, background: active ? C.brandBg : C.surfaceDim, color: active ? C.brandMid : C.muted, fontSize: 11, fontWeight: 500 }}>{tag}</span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: active ? C.brandMid : C.text, margin: '0 0 3px' }}>{label}</p>
              <p style={{ fontSize: 12, color: C.faint, margin: 0, lineHeight: 1.4 }}>{desc}</p>
            </button>
          )
        })}
      </div>
      <div style={{ background: C.surface, borderRadius: 12, padding: '18px 22px', marginBottom: 18, boxShadow: C.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <selected.Icon size={17} style={{ color: C.brandLight }} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{selected.label}</p>
              <p style={{ fontSize: 13, color: C.muted, margin: '2px 0 0' }}>{selected.desc}</p>
            </div>
          </div>
          <button onClick={generate} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? <><Spinner size={14} color="#fff" /> Generating…</> : <><Sparkles size={14} /> Get briefing</>}
          </button>
        </div>
      </div>
      {result && <AiResult text={result} loading={false} label={`${selected.label} Briefing`} saveable reportType="expansion_briefing" />}
      {!result && !loading && (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <Compass size={28} style={{ color: C.border, margin: '0 auto 12px', display: 'block' }} />
          <p style={{ fontSize: 14, color: C.faint }}>Select an expansion vector and click "Get briefing".</p>
        </div>
      )}
    </div>
  )
}

// ─── About ────────────────────────────────────────────────────────────────────

const SIGNAL_SCHEDULE = [
  { day: 'Monday',    region: 'Europe',        detail: 'DE · NL · FR · UK + EU hashtags'           },
  { day: 'Tuesday',   region: 'Asia',          detail: 'JP · KR · CN · IN'                         },
  { day: 'Wednesday', region: 'Americas',      detail: 'US · BR · MX · CA'                         },
  { day: 'Thursday',  region: 'Africa + ME',   detail: 'ZA · AE + competitor watch'                },
  { day: 'Friday',    region: 'Global themes', detail: 'wellness · skincare · clinical · white-space'},
  { day: 'Sat / Sun', region: 'Light',         detail: 'News only, or rest'                        },
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
    <div style={{ padding: '32px 32px', maxWidth: 860 }}>
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 32, padding: '24px 28px', background: C.surface, borderRadius: 16, boxShadow: C.shadowMenu }}>
        <div style={{ flexShrink: 0 }}>
          <AlaraLogoMark size={72} />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 700, fontFamily: 'Georgia,"Times New Roman",serif', color: '#3D1A14', letterSpacing: '0.12em', textTransform: 'uppercase' as const, display: 'block', lineHeight: 1.2 }}>Alara</span>
            <span style={{ fontSize: 11, color: '#8B6055', letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>Sales Intelligence Engine</span>
          </div>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: '0 0 16px', maxWidth: 540 }}>
            A living market intelligence system built for CNTP — turning raw signals from global trade, social platforms, and news into ranked, actionable intelligence for the rooibos export team.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: C.greenBg, border: `1px solid ${C.greenBorder}`, fontSize: 12, fontWeight: 600, color: C.green }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} /> Engine active
            </span>
            <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 20, background: C.surfaceDim, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>15+ live sources</span>
            <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 20, background: C.surfaceDim, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>Gemini-powered</span>
          </div>
        </div>
      </div>

      {/* Etymology */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 }}>Name</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { part: 'Ala', origin: 'Aspalathus linearis', desc: 'The botanical name of the rooibos plant. The first three letters anchor this engine to the source.' },
            { part: 'ra',  origin: 'Rooibos · Intelligence', desc: 'The intelligence designation — named for the ability to range, detect, and act on what others miss.' },
          ].map(({ part, origin, desc }) => (
            <div key={part} style={{ padding: '18px 20px', background: C.surface, borderRadius: 12, boxShadow: C.shadow }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: C.brandMid, letterSpacing: '-0.03em', display: 'block', marginBottom: 4 }}>{part}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.brandLight, textTransform: 'uppercase' as const, letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>{origin}</span>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Signal schedule */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 }}>Signal schedule</p>
        <div style={{ background: C.surface, borderRadius: 12, overflow: 'hidden', boxShadow: C.shadow }}>
          {SIGNAL_SCHEDULE.map((row, i) => (
            <div key={row.day} style={{ display: 'grid', gridTemplateColumns: '110px 150px 1fr', padding: '12px 20px', alignItems: 'center', borderBottom: i < SIGNAL_SCHEDULE.length - 1 ? `1px solid ${C.borderLight}` : undefined, background: i % 2 === 1 ? C.surfaceRaised : undefined }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{row.day}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.brandMid }}>{row.region}</span>
              <span style={{ fontSize: 13, color: C.muted }}>{row.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 }}>Capabilities</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {caps.map(({ id, label, Icon, desc }) => (
            <button key={id} onClick={() => onNavigate(id)}
              style={{ padding: '16px 18px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', textAlign: 'left', boxShadow: C.shadow, transition: 'box-shadow 0.15s, transform 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = C.shadowHover; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = C.shadow; (e.currentTarget as HTMLElement).style.transform = 'none' }}>
              <Icon size={14} style={{ color: C.brandLight, marginBottom: 9 }} />
              <p style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: '0 0 5px' }}>{label}</p>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, margin: 0 }}>{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 18px', background: C.surfaceDim, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Info size={14} style={{ color: C.faint, flexShrink: 0 }} />
        <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
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
  const [section,         setSection]         = useState<Section>('signals')
  const [gapPreload,      setGapPreload]      = useState<string | undefined>()
  const [loopholePreload, setLoopholePreload] = useState<string | undefined>()

  const handleSendTo = (dest: 'gap' | 'loopholes', term: string) => {
    if (dest === 'gap') { setGapPreload(term); setSection('gap') }
    else                { setLoopholePreload(term); setSection('loopholes') }
  }

  return (
    <div style={{ minHeight: '100%' }}>

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(16px)', borderBottom: `1px solid ${C.border}` }}>

        {/* Top bar */}
        <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <AlaraLogoMark size={32} />
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'Georgia,"Times New Roman",serif', color: '#3D1A14', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>Alara</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, display: 'inline-block' }} />
              <span style={{ fontSize: 12, color: C.muted }}>Engine active</span>
            </div>
            <button onClick={() => setSection('about')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, border: `1px solid ${section === 'about' ? C.brandBorder : C.border}`, background: section === 'about' ? C.brandBg : 'transparent', fontSize: 12, fontWeight: 500, color: section === 'about' ? C.brandMid : C.muted, cursor: 'pointer' }}>
              <Info size={12} /> About
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 24px', borderTop: `1px solid ${C.borderLight}` }}>
          {SECTIONS.map(({ id, label, Icon }) => {
            const active = section === id
            return (
              <button key={id} onClick={() => setSection(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: active ? `2px solid ${C.brandLight}` : '2px solid transparent',
                  color: active ? C.brand : C.muted,
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  transition: 'color 0.1s, border-color 0.1s', marginBottom: -1, whiteSpace: 'nowrap' as const,
                }}>
                <Icon size={13} />{label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
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
