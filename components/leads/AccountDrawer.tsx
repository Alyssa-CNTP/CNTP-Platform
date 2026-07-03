'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Target, Clock, Globe, ChevronRight, Plus, ExternalLink, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { classificationStyle, regionFlag, timeAgo } from '@/components/intelligence/helpers'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountStub {
  id:          string
  name:        string
  country:     string | null
  stage:       string
  sales_angle: string | null
  account_type:string | null
  tags:        string[] | null
  updated_at:  string
}

interface Interaction {
  id:               string
  interaction_type: string
  summary:          string
  sentiment:        string | null
  next_step:        string | null
  next_step_due:    string | null
  occurred_at:      string
}

interface SignalStub {
  id:              string
  title:           string
  classification:  string
  relevance_score: number
  sales_angle:     string | null
  region:          string | null
  created_at:      string
  source_url:      string | null
}

interface AccountDetail {
  account:      Record<string, unknown>
  profile:      Record<string, unknown> | null
  interactions: Interaction[]
  signals:      SignalStub[]
}

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'lead',        label: 'Lead',        color: '#6B7280' },
  { key: 'qualified',   label: 'Qualified',   color: '#3B82F6' },
  { key: 'proposal',    label: 'Proposal',    color: '#8B5CF6' },
  { key: 'negotiation', label: 'Negotiation', color: '#F59E0B' },
  { key: 'won',         label: 'Won',         color: '#22C55E' },
  { key: 'lost',        label: 'Lost',        color: '#EF4444' },
]

export function stageColor(stage: string) {
  return STAGES.find(s => s.key === stage)?.color ?? '#6B7280'
}

const INTERACTION_TYPES = ['note', 'call', 'email', 'meeting', 'demo', 'follow-up']

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  account: AccountStub | null
  onClose: () => void
  onUpdated: (id: string, patch: Partial<AccountStub>) => void
}

