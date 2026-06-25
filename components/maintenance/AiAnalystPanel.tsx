'use client'

// components/maintenance/AiAnalystPanel.tsx
// Gemini-powered maintenance analyst. Sends a compact aggregate blob (not raw
// rows) to /api/maintenance/insights for a structured narrative, caches the
// daily result in sessionStorage, and offers a follow-up chat over the data.

import { useState, useEffect } from 'react'
import { Sparkles, RefreshCw, Send, Loader2 } from 'lucide-react'

interface Highlight { type: 'positive' | 'warning' | 'critical'; title: string; detail: string }
interface Recommendation { priority: 'high' | 'medium' | 'low'; action: string; rationale: string }
interface Watch { asset: string; reason: string }
interface Insights { summary: string; highlights: Highlight[]; recommendations: Recommendation[]; watchlist: Watch[] }
type ChatMsg = { role: 'user' | 'analyst'; text: string }

interface PanelProps {
  agg: unknown
  /** Endpoint that returns { insights, model }. Defaults to the maintenance analyst. */
  insightsUrl?: string
  /** Endpoint for follow-up chat. Defaults to the maintenance analyst. */
  askUrl?: string
  /** Heading + sublabel + sessionStorage cache key, so each dashboard caches separately. */
  title?: string
  subtitle?: string
  cacheKey?: string
}

export default function AiAnalystPanel({
  agg,
  insightsUrl = '/api/maintenance/insights',
  askUrl = '/api/maintenance/ask',
  title = 'AI Maintenance Analyst',
  subtitle = 'Plain-English insights over your maintenance data',
  cacheKey = 'maint-insight',
}: PanelProps) {
  const todayKey = () => `${cacheKey}:${new Date().toISOString().slice(0, 10)}`
  const [insights, setInsights] = useState<Insights | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)

  // On mount: show today's cached insight if we have one, otherwise analyse
  // automatically — no button press needed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(todayKey())
      if (raw) { const p = JSON.parse(raw); setInsights(p.insights); setModel(p.model); return }
    } catch {}
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setLoading(true); setError('')
    try {
      const res = await fetch(insightsUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agg),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Analysis failed')
      setInsights(j.insights); setModel(j.model)
      try { sessionStorage.setItem(todayKey(), JSON.stringify({ insights: j.insights, model: j.model })) } catch {}
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  async function ask() {
    const question = q.trim()
    if (!question || asking) return
    setQ(''); setAsking(true)
    const history = [...chat]
    setChat(c => [...c, { role: 'user', text: question }])
    try {
      const res = await fetch(askUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aggregates: agg, history, question }),
      })
      const j = await res.json()
      setChat(c => [...c, { role: 'analyst', text: res.ok ? j.answer : (j.error || 'Could not answer.') }])
    } catch (e: any) {
      setChat(c => [...c, { role: 'analyst', text: 'Error: ' + e.message }])
    } finally { setAsking(false) }
  }

  const toneClass = (t: string) => t === 'critical' ? 'border-err/30 bg-err/5' : t === 'warning' ? 'border-warn/30 bg-warn/5' : 'border-ok/30 bg-ok/5'
  const prioClass = (p: string) => p === 'high' ? 'badge-err' : p === 'medium' ? 'badge-warn' : 'badge-info'

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-azure/10 text-azure"><Sparkles className="w-4 h-4" /></span>
          <div>
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            <p className="text-[11px] text-text-muted">{subtitle}{model ? ` · served by ${model}` : ''}</p>
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-60">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {insights ? 'Refresh analysis' : 'Get AI analysis'}
        </button>
      </div>

      {error && <div className="text-[12px] text-err border border-err/30 rounded-lg p-2 mb-3">{error}</div>}

      {!insights && !loading && !error && (
        <p className="text-[12px] text-text-faint">Click <strong>Get AI analysis</strong> for a summary of what to pay attention to, anomalies and recommendations.</p>
      )}

      {insights && (
        <div className="space-y-4">
          <p className="text-[13px] text-text leading-relaxed">{insights.summary}</p>

          {insights.highlights?.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {insights.highlights.map((h, i) => (
                <div key={i} className={`border rounded-lg p-3 ${toneClass(h.type)}`}>
                  <div className="text-[12px] font-semibold text-text">{h.title}</div>
                  <div className="text-[12px] text-text-muted mt-0.5">{h.detail}</div>
                </div>
              ))}
            </div>
          )}

          {insights.recommendations?.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Recommendations</div>
              <div className="space-y-2">
                {insights.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`badge ${prioClass(r.priority)} shrink-0`}>{r.priority}</span>
                    <div><span className="text-[13px] text-text font-medium">{r.action}</span><span className="text-[12px] text-text-muted"> — {r.rationale}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.watchlist?.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Watchlist</div>
              <div className="flex flex-wrap gap-2">
                {insights.watchlist.map((w, i) => (
                  <span key={i} className="badge badge-warn" title={w.reason}>{w.asset}</span>
                ))}
              </div>
            </div>
          )}

          {/* Follow-up chat */}
          <div className="border-t border-surface-rule pt-3">
            {chat.length > 0 && (
              <div className="space-y-2 mb-2 max-h-64 overflow-auto">
                {chat.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`rounded-2xl px-3 py-2 text-[12px] max-w-[85%] whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand text-white' : 'bg-surface-raised text-text'}`}>{m.text}</div>
                  </div>
                ))}
                {asking && <div className="flex justify-start"><div className="rounded-2xl px-3 py-2 bg-surface-raised text-text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /></div></div>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }}
                placeholder="Ask the analyst about your data…"
                className="flex-1 min-h-[40px] rounded-lg border border-surface-rule bg-surface-card px-3 text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <button onClick={ask} disabled={asking || !q.trim()} className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-brand text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
