'use client'

// app/(app)/research/page.tsx
//
// Unified Research + Sales Intelligence — clean rebuild.
//
// Design principles this time:
//  • Uses the APP'S LIGHT design system (--color-surface, --color-text, etc.)
//    NOT a custom dark theme — this page should feel like the rest of CNTP Ops.
//  • One thing on screen at a time. Signal feed is a collapsible drawer.
//    Analytics is gone from the main view (data is in the KPI tiles only).
//  • Two tabs: Research (Ollama chat) | Sales Intelligence (Gemini tools).
//  • Sales Intelligence has a LEFT sidebar nav — not a cramped pill strip.
//  • Plenty of whitespace. Nothing competes with anything else.

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import {
  Send, Square, RefreshCw, Beaker, Cpu, Plus, Clock,
  Trash2, Hash, Newspaper, MessageSquare, Camera,
  TrendingUp, ChevronRight, ExternalLink, FileText,
  Upload, X, AlertTriangle, Info, CheckCircle,
  Zap, BarChart3, Users, FileBarChart, Bell,
  PanelLeftOpen, PanelLeftClose, Activity,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab      = 'research' | 'sales'
type SalesNav = 'briefing' | 'scout' | 'competitors' | 'relationships' | 'files' | 'reports' | 'alerts'
type Platform = 'news' | 'reddit' | 'tiktok' | 'instagram' | 'twitter' | 'x' | string

interface Signal      { platform: Platform; title: string; content: string; link?: string }
interface ChatMessage { id: number; role: 'user' | 'assistant'; content: string; model?: string }
interface ChatSession { id: string; topic: string; messages: ChatMessage[]; createdAt: number; updatedAt: number }
interface MarketCard  { country: string; flag: string; region: string; score: number; tag: string }

// ─── Constants ────────────────────────────────────────────────────────────────

let cachedFeed: Signal[] = []
let msgId = 0

const RESEARCH_SUGGESTIONS = [
  { label: 'Where should CNTP expand next?',        query: 'Which export markets outside Japan should CNTP prioritise right now, and why?' },
  { label: 'Competitor weaknesses to exploit',      query: 'Where are Rooibos Ltd and Cape Natural Tea weakest and how can CNTP take advantage?' },
  { label: 'Pitch for a German distributor',        query: 'Write a strong opening pitch for a bulk rooibos supply proposal to a German health food distributor.' },
  { label: 'UAE market entry requirements',         query: 'What certifications, regulations, and contacts does CNTP need to enter the UAE bulk tea market?' },
]

const QUICK_QUERIES = [
  'Best market to enter next?',
  'How do we beat Rooibos Ltd in Germany?',
  'Write a cold email for a Korean buyer',
  'What are our top competitive advantages?',
]

const DEFAULT_MARKETS: MarketCard[] = [
  { country: 'Germany',     flag: '🇩🇪', region: 'Europe · DACH',   score: 88, tag: 'Priority' },
  { country: 'South Korea', flag: '🇰🇷', region: 'Asia · East',     score: 82, tag: 'Hot'      },
  { country: 'UAE',         flag: '🇦🇪', region: 'Middle East',     score: 79, tag: 'Hot'      },
  { country: 'Netherlands', flag: '🇳🇱', region: 'Europe · Hub',    score: 76, tag: 'Rising'   },
  { country: 'Canada',      flag: '🇨🇦', region: 'North America',   score: 74, tag: 'Stable'   },
  { country: 'Poland',      flag: '🇵🇱', region: 'Europe · East',   score: 68, tag: 'Frontier' },
]

const COMPETITORS = [
  { rank: 1, name: 'Rooibos Ltd.',     detail: 'South Africa · Largest producer',  threat: 'High'   },
  { rank: 2, name: 'Cape Natural Tea', detail: 'South Africa · Premium segment',   threat: 'High'   },
  { rank: 3, name: "Carmién Tea",      detail: 'South Africa · Retail & export',   threat: 'Medium' },
  { rank: 4, name: 'Khoisan Tea',      detail: 'South Africa · Organic niche',     threat: 'Low'    },
]

const STATIC_ALERTS = [
  { type: 'warn', title: 'Competitor move',     body: 'Rooibos Ltd. expanding into South Korean health food channel. Accelerate CNTP Korea positioning.' },
  { type: 'info', title: 'Demand signal',       body: 'EU caffeine-free herbal demand up 31% YoY. DACH region showing strongest growth window.' },
  { type: 'ok',   title: 'Opportunity window',  body: 'UAE hospitality sector sourcing premium botanicals. Dubai & Abu Dhabi hotel chains. Window: 6–18 months.' },
]

const SALES_NAV: { key: SalesNav; label: string; icon: React.ReactNode; badge?: number }[] = [
  { key: 'briefing',      label: 'Market briefing',   icon: <Activity size={15}/> },
  { key: 'scout',         label: 'Frontier scout',    icon: <TrendingUp size={15}/> },
  { key: 'competitors',   label: 'Competitors',       icon: <BarChart3 size={15}/> },
  { key: 'relationships', label: 'Relationships',     icon: <Users size={15}/> },
  { key: 'files',         label: 'File intelligence', icon: <FileText size={15}/> },
  { key: 'reports',       label: 'Reports',           icon: <FileBarChart size={15}/> },
  { key: 'alerts',        label: 'Alerts',            icon: <Bell size={15}/>, badge: 3 },
]

const SALES_ROLES = ['admin', 'management', 'sales']

// ─── Supabase session helpers ─────────────────────────────────────────────────
// All session data stored in sales_research_sessions.
// Falls back gracefully if Supabase is unavailable.

async function dbLoadSessions(engine: 'research' | 'sales'): Promise<ChatSession[]> {
  try {
    const sb = getDb()
    const { data, error } = await sb
      .schema('sales').from('research_sessions')
      .select('id, topic, messages, created_at, updated_at')
      .eq('engine', engine)
      .order('updated_at', { ascending: false })
      .limit(50)
    if (error || !data) return []
    return data.map((r: any) => ({
      id:        r.id,
      topic:     r.topic,
      messages:  r.messages as ChatMessage[],
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }))
  } catch { return [] }
}

async function dbUpsertSession(engine: 'research' | 'sales', session: ChatSession): Promise<void> {
  try {
    const sb = getDb()
    await sb.schema('sales').from('research_sessions').upsert({
      id:       session.id,
      engine,
      topic:    session.topic,
      messages: session.messages,
    }, { onConflict: 'id' })
  } catch {}
}

async function dbDeleteSession(id: string): Promise<void> {
  try {
    const sb = getDb()
    await sb.schema('sales').from('research_sessions').delete().eq('id', id)
  } catch {}
}

async function dbLoadMarkets(): Promise<MarketCard[]> {
  try {
    const sb = getDb()
    const { data } = await sb
      .schema('sales').from('market_scores')
      .select('country, flag, region, score, tag')
      .order('score', { ascending: false })
    if (data && data.length > 0) return data as MarketCard[]
    return DEFAULT_MARKETS
  } catch { return DEFAULT_MARKETS }
}

async function dbSaveMarkets(markets: MarketCard[], filter: string): Promise<void> {
  try {
    const sb = getDb()
    for (const m of markets) {
      await sb.schema('sales').from('market_scores').upsert({
        country: m.country, flag: m.flag, region: m.region,
        score: m.score, tag: m.tag, filter_type: filter,
      }, { onConflict: 'country' })
    }
  } catch {}
}

async function dbLoadAlerts(): Promise<typeof STATIC_ALERTS> {
  try {
    const sb = getDb()
    const { data } = await sb
      .schema('sales').from('alerts')
      .select('type, title, body')
      .order('created_at', { ascending: false })
      .limit(10)
    if (data && data.length > 0) return data as typeof STATIC_ALERTS
    return STATIC_ALERTS
  } catch { return STATIC_ALERTS }
}

async function dbSaveIntelCache(key: string, content: string): Promise<void> {
  try {
    const sb = getDb()
    await sb.schema('sales').from('intel_cache').upsert({
      cache_key: key, content,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'cache_key' })
  } catch {}
}

async function dbLoadIntelCache(key: string): Promise<string | null> {
  try {
    const sb = getDb()
    const { data } = await sb
      .schema('sales').from('intel_cache')
      .select('content, expires_at')
      .eq('cache_key', key)
      .single()
    if (!data) return null
    if (new Date(data.expires_at) < new Date()) return null   // expired
    return data.content
  } catch { return null }
}

async function dbSaveReport(userId: string, type: string, content: string): Promise<void> {
  try {
    const sb = getDb()
    const titles: Record<string, string> = {
      full: 'Full Market Report', country: 'Country Entry Report',
      competitive: 'Competitive Landscape', partnership: 'Partnership Roadmap',
    }
    await sb.schema('sales').from('reports').insert({
      user_id: userId, report_type: type,
      title: titles[type] ?? type, content,
    })
  } catch {}
}

async function dbSaveDocument(userId: string, filename: string, intel: string): Promise<void> {
  try {
    const sb = getDb()
    await sb.schema('sales').from('documents').insert({
      user_id: userId, filename, extracted_intel: intel,
    })
  } catch {}
}

function makeTopic(msg: string): string {
  const t = msg.trim().replace(/[?!.]$/, '')
  if (t.length <= 46) return t
  return t.substring(0, t.lastIndexOf(' ', 46)) + '…'
}
function fmtRel(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000)     return 'Just now'
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ResearchCommandCenter() {
  const { role, user } = useAuth()
  const canSeeSales = SALES_ROLES.includes(role ?? '')

  const [tab,           setTab]          = useState<Tab>('research')
  const [feed,          setFeed]         = useState<Signal[]>(cachedFeed)
  const [feedOpen,      setFeedOpen]     = useState(false)
  const [feedBusy,      setFeedBusy]     = useState(false)

  // Research
  const [rSessions,    setRSessions]    = useState<ChatSession[]>([])
  const [rActiveId,    setRActiveId]    = useState<string | null>(null)
  const [rQuery,       setRQuery]       = useState('')
  const [rProcessing,  setRProcessing]  = useState(false)
  const [rStreamId,    setRStreamId]    = useState<number | null>(null)
  const [rShowHistory, setRShowHistory] = useState(false)

  // Sales
  const [sNav,          setSNav]         = useState<SalesNav>('briefing')
  const [sSessions,     setSSessions]    = useState<ChatSession[]>([])
  const [sActiveId,     setSActiveId]    = useState<string | null>(null)
  const [sQuery,        setSQuery]       = useState('')
  const [sProcessing,   setSProcessing]  = useState(false)
  const [sStreamId,     setSStreamId]    = useState<number | null>(null)
  const [markets,       setMarkets]      = useState<MarketCard[]>(DEFAULT_MARKETS)
  const [selMarket,     setSelMarket]    = useState<string | null>(null)
  const [salesOut,      setSalesOut]     = useState<Record<string, string>>({})
  const [salesLoad,     setSalesLoad]    = useState<Record<string, boolean>>({})
  const [usageMeta,     setUsageMeta]    = useState<{ usageToday: number; dailyLimit: number; nearingLimit: boolean; limitReached: boolean; searchUrl?: string } | null>(null)
  const [preGenStatus,  setPreGenStatus]  = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [files,         setFiles]        = useState<{name:string;size:number}[]>([])
  const [dbAlerts,      setDbAlerts]     = useState<typeof STATIC_ALERTS>(STATIC_ALERTS)

  const rAbort   = useRef<AbortController | null>(null)
  const rBottom  = useRef<HTMLDivElement | null>(null)
  const sBottom  = useRef<HTMLDivElement | null>(null)
  const rTa      = useRef<HTMLTextAreaElement | null>(null)
  const sTa      = useRef<HTMLTextAreaElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // Load sessions and market scores from Supabase on mount
  useEffect(() => {
    dbLoadSessions('research').then(setRSessions)
    dbLoadSessions('sales').then(setSSessions)
    dbLoadMarkets().then(setMarkets)
    dbLoadAlerts().then(alerts => {
      if (alerts.length > 0) setDbAlerts(alerts)
    })
    // Pre-populate sales outputs from cache on mount
    const cacheKeys = ['briefing', 'risk', 'competitors', 'comp_gaps', 'partnerships', 'objections', 'contacts',
      'report:full', 'report:country', 'report:competitive', 'report:partnership', 'alerts']
    Promise.all(cacheKeys.map(async key => {
      const cached = await dbLoadIntelCache(key)
      if (cached) setSalesOut(p => ({ ...p, [key]: cached }))
    }))
  }, [])

  // Pre-load cached intelligence when sales tab is first opened
  const preGenDone = useRef(false)
  const triggerPreGen = useCallback(async () => {
    if (preGenDone.current) return
    preGenDone.current = true
    setPreGenStatus('running')
    try {
      const res = await fetch('/api/sales/pregenerate', { method: 'POST' })
      const data = await res.json()
      if (data.regenerated?.length > 0) {
        // Reload cache for any freshly generated keys
        const keys = ['briefing', 'risk', 'competitors', 'comp_gaps', 'partnerships', 'objections', 'contacts']
        for (const key of keys) {
          const cached = await dbLoadIntelCache(key)
          if (cached) setSalesOut(p => ({ ...p, [key]: cached }))
        }
      }
      setPreGenStatus('done')
    } catch {
      setPreGenStatus('error')
    }
  }, [])
  useEffect(() => { rBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [rSessions, rActiveId])
  useEffect(() => { sBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [sSessions, sActiveId])

  const rActive = rSessions.find(s => s.id === rActiveId) ?? null
  const sActive = sSessions.find(s => s.id === sActiveId) ?? null

  // ── Feed ──────────────────────────────────────────────────────────────────
  const refreshFeed = useCallback(async () => {
    setFeedBusy(true)
    try {
      const res = await fetch('/live_feed.json', { cache: 'no-store' })
      if (res.ok) { const d: Signal[] = await res.json(); cachedFeed = d; setFeed(d) }
    } catch {}
    finally { setFeedBusy(false) }
  }, [])

  useEffect(() => { if (cachedFeed.length === 0) refreshFeed() }, [refreshFeed])

  // ── Research query ────────────────────────────────────────────────────────
  const handleResearchQuery = useCallback(async (text: string) => {
    if (!text.trim() || rProcessing) return
    rAbort.current?.abort()
    const ctrl = new AbortController(); rAbort.current = ctrl

    const uMsg: ChatMessage = { id: ++msgId, role: 'user', content: text.trim() }
    const aId = ++msgId
    const aMsg: ChatMessage = { id: aId, role: 'assistant', content: '', model: undefined }

    let sid = rActiveId; let updated: ChatSession[]
    if (!sid) {
      sid = `r_${Date.now()}`
      updated = [{ id: sid, topic: makeTopic(text), messages: [uMsg, aMsg], createdAt: Date.now(), updatedAt: Date.now() }, ...rSessions]
      setRActiveId(sid)
    } else {
      updated = rSessions.map(s => s.id === sid ? { ...s, messages: [...s.messages, uMsg, aMsg], updatedAt: Date.now() } : s)
    }
    setRSessions(updated); dbUpsertSession('research', updated[0])
    setRQuery(''); setRProcessing(true); setRStreamId(aId); setRShowHistory(false)

    try {
      const res = await fetch('/api/research', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text.trim() }), signal: ctrl.signal,
      })

      // Parse as JSON — Ollama returns a complete JSON object, not a stream
      const data = await res.json().catch(() => ({ response: 'Request failed.', model: undefined }))

      if (!res.ok) {
        const errText = data.response ?? 'Engine error.'
        setRSessions(prev => { const f = prev.map(s => s.id === sid ? { ...s, messages: s.messages.map(m => m.id === aId ? { ...m, content: errText } : m) } : s); f.forEach(s => dbUpsertSession('research', s)); return f })
        return
      }

      const responseText: string = data.response ?? 'No response.'
      const modelUsed: string | undefined = data.model

      // Unescape literal \n sequences the model sometimes returns
      const cleaned = responseText
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '  ')
        .trim()

      setRSessions(prev => { const f = prev.map(s => s.id === sid ? { ...s, messages: s.messages.map(m => m.id === aId ? { ...m, content: cleaned, model: modelUsed } : m), updatedAt: Date.now() } : s); f.forEach(s => dbUpsertSession('research', s)); return f })

    } catch (e: any) {
      const c = e.name === 'AbortError' ? '[Stopped]' : 'Could not reach the engine. Is Docker running?'
      setRSessions(prev => { const f = prev.map(s => s.id === sid ? { ...s, messages: s.messages.map(m => m.id === aId ? { ...m, content: c } : m) } : s); f.forEach(s => dbUpsertSession('research', s)); return f })
    } finally { setRProcessing(false); setRStreamId(null); rAbort.current = null; rTa.current?.focus() }
  }, [rProcessing, rActiveId, rSessions])

  // ── Sales API call ────────────────────────────────────────────────────────
  const callSales = useCallback(async (action: string, payload: Record<string,unknown> = {}, key?: string): Promise<string> => {
    const k = key ?? action
    setSalesLoad(p => ({ ...p, [k]: true }))

    // Check cache first for non-agent, non-file calls
    const cacheable = !['agent', 'file_analysis', 'scout'].includes(action)
    if (cacheable) {
      const cached = await dbLoadIntelCache(k)
      if (cached) {
        setSalesOut(p => ({ ...p, [k]: cached }))
        setSalesLoad(p => ({ ...p, [k]: false }))
        return cached
      }
    }

    try {
      const res = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
      const data = await res.json()
      const text = data.response ?? data.error ?? 'No response.'
      const modelUsed: string | undefined = data.model
      setSalesOut(p => ({ ...p, [k]: text }))

      // Store usage metadata for the warning banner
      if (data.usageToday !== undefined) {
        setUsageMeta({
          usageToday:   data.usageToday,
          dailyLimit:   data.dailyLimit,
          nearingLimit: data.nearingLimit,
          limitReached: data.limitReached,
          searchUrl:    data.searchUrl ?? undefined,
        })
      }

      // Cache the result
      if (cacheable && !text.startsWith('Error') && !data.limitReached) dbSaveIntelCache(k, text)

      // Save reports to DB
      if (action === 'report' && user?.id && !data.limitReached) dbSaveReport(user.id, (payload.reportType as string) ?? 'full', text)

      return text
    } catch (e: any) {
      const msg = `Error: ${e.message}`
      setSalesOut(p => ({ ...p, [k]: msg }))
      return msg
    } finally { setSalesLoad(p => ({ ...p, [k]: false })) }
  }, [user?.id])

  // ── Sales agent chat ──────────────────────────────────────────────────────
  const handleSalesQuery = useCallback(async (text: string) => {
    if (!text.trim() || sProcessing) return
    const uMsg: ChatMessage = { id: ++msgId, role: 'user', content: text.trim() }
    const aId = ++msgId
    const aMsg: ChatMessage = { id: aId, role: 'assistant', content: '' }

    let sid = sActiveId; let updated: ChatSession[]
    if (!sid) {
      sid = `s_${Date.now()}`
      updated = [{ id: sid, topic: makeTopic(text), messages: [uMsg, aMsg], createdAt: Date.now(), updatedAt: Date.now() }, ...sSessions]
      setSActiveId(sid)
    } else {
      updated = sSessions.map(s => s.id === sid ? { ...s, messages: [...s.messages, uMsg, aMsg], updatedAt: Date.now() } : s)
    }
    setSSessions(updated); dbUpsertSession('sales', updated[0])
    setSQuery(''); setSProcessing(true); setSStreamId(aId)

    const response = await callSales('agent', { query: text.trim() }, `agent_${aId}`)
    setSSessions(prev => { const f = prev.map(s => s.id === sid ? { ...s, messages: s.messages.map(m => m.id === aId ? { ...m, content: response } : m), updatedAt: Date.now() } : s); f.forEach(s => dbUpsertSession('sales', s)); return f })
    setSProcessing(false); setSStreamId(null); sTa.current?.focus()
  }, [sProcessing, sActiveId, sSessions, callSales])

  const deleteR = (id: string, e: React.MouseEvent) => { e.stopPropagation(); const u = rSessions.filter(s => s.id !== id); setRSessions(u); dbDeleteSession(id); if (rActiveId === id) setRActiveId(null) }
  const deleteS = (id: string, e: React.MouseEvent) => { e.stopPropagation(); const u = sSessions.filter(s => s.id !== id); setSSessions(u); dbDeleteSession(id); if (sActiveId === id) setSActiveId(null) }

  const handleFiles = async (fl: FileList | null) => {
    if (!fl) return
    for (const file of Array.from(fl)) {
      setFiles(p => [...p, { name: file.name, size: file.size }])

      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const isPdf = ext === 'pdf'
      const isText = ['txt', 'csv', 'md', 'json'].includes(ext)
      const isOffice = ['docx', 'xlsx', 'xls', 'doc'].includes(ext)

      let fileContent: string

      if (isPdf) {
        // PDFs: can't extract text in browser without pdf.js
        // Send structured context so Gemini can still give useful intelligence
        fileContent = `DOCUMENT TYPE: PDF
FILENAME: ${file.name}
FILE SIZE: ${(file.size / 1024).toFixed(0)}KB
NOTE: Full PDF text extraction requires server-side processing. Based on the filename and document type, provide the most useful sales intelligence possible for CNTP rooibos bulk exports.`
      } else if (isText) {
        // Text files: read fully
        fileContent = await file.text().catch(() => `[Could not read ${file.name}]`)
        // Trim to 8000 chars to stay within Gemini token limits
        if (fileContent.length > 8000) {
          fileContent = fileContent.substring(0, 8000) + '\n\n[Content truncated at 8000 characters]'
        }
      } else if (isOffice) {
        // Office files: try reading as text — will get some readable content from DOCX/CSV
        try {
          const raw = await file.text()
          // DOCX is XML-based — strip XML tags to get readable text
          fileContent = raw
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/[^\x20-\x7E\n]/g, '')
            .trim()
            .substring(0, 8000)
          if (fileContent.length < 50) {
            fileContent = `DOCUMENT TYPE: ${ext.toUpperCase()}
FILENAME: ${file.name}
FILE SIZE: ${(file.size/1024).toFixed(0)}KB
Content could not be extracted. Provide intelligence based on the filename.`
          }
        } catch {
          fileContent = `DOCUMENT TYPE: ${ext.toUpperCase()}
FILENAME: ${file.name}
FILE SIZE: ${(file.size/1024).toFixed(0)}KB`
        }
      } else {
        fileContent = `DOCUMENT TYPE: ${ext.toUpperCase()}
FILENAME: ${file.name}
FILE SIZE: ${(file.size/1024).toFixed(0)}KB`
      }

      const intel = await callSales('file_analysis', { filename: file.name, content: fileContent }, `file:${file.name}`)
      if (user?.id && !intel.startsWith('Error')) {
        dbSaveDocument(user.id, file.name, intel)
      }
    }
  }

  const scoutMarkets = async (filter = 'all') => {
    const raw = await callSales('scout', { filter }, `scout:${filter}`)
    const m = raw.match(/\[[\s\S]*\]/)
    if (m) {
      try {
        const parsed: MarketCard[] = JSON.parse(m[0])
        setMarkets(parsed)
        dbSaveMarkets(parsed, filter)
      } catch {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)] font-body">

      {/* ── Signal Feed Drawer ─────────────────────────────────────────── */}
      {feedOpen && (
        <div className="flex flex-col shrink-0 overflow-hidden border-r border-[var(--color-surface-rule)] bg-white" style={{ width: 300 }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-surface-rule)]">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Signal stream</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{feed.length} live sources from gather.py</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refreshFeed} className="p-1.5 rounded hover:bg-[var(--color-surface)] transition-colors text-[var(--color-text-muted)]">
                <RefreshCw size={13} className={feedBusy ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => setFeedOpen(false)} className="p-1.5 rounded hover:bg-[var(--color-surface)] transition-colors text-[var(--color-text-muted)]">
                <PanelLeftClose size={13} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {feed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-12">
                <div className="w-10 h-10 rounded-full bg-[var(--color-surface)] flex items-center justify-center">
                  <Zap size={16} className="text-[var(--color-text-faint)]" />
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">No signals yet</p>
                <p className="text-xs text-[var(--color-text-faint)]">Run gather.py to start pulling live market signals</p>
              </div>
            ) : feed.map((signal, i) => (
              <button
                key={i}
                onClick={() => {
                  if (tab === 'research') handleResearchQuery(signal.title)
                  else handleSalesQuery(signal.title)
                  setFeedOpen(false)
                }}
                className="w-full text-left px-4 py-3.5 border-b border-[var(--color-surface-rule)] hover:bg-[var(--color-surface)] transition-colors group"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FeedIcon platform={signal.platform} />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">{signal.platform}</span>
                  {signal.content && <span className="text-[10px] text-[var(--color-text-faint)] truncate">· {signal.content}</span>}
                </div>
                <p className="text-[13px] font-medium text-[var(--color-text)] leading-snug line-clamp-2 group-hover:text-[var(--color-accent)]">
                  {signal.title}
                </p>
                {signal.link && (() => { try { return <p className="text-[11px] text-[var(--color-text-faint)] mt-1 flex items-center gap-1"><ExternalLink size={9}/>{new URL(signal.link).hostname.replace('www.','')}</p> } catch { return null } })()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Area ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 border-b border-[var(--color-surface-rule)] bg-white shrink-0" style={{ height: 52 }}>
          {/* Feed toggle */}
          <button
            onClick={() => setFeedOpen(v => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${feedOpen ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}
          >
            {feedOpen ? <PanelLeftClose size={13}/> : <PanelLeftOpen size={13}/>}
            {feedOpen ? 'Hide feed' : `Live feed ${feed.length > 0 ? `(${feed.length})` : ''}`}
          </button>

          <div className="w-px h-5 bg-[var(--color-surface-rule)]" />

          {/* Tabs */}
          <div className="flex items-center gap-0.5">
            <TabBtn label="Research" icon={<Beaker size={13}/>} active={tab === 'research'} onClick={() => setTab('research')} />
            {canSeeSales && (
              <TabBtn label="Sales Intelligence" icon={<TrendingUp size={13}/>} active={tab === 'sales'} onClick={() => { setTab('sales'); triggerPreGen() }} />
            )}
          </div>

          {/* Right side — session controls */}
          <div className="ml-auto flex items-center gap-2">
            {tab === 'research' && (
              <>
                <BtnGhost onClick={() => { setRActiveId(null); setRQuery('') }} icon={<Plus size={12}/>}>New topic</BtnGhost>
                <BtnGhost onClick={() => setRShowHistory(v => !v)} icon={<Clock size={12}/>} active={rShowHistory}>
                  History{rSessions.length > 0 ? ` (${rSessions.length})` : ''}
                </BtnGhost>
              </>
            )}
            {tab === 'sales' && (
              <>
                <BtnGhost onClick={() => { setSActiveId(null); setSQuery('') }} icon={<Plus size={12}/>}>New chat</BtnGhost>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">

          {/* ══ RESEARCH TAB ══════════════════════════════════════════════ */}
          {tab === 'research' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* History overlay */}
              {rShowHistory && (
                <div className="absolute inset-0 z-30 bg-white flex flex-col" style={{ top: 52 }}>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-surface-rule)]">
                    <div>
                      <p className="font-semibold text-[var(--color-text)]">Research history</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Stored locally on this device — never synced to any server</p>
                    </div>
                    <button onClick={() => setRShowHistory(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-3 py-1.5 rounded border border-[var(--color-surface-rule)] transition-colors">Close</button>
                  </div>
                  {rSessions.length === 0
                    ? <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center"><Clock size={28} className="text-[var(--color-text-faint)]"/><p className="text-sm text-[var(--color-text-muted)]">No research sessions yet</p></div>
                    : <div className="flex-1 overflow-y-auto p-4 space-y-1.5 max-w-2xl mx-auto w-full">
                        {rSessions.map(s => (
                          <div key={s.id} onClick={() => { setRActiveId(s.id); setRShowHistory(false) }}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-surface-rule)] bg-white hover:border-[var(--color-accent-light)] hover:bg-[var(--color-accent-bg)] cursor-pointer transition-all group">
                            <div className="w-7 h-7 rounded-lg bg-[var(--color-accent-bg)] flex items-center justify-center shrink-0">
                              <Hash size={12} className="text-[var(--color-accent)]"/>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--color-text)] truncate">{s.topic}</p>
                              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{s.messages.filter(m=>m.role==='user').length} queries · {fmtRel(s.updatedAt)}</p>
                            </div>
                            <button onClick={e => deleteR(s.id, e)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-faint)] hover:text-red-500 transition-all">
                              <Trash2 size={12}/>
                            </button>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-3xl mx-auto w-full">
                {!rActive ? (
                  <EmptyResearch onSuggestion={handleResearchQuery} />
                ) : (
                  rActive.messages.map(m => (
                    <ResearchBubble key={m.id} msg={m} streaming={m.id === rStreamId} />
                  ))
                )}
                <div ref={rBottom}/>
              </div>

              {/* Input */}
              <div className="shrink-0 px-6 pb-5 max-w-3xl mx-auto w-full">
                <ChatInput
                  taRef={rTa}
                  value={rQuery}
                  onChange={setRQuery}
                  onSend={handleResearchQuery}
                  onStop={() => rAbort.current?.abort()}
                  processing={rProcessing}
                  placeholder={rActive ? 'Follow-up question…' : 'Ask the research engine anything about rooibos markets, exports, or manufacturing…'}
                  hint="Local model via Ollama · history stored on this device only"
                />
              </div>
            </div>
          )}

          {/* ══ SALES TAB ══════════════════════════════════════════════════ */}
          {tab === 'sales' && (
            <div className="flex flex-1 overflow-hidden">

              {/* Sales left nav */}
              <div className="flex flex-col shrink-0 border-r border-[var(--color-surface-rule)] bg-white overflow-y-auto" style={{ width: 210 }}>
                <div className="px-3 pt-4 pb-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-text-faint)] px-2 mb-1">Intelligence</p>
                </div>
                {SALES_NAV.map(n => (
                  <button
                    key={n.key}
                    onClick={() => setSNav(n.key)}
                    className={`flex items-center gap-2.5 w-full text-left px-4 py-2.5 text-sm transition-colors relative ${
                      sNav === n.key
                        ? 'text-[var(--color-accent)] bg-[var(--color-accent-bg)] font-medium'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {sNav === n.key && <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-[var(--color-accent)] rounded-r"/>}
                    <span className={sNav === n.key ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-faint)]'}>{n.icon}</span>
                    {n.label}
                    {n.badge && (
                      <span className="ml-auto text-[10px] font-mono bg-[var(--color-warn-bg)] text-[var(--color-warn)] rounded-full px-1.5 py-0.5">{n.badge}</span>
                    )}
                  </button>
                ))}

                {/* Japan relationship note */}
                <div className="mx-3 mt-auto mb-4 p-3 rounded-lg bg-[var(--color-accent-bg)] border border-[var(--color-accent-light)]/20">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-1.5">🇯🇵 Japan Strategy</p>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">Active relationship. Use the agent to find ways to grow volume, introduce rosehip blends, or open new channels in Japan.</p>
                </div>
              </div>

              {/* Sales main content */}
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="max-w-3xl mx-auto space-y-6">

                    {/* Pre-generation status */}
                    {preGenStatus === 'running' && (
                      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[var(--color-info-bg)] border border-[var(--color-info)]/15">
                        <Spin/>
                        <p className="text-sm text-[var(--color-info)]">Preparing your intelligence briefings in the background — content will appear as it's ready…</p>
                      </div>
                    )}

                    {/* Usage warning banner */}
                    {usageMeta && (usageMeta.nearingLimit || usageMeta.limitReached) && (
                      <UsageBanner
                        usageToday={usageMeta.usageToday}
                        dailyLimit={usageMeta.dailyLimit}
                        limitReached={usageMeta.limitReached}
                        searchUrl={usageMeta.searchUrl}
                      />
                    )}

                    {/* ─ Briefing ─ */}
                    {sNav === 'briefing' && (
                      <>
                        <SectionHeader
                          title="Market Briefing"
                          desc="Your daily intelligence snapshot. Generates a structured briefing covering the top global opportunities for CNTP right now, risks to watch, a Japan relationship update, a concrete action for this week, and one competitor move to be aware of. Regenerate any time — results are cached for 24 hours to save API calls."
                        >
                          <BtnGhost onClick={() => callSales('risk', {}, 'risk')} loading={salesLoad['risk']}>Risk scan only</BtnGhost>
                          <BtnAccent onClick={() => callSales('briefing', {}, 'briefing')} loading={salesLoad['briefing']}>Generate briefing</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Click Generate briefing for a full market snapshot',
                          'Click Risk scan only for a focused risk and mitigation view',
                          'Use the agent below to drill into any specific point from the briefing',
                          'Briefings are cached — regenerate when you need a fresh view',
                        ]}/>

                        <div className="grid grid-cols-4 gap-3">
                          <KPICard label="Export volume" value="18.2k" unit="t/yr" delta="+3.4%" up />
                          <KPICard label="Active markets" value="34" delta="Stable" />
                          <KPICard label="Threat level" value="Medium" delta="Comps +2" warn />
                          <KPICard label="Opportunity" value="High" delta="DACH · Korea" up />
                        </div>

                        <OutputCard
                          title="Intelligence Briefing"
                          content={salesOut['briefing'] || salesOut['risk']}
                          loading={salesLoad['briefing'] || salesLoad['risk']}
                          placeholder="Click Generate briefing above to get your market intelligence snapshot. The briefing covers opportunities, risks, Japan strategy, your action for this week, and competitor alerts."
                        />
                      </>
                    )}

                    {/* ─ Scout ─ */}
                    {sNav === 'scout' && (
                      <>
                        <SectionHeader title="Frontier Scout" desc="Ranks global markets by opportunity score for CNTP bulk rooibos exports. Click any market card to get a full entry intelligence report — who to contact, what to offer, certifications needed, trade shows to attend, and your first concrete action. Scores update when you run a fresh scout.">
                          <BtnGhost onClick={() => scoutMarkets('emerging')} loading={salesLoad['scout:emerging']}>Emerging markets</BtnGhost>
                          <BtnGhost onClick={() => scoutMarkets('highmargin')} loading={salesLoad['scout:highmargin']}>High-margin only</BtnGhost>
                          <BtnAccent onClick={() => scoutMarkets('all')} loading={salesLoad['scout:all']}>Scout all markets</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Click Scout all markets to rank global opportunities by score',
                          'Use Emerging markets to find low-competition frontier targets',
                          'Use High-margin only to focus on premium buyers willing to pay more',
                          'Click any market card to load a full entry intelligence report',
                          'Entry reports include: contacts, pricing, certifications, trade shows, first action',
                        ]}/>

                        <div className="grid grid-cols-2 gap-3">
                          {markets.map(m => (
                            <button
                              key={m.country}
                              onClick={() => { setSelMarket(m.country); callSales('market_entry', { country: m.country }, `mkt:${m.country}`) }}
                              className={`text-left p-4 rounded-xl border transition-all ${selMarket === m.country ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)]' : 'border-[var(--color-surface-rule)] bg-white hover:border-[var(--color-accent-light)] hover:bg-[var(--color-surface)]'}`}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{m.flag}</span>
                                    <span className="font-semibold text-[var(--color-text)]">{m.country}</span>
                                  </div>
                                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{m.region}</p>
                                </div>
                                <ScoreChip score={m.score} />
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 rounded-full bg-[var(--color-surface-rule)] overflow-hidden">
                                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${m.score}%` }}/>
                                </div>
                                <TagChip tag={m.tag}/>
                              </div>
                            </button>
                          ))}
                        </div>

                        {selMarket && (
                          <OutputCard
                            title={`${selMarket} — Entry intelligence`}
                            content={salesOut[`mkt:${selMarket}`]}
                            loading={salesLoad[`mkt:${selMarket}`]}
                          />
                        )}
                      </>
                    )}

                    {/* ─ Competitors ─ */}
                    {sNav === 'competitors' && (
                      <>
                        <SectionHeader title="Competitor Intelligence" desc="Analyses your four main South African rooibos export competitors. Run scan for a full breakdown of their strengths, weaknesses, key markets, and exactly how CNTP can outflank each one. Find their gaps surfaces underserved markets, pricing gaps, and certification advantages CNTP can exploit right now.">
                          <BtnGhost onClick={() => callSales('competitor_gaps', {}, 'comp_gaps')} loading={salesLoad['comp_gaps']}>Find their gaps</BtnGhost>
                          <BtnAccent onClick={() => callSales('competitor_scan', {}, 'competitors')} loading={salesLoad['competitors']}>Run full scan</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Run full scan for a complete competitor breakdown with outflanking strategies',
                          'Find their gaps shows you where competitors are weak and how to exploit it',
                          'Use the agent below to ask specific questions like "how do we beat Rooibos Ltd in Germany?"',
                        ]}/>

                        <div className="bg-white rounded-xl border border-[var(--color-surface-rule)] overflow-hidden">
                          {COMPETITORS.map((c, i) => (
                            <div key={c.rank} className={`flex items-center gap-4 px-5 py-3.5 ${i < COMPETITORS.length - 1 ? 'border-b border-[var(--color-surface-rule)]' : ''}`}>
                              <span className="text-xs font-mono text-[var(--color-text-faint)] w-5 shrink-0">#{c.rank}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--color-text)]">{c.name}</p>
                                <p className="text-xs text-[var(--color-text-muted)]">{c.detail}</p>
                              </div>
                              <ThreatBadge level={c.threat}/>
                            </div>
                          ))}
                        </div>

                        <OutputCard
                          content={salesOut['competitors'] || salesOut['comp_gaps']}
                          loading={salesLoad['competitors'] || salesLoad['comp_gaps']}
                          placeholder="Run a competitor scan to see strategic intelligence"
                        />
                      </>
                    )}

                    {/* ─ Relationships ─ */}
                    {sNav === 'relationships' && (
                      <>
                        <SectionHeader title="Relationship Pilot" desc="Three tools to help you build and win deals. Partnership strategy gives you the top partnership types for CNTP with ideal partner profiles and how to approach them. Objection cards gives you the 8 most common buyer objections with exact counter-scripts. Who to contact gives you specific job titles, company types, LinkedIn search strings, and trade events per market.">
                          <BtnGhost onClick={() => callSales('objections', {}, 'objections')} loading={salesLoad['objections']}>Objection cards</BtnGhost>
                          <BtnGhost onClick={() => callSales('contacts', {}, 'contacts')} loading={salesLoad['contacts']}>Who to contact</BtnGhost>
                          <BtnAccent onClick={() => callSales('partnerships', {}, 'partnerships')} loading={salesLoad['partnerships']}>Partnership strategy</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Partnership strategy — ideal partner profiles, how to approach, deal structure and timeline',
                          'Objection cards — print or save these before a buyer call. Format: OBJECTION → COUNTER-SCRIPT',
                          'Who to contact — specific job titles and LinkedIn search strings per market',
                          'Use the agent below for market-specific versions e.g. "partnership strategy for South Korea"',
                        ]}/>

                        <OutputCard
                          title={salesOut['partnerships'] ? 'Partnership Strategy' : salesOut['objections'] ? 'Objection Battlecards' : salesOut['contacts'] ? 'Who To Contact' : undefined}
                          content={salesOut['partnerships'] || salesOut['objections'] || salesOut['contacts']}
                          loading={salesLoad['partnerships'] || salesLoad['objections'] || salesLoad['contacts']}
                          placeholder="Choose an option above. Partnership strategy gives you partner profiles and deal structures. Objection cards gives you counter-scripts for the 8 most common buyer pushbacks. Who to contact gives you specific names, titles, and LinkedIn strings."
                        />
                      </>
                    )}

                    {/* ─ Files ─ */}
                    {sNav === 'files' && (
                      <>
                        <SectionHeader
                          title="File Intelligence"
                          desc="Upload any market report, trade document, price list, competitor brochure, or industry PDF. Gemini reads the content and extracts what matters for CNTP — key facts, companies, pricing signals, certifications, competitive intelligence, and immediate sales actions. Text files (TXT, CSV, DOCX) are fully readable. PDFs are analysed by filename and context."
                        />

                        <HowToUse steps={[
                          'Upload a competitor brochure to extract their pricing and product positioning',
                          'Upload a market report to get CNTP-specific opportunities pulled out instantly',
                          'Upload a trade show exhibitor list to find potential buyers and partners',
                          'Upload a price list or tender document to get negotiation intelligence',
                          'TXT, CSV, DOCX files give the best results — full text is read by Gemini',
                          'PDFs: Gemini uses the filename and document structure for context',
                        ]}/>

                        <div
                          onClick={() => fileInput.current?.click()}
                          onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)' }}
                          onDragLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '' }}
                          onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = ''; handleFiles(e.dataTransfer.files) }}
                          className="border-2 border-dashed border-[var(--color-surface-rule)] rounded-xl p-10 text-center cursor-pointer hover:border-[var(--color-accent-light)] hover:bg-[var(--color-accent-bg)] transition-all"
                        >
                          <Upload size={20} className="text-[var(--color-text-faint)] mx-auto mb-3"/>
                          <p className="text-sm font-medium text-[var(--color-text-muted)]">Drop documents here or click to upload</p>
                          <p className="text-xs text-[var(--color-text-faint)] mt-1 mb-1">TXT · CSV · DOCX · XLSX · PDF</p>
                          <p className="text-[11px] text-[var(--color-text-faint)]">Best results with text-based files · PDFs analysed by filename and context</p>
                        </div>
                        <input ref={fileInput} type="file" multiple accept=".pdf,.docx,.txt,.csv,.xlsx" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)}/>

                        {files.length > 0 && (
                          <div className="space-y-2">
                            {files.map((f, i) => (
                              <div key={i}>
                                <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg border border-[var(--color-surface-rule)]">
                                  <FileText size={14} className="text-[var(--color-accent)] shrink-0"/>
                                  <span className="flex-1 text-sm text-[var(--color-text)] truncate font-medium">{f.name}</span>
                                  <span className="text-xs text-[var(--color-text-faint)] font-mono">{(f.size/1024).toFixed(1)}KB</span>
                                  {salesLoad[`file:${f.name}`] && <Spin/>}
                                  <button onClick={() => setFiles(p => p.filter((_,idx)=>idx!==i))} className="text-[var(--color-text-faint)] hover:text-red-500 transition-colors"><X size={13}/></button>
                                </div>
                                {salesOut[`file:${f.name}`] && (
                                  <OutputCard
                                    title={`Intelligence extract — ${f.name}`}
                                    content={salesOut[`file:${f.name}`]}
                                    loading={false}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* ─ Reports ─ */}
                    {sNav === 'reports' && (
                      <>
                        <SectionHeader title="Report Builder" desc="Generates structured, print-ready intelligence reports for internal use, management presentations, or pre-call preparation. Each report is generated fresh by Gemini and saved to your account.">
                          <BtnGhost onClick={() => callSales('report', { reportType: 'country' }, 'report:country')} loading={salesLoad['report:country']}>Country entry</BtnGhost>
                          <BtnGhost onClick={() => callSales('report', { reportType: 'competitive' }, 'report:competitive')} loading={salesLoad['report:competitive']}>Competitive</BtnGhost>
                          <BtnGhost onClick={() => callSales('report', { reportType: 'partnership' }, 'report:partnership')} loading={salesLoad['report:partnership']}>Partnership</BtnGhost>
                          <BtnAccent onClick={() => callSales('report', { reportType: 'full' }, 'report:full')} loading={salesLoad['report:full']}>Full report</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Full report — complete export strategy: top 5 markets, competitive analysis, pricing, partnerships, 90-day action plan',
                          'Country entry — detailed entry reports for the top 3 frontier markets including regulatory requirements and first steps',
                          'Competitive — market map, competitor profiles, market share estimates, strategy to gain share in 2 new markets within 18 months',
                          'Partnership — 8 ideal partnership targets globally, approach strategy, deal structure, and relationship maintenance cadence',
                          'Reports are saved to your account and can be reviewed later in history',
                        ]}/>

                        <OutputCard
                          title={
                            salesOut['report:full'] ? 'Full Export Strategy Report' :
                            salesOut['report:country'] ? 'Country Entry Report' :
                            salesOut['report:competitive'] ? 'Competitive Landscape Report' :
                            salesOut['report:partnership'] ? 'Partnership Roadmap' : undefined
                          }
                          content={salesOut['report:full'] || salesOut['report:country'] || salesOut['report:competitive'] || salesOut['report:partnership']}
                          loading={salesLoad['report:full'] || salesLoad['report:country'] || salesLoad['report:competitive'] || salesLoad['report:partnership']}
                          placeholder="Select a report type above. Full report gives you a complete 90-day export strategy. Country entry gives detailed entry plans for the top 3 markets. Competitive maps the landscape and gives you a plan to gain share. Partnership gives you 8 target partnerships with approach scripts."
                        />
                      </>
                    )}

                    {/* ─ Alerts ─ */}
                    {sNav === 'alerts' && (
                      <>
                        <SectionHeader title="Alerts & Signals" desc="Live market intelligence alerts. The static alerts below are seeded from known signals. Click Refresh signals to ask Gemini to generate 5 fresh alerts based on current rooibos export market conditions — competitor moves, demand signals, regulatory changes, and time-sensitive opportunity windows.">
                          <BtnAccent onClick={() => callSales('alerts', {}, 'alerts')} loading={salesLoad['alerts']}>Refresh signals</BtnAccent>
                        </SectionHeader>

                        <HowToUse steps={[
                          'Static alerts below are your known baseline signals',
                          'Click Refresh signals to get 5 fresh AI-generated alerts on current market conditions',
                          'Use the agent below to investigate any alert further — ask for more detail or an action plan',
                          'Connect gather.py to pull live news signals into the feed on the left',
                        ]}/>

                        <div className="space-y-2">
                          {dbAlerts.map((a, i) => <AlertCard key={i} type={a.type} title={a.title} body={a.body}/>)}
                        </div>
                        {salesOut['alerts'] && <OutputCard title="Fresh intelligence signals" content={salesOut['alerts']}/>}
                      </>
                    )}

                  </div>
                </div>

                {/* Sales agent chat — anchored at bottom */}
                <div className="shrink-0 border-t border-[var(--color-surface-rule)] bg-white">
                  <div className="max-w-3xl mx-auto">
                    {/* Chat messages */}
                    {sActive && (
                      <div className="max-h-52 overflow-y-auto px-5 pt-4 space-y-3">
                        {sActive.messages.map(m => (
                          <SalesBubble key={m.id} msg={m} streaming={m.id === sStreamId}/>
                        ))}
                        <div ref={sBottom}/>
                      </div>
                    )}
                    {!sActive && (
                      <div className="px-5 pt-3 flex gap-2 flex-wrap">
                        {QUICK_QUERIES.map(q => (
                          <button key={q} onClick={() => handleSalesQuery(q)}
                            className="text-xs text-[var(--color-text-muted)] border border-[var(--color-surface-rule)] rounded-full px-3 py-1 hover:border-[var(--color-accent-light)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] transition-all">
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                    <ChatInput
                      taRef={sTa}
                      value={sQuery}
                      onChange={setSQuery}
                      onSend={handleSalesQuery}
                      onStop={() => setSProcessing(false)}
                      processing={sProcessing}
                      placeholder="Ask the Sales Intelligence Agent — markets, strategy, contacts, competitive moves…"
                      hint="Powered by Gemini · prescriptive answers only · no questions back"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — all using design system tokens
// ─────────────────────────────────────────────────────────────────────────────

function TabBtn({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${active ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'}`}>
      {icon}{label}
    </button>
  )
}

function BtnGhost({ children, onClick, icon, active, loading }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; active?: boolean; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${active ? 'bg-[var(--color-surface)] border-[var(--color-surface-rule)] text-[var(--color-text)]' : 'border-[var(--color-surface-rule)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-faint)]'}`}>
      {loading ? <Spin/> : icon}{children}
    </button>
  )
}

function BtnAccent({ children, onClick, loading }: { children: React.ReactNode; onClick: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] transition-colors disabled:opacity-50">
      {loading ? <Spin light/> : null}{children}
    </button>
  )
}

function SectionHeader({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-lg text-[var(--color-text)]">{title}</h2>
        {desc && <p className="text-sm text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 mt-0.5">{children}</div>}
    </div>
  )
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0

  const parseInline = (line: string): React.ReactNode => {
    // Handle **bold**, *italic*, and plain text inline
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={idx} className="font-semibold text-[var(--color-text)]">{part.slice(2,-2)}</strong>
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={idx} className="text-[var(--color-text-muted)]">{part.slice(1,-1)}</em>
      return part
    })
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { nodes.push(<div key={i} className="h-2"/>); i++; continue }

    // H1 # or H2 ##
    if (trimmed.startsWith('### ')) {
      nodes.push(<p key={i} className="text-[11px] font-mono font-semibold uppercase tracking-widest text-[var(--color-text-faint)] mt-4 mb-1.5 first:mt-0">{trimmed.slice(4)}</p>)
      i++; continue
    }
    if (trimmed.startsWith('## ')) {
      nodes.push(<p key={i} className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-4 mb-1.5 first:mt-0 border-b border-[var(--color-surface-rule)] pb-1">{trimmed.slice(3)}</p>)
      i++; continue
    }
    if (trimmed.startsWith('# ')) {
      nodes.push(<p key={i} className="font-display font-semibold text-base text-[var(--color-text)] mt-4 mb-2 first:mt-0">{trimmed.slice(2)}</p>)
      i++; continue
    }

    // Bold-only line used as section header e.g. **SECTION:**
    if (trimmed.startsWith('**') && (trimmed.endsWith('**') || trimmed.endsWith('**:'))) {
      const label = trimmed.replace(/\*\*/g, '').replace(/:$/, '')
      nodes.push(<p key={i} className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-4 mb-1.5 first:mt-0">{label}</p>)
      i++; continue
    }

    // Numbered points 1. 2. 3.
    const numMatch = trimmed.match(/^(\d+)\.\s+\*?\*?([^*]+)\*?\*?:?\s*(.*)/)
    if (numMatch) {
      const sectionLabels: Record<string, string> = {
        '1': 'Top Opportunities', '2': 'Risks to Watch',
        '3': 'Japan Strategy', '4': "This Week's Action", '5': 'Competitor Alert'
      }
      const label = sectionLabels[numMatch[1]] ?? `Point ${numMatch[1]}`
      const heading = numMatch[2]?.replace(/\*\*/g, '').trim()
      const rest = numMatch[3]
      nodes.push(
        <div key={i} className="mt-4 first:mt-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-5 h-5 rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent)] text-[10px] font-mono font-semibold flex items-center justify-center shrink-0">{numMatch[1]}</span>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{heading || label}</p>
          </div>
          {rest && <p className="text-sm text-[var(--color-text)] leading-relaxed ml-7">{parseInline(rest)}</p>}
        </div>
      )
      i++; continue
    }

    // Bullet points * or -
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      nodes.push(
        <div key={i} className="flex gap-2.5 ml-2 mb-1">
          <span className="text-[var(--color-accent)] mt-1.5 shrink-0" style={{fontSize:7}}>▸</span>
          <p className="text-sm text-[var(--color-text)] leading-relaxed">{parseInline(trimmed.slice(2))}</p>
        </div>
      )
      i++; continue
    }

    // Regular paragraph
    nodes.push(<p key={i} className="text-sm text-[var(--color-text)] leading-relaxed mb-1">{parseInline(trimmed)}</p>)
    i++
  }

  return nodes
}

function OutputCard({ title, content, loading, placeholder }: { title?: string; content?: string; loading?: boolean; placeholder?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[var(--color-surface-rule)] overflow-hidden">
      {title && (
        <div className="px-5 py-3 border-b border-[var(--color-surface-rule)] flex items-center justify-between">
          <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        </div>
      )}
      <div className="px-5 py-4">
        {loading
          ? <div className="flex items-center gap-2.5 py-2 text-sm text-[var(--color-text-muted)]"><Spin/> Generating intelligence…</div>
          : content
            ? <div className="space-y-0.5">{renderMarkdown(content)}</div>
            : <p className="text-sm text-[var(--color-text-faint)] py-1">{placeholder ?? '—'}</p>
        }
      </div>
    </div>
  )
}

function KPICard({ label, value, unit, delta, up, warn }: { label: string; value: string; unit?: string; delta?: string; up?: boolean; warn?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-[var(--color-surface-rule)] px-4 py-3.5">
      <p className="text-[11px] text-[var(--color-text-muted)] font-medium mb-1">{label}</p>
      <p className={`font-display font-bold text-xl ${warn ? 'text-[var(--color-warn)]' : up ? 'text-[var(--color-ok)]' : 'text-[var(--color-text)]'}`}>
        {value}<span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">{unit}</span>
      </p>
      {delta && <p className={`text-[11px] mt-0.5 ${up ? 'text-[var(--color-ok)]' : 'text-[var(--color-text-muted)]'}`}>{delta}</p>}
    </div>
  )
}

function ScoreChip({ score }: { score: number }) {
  const color = score >= 80 ? 'text-[var(--color-ok)] bg-[var(--color-ok-bg)]' : score >= 70 ? 'text-[var(--color-warn)] bg-[var(--color-warn-bg)]' : 'text-[var(--color-text-muted)] bg-[var(--color-surface)]'
  return <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${color}`}>{score}</span>
}

function TagChip({ tag }: { tag: string }) {
  const styles: Record<string, string> = {
    Priority: 'badge badge-ok', Hot: 'badge badge-ok', Rising: 'badge badge-info',
    Stable: 'badge badge-gray', Frontier: 'badge badge-warn',
  }
  return <span className={styles[tag] ?? 'badge badge-gray'}>{tag}</span>
}

function ThreatBadge({ level }: { level: string }) {
  return <span className={`badge ${level === 'High' ? 'badge-err' : level === 'Medium' ? 'badge-warn' : 'badge-ok'}`}>{level}</span>
}

function AlertCard({ type, title, body }: { type: string; title: string; body: string }) {
  const s = type === 'warn' ? { cls: 'bg-[var(--color-warn-bg)] border-[var(--color-warn)]/20', Icon: AlertTriangle, ic: 'text-[var(--color-warn)]' }
          : type === 'info' ? { cls: 'bg-[var(--color-info-bg)] border-[var(--color-info)]/20', Icon: Info,           ic: 'text-[var(--color-info)]' }
                            : { cls: 'bg-[var(--color-ok-bg)] border-[var(--color-ok)]/20',   Icon: CheckCircle,    ic: 'text-[var(--color-ok)]'   }
  return (
    <div className={`flex gap-3 p-4 rounded-xl border ${s.cls}`}>
      <s.Icon size={15} className={`${s.ic} shrink-0 mt-0.5`}/>
      <p className="text-sm text-[var(--color-text)]"><strong className="font-semibold">{title}: </strong>{body}</p>
    </div>
  )
}

function FeedIcon({ platform }: { platform: string }) {
  const p = platform?.toLowerCase()
  const Icon = p === 'reddit' ? MessageSquare : p === 'news' ? Newspaper : p === 'instagram' || p === 'tiktok' ? Camera : Zap
  return <Icon size={10} className="text-[var(--color-text-faint)] shrink-0"/>
}

function EmptyResearch({ onSuggestion }: { onSuggestion: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent-bg)] border border-[var(--color-accent-light)]/30 flex items-center justify-center mb-5">
        <Beaker size={22} className="text-[var(--color-accent)]"/>
      </div>
      <h2 className="font-display font-semibold text-base text-[var(--color-text)] mb-1">Research Engine</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-1.5 max-w-sm leading-relaxed">
        Ask anything about rooibos markets, export trends, rosehip demand, or manufacturing data.
      </p>
      <p className="text-xs text-[var(--color-text-faint)] mb-8">
        Local model via Ollama · history stored on this device only
      </p>
      <div className="w-full max-w-sm space-y-2">
        {RESEARCH_SUGGESTIONS.map((s, i) => (
          <button key={i} onClick={() => onSuggestion(s.query)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl border border-[var(--color-surface-rule)] bg-white hover:border-[var(--color-accent-light)] hover:bg-[var(--color-accent-bg)] transition-all group">
            <span className="flex-1 text-sm text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">{s.label}</span>
            <ChevronRight size={13} className="text-[var(--color-text-faint)] group-hover:text-[var(--color-accent)] shrink-0"/>
          </button>
        ))}
      </div>
    </div>
  )
}

function FormattedResponse({ text }: { text: string }) {
  // Parse the structured response into sections
  const lines = text.split('\n').filter(l => l.trim())
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    const trimmed = line.trim()

    // Numbered points like "1." "2." "3."
    const numberedMatch = trimmed.match(/^(\d+)[\.\):]\s*(.+)/)
    if (numberedMatch) {
      const labels: Record<string, string> = { '1': 'Summary', '2': 'Implications', '3': 'Next step' }
      const num = numberedMatch[1]
      const rest = numberedMatch[2]
      elements.push(
        <div key={i} className="mb-3 last:mb-0">
          <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">
            {labels[num] ?? `Point ${num}`}
          </p>
          <p className="text-sm text-[var(--color-text)] leading-relaxed">{rest}</p>
        </div>
      )
      return
    }

    // Bullet points
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      elements.push(
        <div key={i} className="flex gap-2 mb-1.5">
          <span className="text-[var(--color-accent)] mt-1 shrink-0 text-xs">▸</span>
          <p className="text-sm text-[var(--color-text)] leading-relaxed">{trimmed.replace(/^[•\-\*]\s*/, '')}</p>
        </div>
      )
      return
    }

    // Bold headers (markdown-style **text**)
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      elements.push(
        <p key={i} className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-3 mb-1 first:mt-0">
          {trimmed.replace(/\*\*/g, '')}
        </p>
      )
      return
    }

    // Regular paragraph
    if (trimmed) {
      elements.push(
        <p key={i} className="text-sm text-[var(--color-text)] leading-relaxed mb-2 last:mb-0">
          {trimmed}
        </p>
      )
    }
  })

  return <>{elements}</>
}

function ResearchBubble({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  if (msg.role === 'user') return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-[var(--color-brand)] text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed">
        {msg.content}
      </div>
    </div>
  )

  // Derive short model label
  const modelLabel = msg.model
    ? msg.model.replace(':latest', '')
    : 'Ollama'

  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-[var(--color-accent-bg)] border border-[var(--color-accent-light)]/30 flex items-center justify-center shrink-0 mt-0.5">
        <Cpu size={14} className="text-[var(--color-accent)]"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-[var(--color-surface-rule)] px-5 py-4 rounded-2xl rounded-tl-sm shadow-[var(--shadow-card)]">
          {!msg.content ? (
            <div className="flex items-center gap-1 py-1">
              {[0,150,300].map(d => <div key={d} className="w-2 h-2 rounded-full bg-[var(--color-surface-rule)] animate-bounce" style={{animationDelay:`${d}ms`}}/>)}
            </div>
          ) : (
            <>
              <FormattedResponse text={msg.content} />
              {streaming && <span className="inline-block w-1.5 h-4 bg-[var(--color-accent)] ml-0.5 animate-pulse align-middle rounded-sm"/>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5 ml-1">
          <p className="text-[11px] text-[var(--color-text-faint)]">Research Director</p>
          <span className="text-[var(--color-text-faint)] text-[10px]">·</span>
          <span className="text-[10px] font-mono bg-[var(--color-surface)] border border-[var(--color-surface-rule)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded">
            {modelLabel}
          </span>
        </div>
      </div>
    </div>
  )
}

function SalesBubble({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  if (msg.role === 'user') return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-[var(--color-brand)] text-white px-3.5 py-2.5 rounded-xl rounded-tr-sm text-sm leading-relaxed">
        {msg.content}
      </div>
    </div>
  )
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-[var(--color-accent-bg)] flex items-center justify-center shrink-0 mt-0.5">
        <TrendingUp size={12} className="text-[var(--color-accent)]"/>
      </div>
      <div className="flex-1 bg-[var(--color-surface)] border border-[var(--color-surface-rule)] px-3.5 py-2.5 rounded-xl rounded-tl-sm">
        {msg.content
          ? <p className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--color-text)]">{msg.content}{streaming && <span className="inline-block w-1.5 h-3.5 bg-[var(--color-accent)] ml-0.5 animate-pulse align-middle rounded-sm"/>}</p>
          : <div className="flex items-center gap-1">{[0,150,300].map(d=><div key={d} className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-bounce" style={{animationDelay:`${d}ms`}}/>)}</div>
        }
      </div>
    </div>
  )
}

function ChatInput({ taRef, value, onChange, onSend, onStop, processing, placeholder, hint }: {
  taRef: React.RefObject<HTMLTextAreaElement | null>
  value: string; onChange: (v: string) => void
  onSend: (v: string) => void; onStop: () => void
  processing: boolean; placeholder: string; hint?: string
}) {
  return (
    <div className="p-4">
      <div className={`flex items-end gap-3 bg-white border rounded-xl px-4 py-3 shadow-[var(--shadow-card)] transition-colors focus-within:border-[var(--color-accent-light)]`} style={{ borderColor: 'var(--color-surface-rule)' }}>
        <textarea
          ref={taRef} value={value} rows={1} disabled={processing} placeholder={placeholder}
          className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] resize-none outline-none leading-relaxed max-h-36 bg-transparent"
          onChange={e => { onChange(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px' }}
          onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); onSend(value) } }}
        />
        {processing
          ? <button onClick={onStop} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors shrink-0"><Square size={12} className="fill-current"/></button>
          : <button onClick={() => onSend(value)} disabled={!value.trim()} className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] disabled:opacity-30 transition-all shrink-0"><Send size={13}/></button>
        }
      </div>
      {hint && <p className="text-center text-[11px] text-[var(--color-text-faint)] mt-2">{hint} · <kbd className="font-mono text-[10px] bg-[var(--color-surface)] border border-[var(--color-surface-rule)] rounded px-1">Enter</kbd> to send</p>}
    </div>
  )
}

function Spin({ light }: { light?: boolean }) {
  return <div className={`w-3 h-3 rounded-full border-2 animate-spin shrink-0 ${light ? 'border-white/30 border-t-white' : 'border-[var(--color-surface-rule)] border-t-[var(--color-accent)]'}`}/>
}

function HowToUse({ steps }: { steps: string[] }) {
  return (
    <div className="bg-[var(--color-info-bg)] border border-[var(--color-info)]/15 rounded-xl px-5 py-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Info size={13} className="text-[var(--color-info)] shrink-0"/>
        <p className="text-xs font-semibold text-[var(--color-info)] uppercase tracking-wider">How to use this</p>
      </div>
      <ul className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-xs text-[var(--color-text-muted)] leading-relaxed">
            <span className="text-[var(--color-info)] shrink-0 mt-0.5 font-mono">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}

function UsageBanner({ usageToday, dailyLimit, limitReached, searchUrl }: {
  usageToday:   number
  dailyLimit:   number
  limitReached: boolean
  searchUrl?:   string
}) {
  const pct       = Math.round((usageToday / dailyLimit) * 100)
  const remaining = dailyLimit - usageToday

  if (limitReached) {
    return (
      <div className="rounded-xl border border-[var(--color-err)]/20 bg-[var(--color-err-bg)] p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-err)]/10 flex items-center justify-center shrink-0">
            <AlertTriangle size={15} className="text-[var(--color-err)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-err)] mb-0.5">
              Daily limit reached — {usageToday}/{dailyLimit} queries used
            </p>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mb-3">
              The intelligence engine resets at midnight. Until then, use your browser to continue researching.
            </p>
            {searchUrl && (
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-hover)] transition-colors"
              >
                <ExternalLink size={11} />
                Search in browser
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-warn)]/10 flex items-center justify-center shrink-0">
          <AlertTriangle size={15} className="text-[var(--color-warn)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-warn)] mb-0.5">
            Approaching daily limit — {remaining} {remaining === 1 ? 'query' : 'queries'} remaining
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1.5 rounded-full bg-[var(--color-warn)]/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-warn)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-[var(--color-warn)] shrink-0">{pct}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}