export default function AccountDrawer({ account, onClose, onUpdated }: Props) {
  const [detail,      setDetail]      = useState<AccountDetail | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [stageSaving, setStageSaving] = useState(false)
  const [noteText,    setNoteText]    = useState('')
  const [noteType,    setNoteType]    = useState('note')
  const [nextStep,    setNextStep]    = useState('')
  const [addingNote,  setAddingNote]  = useState(false)
  const [showNoteBox, setShowNoteBox] = useState(false)

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = account ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [account])

  // Escape to close
  useEffect(() => {
    if (!account) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [account, onClose])

  // Fetch detail when account changes
  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true)
    setDetail(null)
    try {
      const res  = await fetch(`/api/accounts/${id}`)
      const json = await res.json()
      if (res.ok) setDetail(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (account?.id) fetchDetail(account.id)
    else setDetail(null)
  }, [account?.id, fetchDetail])

  if (!account) return null

  const currentStage = (detail?.account?.stage as string) ?? account.stage

  // ── Stage change ────────────────────────────────────────────────────────────
  async function changeStage(newStage: string) {
    if (newStage === currentStage) return
    setStageSaving(true)
    try {
      const res = await fetch(`/api/accounts/${account!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      })
      if (res.ok) {
        setDetail(d => d ? { ...d, account: { ...d.account, stage: newStage } } : d)
        onUpdated(account!.id, { stage: newStage })
      }
    } finally {
      setStageSaving(false)
    }
  }

  // ── Add note ────────────────────────────────────────────────────────────────
  async function submitNote() {
    if (!noteText.trim()) return
    setAddingNote(true)
    try {
      const res = await fetch(`/api/accounts/${account!.id}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: noteText.trim(), interaction_type: noteType, next_step: nextStep.trim() || null }),
      })
      if (res.ok) {
        const { interaction } = await res.json()
        setDetail(d => d ? { ...d, interactions: [interaction, ...d.interactions] } : d)
        setNoteText('')
        setNextStep('')
        setNoteType('note')
        setShowNoteBox(false)
      }
    } finally {
      setAddingNote(false)
    }
  }

  const profile = detail?.profile as any
  const panjiva = profile?.panjiva_data as any

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      <aside
        onClick={e => e.stopPropagation()}
        className="relative h-full w-full max-w-[600px] bg-surface-card border-l border-surface-rule shadow-menu flex flex-col slide-up overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-surface-rule bg-surface-card sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="font-mono text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md"
                style={{ background: `${stageColor(currentStage)}22`, color: stageColor(currentStage) }}
              >
                {currentStage}
              </span>
              {account.account_type && (
                <span className="font-mono text-[10px] text-text-muted bg-surface px-2 py-0.5 rounded-md border border-surface-rule">
                  {account.account_type}
                </span>
              )}
              {account.country && (
                <span className="font-mono text-[11px] text-text-muted">{account.country}</span>
              )}
            </div>
            <h2 className="font-display font-semibold text-[20px] text-text leading-snug">
              {account.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface text-text-muted hover:text-text transition-colors mt-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* Stage picker */}
          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2.5">Pipeline stage</h3>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map(s => (
                <button
                  key={s.key}
                  onClick={() => changeStage(s.key)}
                  disabled={stageSaving}
                  className={clsx(
                    'flex items-center gap-1 font-mono text-[11px] px-2.5 py-1 rounded-lg border transition-all',
                    s.key === currentStage
                      ? 'border-transparent font-semibold'
                      : 'border-surface-rule text-text-muted hover:text-text hover:border-text-faint/40'
                  )}
                  style={s.key === currentStage
                    ? { background: `${s.color}22`, color: s.color, borderColor: `${s.color}44` }
                    : undefined}
                >
                  {s.key === currentStage && <ChevronRight size={10} />}
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          {/* Next action */}
          {(detail?.account?.sales_angle ?? account.sales_angle) && (
            <section>
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
                <Target size={12} />
                Next action
              </h3>
              <p
                className="text-[13px] text-text leading-relaxed rounded-lg border border-surface-rule bg-surface p-3"
                style={{ borderLeft: '3px solid var(--color-accent)' }}
              >
                {(detail?.account?.sales_angle ?? account.sales_angle) as string}
              </p>
            </section>
          )}

          {/* Company dossier */}
          {loading ? (
            <div className="flex items-center gap-2 text-text-muted text-[13px]">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : profile ? (
            <section>
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
                <Globe size={12} />
                Company dossier
              </h3>
              <div className="rounded-lg border border-surface-rule bg-surface p-3 space-y-2 text-[13px]">
                {profile.sector && (
                  <Row label="Sector" value={profile.sector} />
                )}
                {panjiva?.current_supplier && (
                  <Row label="Current supplier" value={panjiva.current_supplier} />
                )}
                {panjiva?.shipment_count != null && (
                  <Row label="Shipments" value={`${panjiva.shipment_count} recorded`} />
                )}
                {panjiva?.total_value_usd != null && (
                  <Row label="Total import value" value={`$${Number(panjiva.total_value_usd).toLocaleString()}`} />
                )}
                {profile.pitch_angle && (
                  <div className="pt-1 mt-1 border-t border-surface-rule">
                    <p className="text-text-muted text-[12px]">{profile.pitch_angle}</p>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {/* Linked signals */}
          {(detail?.signals?.length ?? 0) > 0 && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
                Linked signals ({detail!.signals.length})
              </h3>
              <div className="space-y-2">
                {detail!.signals.map(s => {
                  const cls = classificationStyle(s.classification as any)
                  return (
                    <div
                      key={s.id}
                      className="flex items-start gap-2.5 rounded-lg border border-surface-rule bg-surface p-2.5"
                    >
                      <span
                        className="mt-0.5 shrink-0 font-mono text-[10px] font-medium uppercase px-1.5 py-0.5 rounded border"
                        style={{ background: cls.bg, color: cls.fg, borderColor: cls.border }}
                      >
                        {s.relevance_score}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text font-medium leading-snug line-clamp-2">{s.title}</p>
                        {s.sales_angle && (
                          <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">{s.sales_angle}</p>
                        )}
                      </div>
                      {s.source_url && (
                        <a
                          href={s.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-text-muted hover:text-accent transition-colors"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Timeline */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                <Clock size={12} />
                Timeline {detail?.interactions.length ? `(${detail.interactions.length})` : ''}
              </h3>
              <button
                onClick={() => setShowNoteBox(v => !v)}
                className="flex items-center gap-1 font-mono text-[10px] text-accent hover:text-accent/80 transition-colors"
              >
                <Plus size={11} />
                Add note
              </button>
            </div>

            {/* Add note form */}
            {showNoteBox && (
              <div className="mb-3 rounded-lg border border-surface-rule bg-surface p-3 space-y-2">
                <div className="flex gap-1.5 flex-wrap">
                  {INTERACTION_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setNoteType(t)}
                      className={clsx(
                        'font-mono text-[10px] px-2 py-0.5 rounded-md border transition-colors',
                        noteType === t
                          ? 'border-accent text-accent bg-accent/10'
                          : 'border-surface-rule text-text-muted hover:text-text'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Note…"
                  rows={3}
                  className="w-full bg-surface-card border border-surface-rule rounded-lg px-3 py-2 text-[13px] text-text placeholder:text-text-faint resize-none focus:outline-none focus:border-accent/60"
                />
                <input
                  value={nextStep}
                  onChange={e => setNextStep(e.target.value)}
                  placeholder="Next step (optional)"
                  className="w-full bg-surface-card border border-surface-rule rounded-lg px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent/60"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowNoteBox(false); setNoteText(''); setNextStep('') }}
                    className="font-mono text-[11px] text-text-muted hover:text-text transition-colors px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitNote}
                    disabled={addingNote || !noteText.trim()}
                    className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-50 hover:bg-accent/90 transition-colors"
                  >
                    {addingNote ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* Interaction list */}
            {!detail && !loading && (
              <p className="text-[12px] text-text-muted">No timeline yet.</p>
            )}
            <div className="space-y-2">
              {(detail?.interactions ?? []).map(ix => (
                <div key={ix.id} className="flex gap-3 text-[12px]">
                  <div className="w-1.5 h-1.5 rounded-full bg-surface-rule mt-[5px] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-[10px] text-text-faint uppercase">{ix.interaction_type}</span>
                      <span className="text-text-faint text-[10px]">{timeAgo(ix.occurred_at)}</span>
                    </div>
                    <p className="text-text leading-snug">{ix.summary}</p>
                    {ix.next_step && (
                      <p className="text-text-muted mt-0.5 flex items-start gap-1">
                        <ChevronRight size={10} className="mt-[3px] shrink-0 text-accent" />
                        {ix.next_step}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {detail?.interactions.length === 0 && (
                <p className="text-[12px] text-text-muted">No activity yet.</p>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="font-mono text-[10px] text-text-faint w-32 shrink-0 pt-0.5 uppercase tracking-wider">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}
