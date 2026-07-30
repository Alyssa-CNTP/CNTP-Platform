'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO, subDays, addDays } from 'date-fns'
import {
  Trophy, Star, Loader2, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Gauge, Medal, Info,
} from 'lucide-react'
import { sastToday, currentShift, SHIFT_LABEL } from '@/lib/production/shifts'
import { sectionMeta } from '@/lib/production/capture-config'

// Capture ratings — "who captured best this week".
//
// A supervisor scores each rostered person on two things, and they are kept
// separate on purpose:
//   Performance — did they run the line well (pace, tidiness, keeping up)
//   Accuracy    — was the data they captured correct
// Averaging those into one number would hide exactly the thing a supervisor
// needs to see: which half is the problem.
//
// Next to the human score sits the SYSTEM's own accuracy read, computed from
// what actually landed in the database — mass-balance variances outside
// tolerance, records never submitted, failed checks. It never overrides the
// supervisor. It's there so a 5-star accuracy score against a 70% data read is
// a visible conversation, and so the score can't drift into a popularity vote.

interface SystemSignals {
  sessions: number
  balanceFlags: number
  notSubmitted: number
  checksFailed: number
  sectionIds: string[]
}
interface RatingRow {
  personName: string
  employeeId: string | null
  operatorId: string | null
  roleKey: string | null
  sectionId: string | null
  captured: boolean
  systemAccuracyPct: number | null
  systemSignals: SystemSignals
  rating: null | {
    id: string; performance: number | null; accuracy: number | null
    note: string | null; ratedByName: string | null; updatedAt: string | null
  }
}
interface ScoreRow {
  personName: string; shiftsRated: number
  avgPerformance: number | null; avgAccuracy: number | null
  scorePct: number | null; avgSystemAccuracyPct: number | null
  sections: string[]
}
interface Payload {
  date: string; shift: string; weekStart: string | null
  canRate: boolean
  roster: RatingRow[]
  scoreboard: ScoreRow[]
  gaps: string[]
}

const roleLabel = (k: string | null) =>
  k ? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'

export function CaptureRatings() {
  const [date, setDate]   = useState(sastToday)
  const [shift, setShift] = useState<'morning' | 'afternoon'>(() => (currentShift() === 'morning' ? 'morning' : 'afternoon'))
  const [data, setData]     = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [savingFor, setSavingFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/production/capture-ratings?date=${date}&shift=${shift}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      setData(json as Payload)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load ratings')
      setData(null)
    }
    setLoading(false)
  }, [date, shift])

  useEffect(() => { load() }, [load])

  async function rate(row: RatingRow, patch: { performance?: number | null; accuracy?: number | null; note?: string }) {
    if (!data?.canRate) return
    setSavingFor(row.personName); setError(null)
    // Optimistic — a star tap should feel instant; a failure re-loads the truth.
    const next = {
      performance: patch.performance !== undefined ? patch.performance : row.rating?.performance ?? null,
      accuracy:    patch.accuracy    !== undefined ? patch.accuracy    : row.rating?.accuracy ?? null,
      note:        patch.note        !== undefined ? patch.note        : row.rating?.note ?? null,
    }
    setData(d => d ? {
      ...d,
      roster: d.roster.map(r => r.personName === row.personName
        ? { ...r, rating: { id: r.rating?.id ?? 'pending', ratedByName: r.rating?.ratedByName ?? null, updatedAt: new Date().toISOString(), ...next } }
        : r),
    } : d)
    try {
      const res = await fetch('/api/production/capture-ratings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, shift, personName: row.personName,
          employeeId: row.employeeId, operatorId: row.operatorId,
          roleKey: row.roleKey, sectionId: row.sectionId,
          systemAccuracyPct: row.systemAccuracyPct, systemSignals: row.systemSignals,
          ...next,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `Error ${res.status}`)
      // Refresh so the leaderboard reflects the new score straight away.
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the rating')
      load()
    }
    setSavingFor(null)
  }

  const rated = data?.roster.filter(r => r.rating?.performance != null || r.rating?.accuracy != null).length ?? 0
  const toRate = data?.roster.length ?? 0

  return (
    <div className="space-y-5">
      {/* Shift picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDate(format(subDays(parseISO(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))}
          className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand transition-colors" title="Previous day">
          <ChevronLeft size={14} />
        </button>
        <input type="date" value={date} max={sastToday()} onChange={e => e.target.value && setDate(e.target.value)}
          className="px-3 py-2 rounded-lg border border-stone-200 text-[12px] font-mono outline-none focus:border-brand" />
        <button onClick={() => setDate(format(addDays(parseISO(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))}
          disabled={date >= sastToday()}
          className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:border-brand hover:text-brand disabled:opacity-30 transition-colors" title="Next day">
          <ChevronRight size={14} />
        </button>
        <div className="flex gap-1 p-1 bg-stone-100 rounded-lg ml-1">
          {(['morning', 'afternoon'] as const).map(s => (
            <button key={s} onClick={() => setShift(s)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${shift === s ? 'bg-white text-brand shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              {SHIFT_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {!loading && toRate > 0 && (
          <span className={`font-mono text-[11px] ${rated === toRate ? 'text-ok' : 'text-text-muted'}`}>
            {rated}/{toRate} rated
          </span>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-[12px] text-err px-4 py-3 bg-err/5 border border-err/20 rounded-xl">
          <AlertTriangle size={13} className="shrink-0" /> {error}
        </p>
      )}
      {data?.gaps.map((g, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] text-warn px-4 py-3 bg-warn/5 border border-warn/30 rounded-xl">
          <AlertTriangle size={13} className="shrink-0" /> {g}
        </p>
      ))}

      {/* Leaderboard — the point of the whole thing. */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-rule bg-surface">
          <Trophy size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">This week&apos;s board</span>
          {data?.weekStart && (
            <span className="font-mono text-[11px] text-text-muted">
              week of {format(parseISO(data.weekStart + 'T12:00:00'), 'd MMM')}
            </span>
          )}
        </div>
        {loading && !data ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
        ) : !data?.scoreboard.length ? (
          <div className="text-center py-10 px-4">
            <Medal size={24} className="mx-auto mb-2 text-stone-200" />
            <p className="font-mono text-[12px] text-stone-400">Nobody has been rated this week yet</p>
            <p className="text-[11px] text-stone-400 mt-1">Score a shift below and the board fills in.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-rule">
            {data.scoreboard.map((s, i) => (
              <div key={s.personName} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center font-display font-bold text-[12px] shrink-0
                  ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-stone-200 text-stone-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-stone-100 text-stone-400'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-body font-semibold text-[14px] text-text truncate">{s.personName}</div>
                  <div className="font-mono text-[11px] text-text-muted truncate">
                    {s.shiftsRated} shift{s.shiftsRated === 1 ? '' : 's'} rated
                    {s.sections.length ? ` · ${s.sections.map(x => sectionMeta(x).code).join(', ')}` : ''}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-4 shrink-0 text-right">
                  <div>
                    <div className="font-mono text-[12px] text-text">{s.avgPerformance?.toFixed(1) ?? '—'}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">perf</div>
                  </div>
                  <div>
                    <div className="font-mono text-[12px] text-text">{s.avgAccuracy?.toFixed(1) ?? '—'}</div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">acc</div>
                  </div>
                  <div title="What the captured data itself says — mass balance, submissions, checks">
                    <div className={`font-mono text-[12px] ${scoreTone(s.avgSystemAccuracyPct)}`}>
                      {s.avgSystemAccuracyPct != null ? `${s.avgSystemAccuracyPct}%` : '—'}
                    </div>
                    <div className="font-mono text-[9px] text-text-muted uppercase">data</div>
                  </div>
                </div>
                <div className="w-16 text-right shrink-0">
                  <div className="font-display font-bold text-[18px] text-brand leading-none">{s.scorePct != null ? `${s.scorePct}` : '—'}</div>
                  <div className="font-mono text-[9px] text-text-muted uppercase">score</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rate this shift */}
      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-rule bg-surface">
          <Star size={15} className="text-text-muted" />
          <span className="font-display font-bold text-[14px] text-text">Rate this shift</span>
          <span className="font-mono text-[11px] text-text-muted">
            {format(parseISO(date + 'T12:00:00'), 'EEE d MMM')} · {SHIFT_LABEL[shift]}
          </span>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-stone-300" /></div>
        ) : !data?.roster.length ? (
          <div className="text-center py-10 px-4">
            <p className="font-mono text-[12px] text-stone-400">Nobody was rostered or captured on this shift.</p>
          </div>
        ) : (
          <>
            {!data.canRate && (
              <p className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-text-muted bg-surface border-b border-surface-rule">
                <Info size={13} className="shrink-0 mt-0.5" />
                You can see the scores but not set them — rating belongs to the supervisor who watched the shift.
              </p>
            )}
            <div className="divide-y divide-surface-rule">
              {data.roster.map(row => (
                <PersonRow key={row.personName} row={row} canRate={data.canRate}
                  saving={savingFor === row.personName} onRate={patch => rate(row, patch)} />
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-text-muted px-1">
        Score is the two star ratings averaged and shown out of 100. The <strong>data</strong> column is
        the system&apos;s own read of the captured records and is never overwritten by a rating — it&apos;s there so
        a high accuracy score against poor data is visible.
      </p>
    </div>
  )
}

const scoreTone = (pct: number | null) =>
  pct == null ? 'text-text-muted' : pct >= 90 ? 'text-ok' : pct >= 70 ? 'text-text' : 'text-warn'

function PersonRow({ row, canRate, saving, onRate }: {
  row: RatingRow; canRate: boolean; saving: boolean
  onRate: (patch: { performance?: number | null; accuracy?: number | null; note?: string }) => void
}) {
  const [note, setNote] = useState(row.rating?.note ?? '')
  const [noteOpen, setNoteOpen] = useState(false)
  const sig = row.systemSignals

  // The one-line explanation of the system's read. Without this the percentage
  // is just an unexplained number, which is how a score loses trust.
  const why: string[] = []
  if (sig.balanceFlags)  why.push(`${sig.balanceFlags} mass-balance variance${sig.balanceFlags === 1 ? '' : 's'} over tolerance`)
  if (sig.notSubmitted)  why.push(`${sig.notSubmitted} record${sig.notSubmitted === 1 ? '' : 's'} not submitted`)
  if (sig.checksFailed)  why.push(`${sig.checksFailed} failed check${sig.checksFailed === 1 ? '' : 's'} on their line`)

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-center gap-2">
            <span className="font-body font-semibold text-[14px] text-text">{row.personName}</span>
            {!row.captured && (
              <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">no capture</span>
            )}
            {saving && <Loader2 size={12} className="animate-spin text-stone-300" />}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            {roleLabel(row.roleKey)}
            {row.sectionId ? ` · ${sectionMeta(row.sectionId).name}` : ''}
          </div>
          {row.systemAccuracyPct != null && (
            <div className="text-[11px] mt-1">
              <span className="inline-flex items-center gap-1">
                <Gauge size={11} className={scoreTone(row.systemAccuracyPct)} />
                <span className={scoreTone(row.systemAccuracyPct)}>Data {row.systemAccuracyPct}%</span>
              </span>
              {why.length > 0 && <span className="text-text-muted"> — {why.join(', ')}</span>}
              {why.length === 0 && <span className="text-text-muted"> — clean: balanced, submitted, no failed checks</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <Stars label="Performance" value={row.rating?.performance ?? null} disabled={!canRate}
            onPick={v => onRate({ performance: v })} />
          <Stars label="Accuracy" value={row.rating?.accuracy ?? null} disabled={!canRate}
            onPick={v => onRate({ accuracy: v })} />
        </div>
      </div>

      {/* Note — collapsed by default; the stars are the fast path. */}
      {canRate && (
        <div className="mt-2">
          {noteOpen || note ? (
            <div className="flex items-center gap-2">
              <input value={note} onChange={e => setNote(e.target.value)}
                onBlur={() => { if ((row.rating?.note ?? '') !== note) onRate({ note }) }}
                placeholder="Optional note — what to keep doing, or what to fix"
                className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-[12px] text-text outline-none focus:border-brand" />
              {row.rating?.updatedAt && (
                <span className="font-mono text-[10px] text-text-muted shrink-0 hidden sm:inline">
                  {row.rating.ratedByName ? `${row.rating.ratedByName} · ` : ''}{format(parseISO(row.rating.updatedAt), 'd MMM HH:mm')}
                </span>
              )}
            </div>
          ) : (
            <button onClick={() => setNoteOpen(true)} className="text-[11px] text-brand hover:underline">+ Add a note</button>
          )}
        </div>
      )}
      {!canRate && row.rating?.note && (
        <p className="mt-1.5 text-[12px] text-text-muted">“{row.rating.note}”</p>
      )}
    </div>
  )
}

function Stars({ label, value, disabled, onPick }: {
  label: string; value: number | null; disabled: boolean; onPick: (v: number | null) => void
}) {
  return (
    <div className="text-center">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(n => {
          const on = value != null && n <= value
          return (
            <button key={n} disabled={disabled}
              // Tapping the current score clears it — a mis-tap must be undoable
              // without a separate "clear" control.
              onClick={() => onPick(value === n ? null : n)}
              title={`${label} ${n}/5`}
              className={`p-0.5 transition-colors ${disabled ? 'cursor-default' : 'hover:scale-110'}`}>
              <Star size={16} className={on ? 'text-amber-500 fill-amber-500' : 'text-stone-300'} />
            </button>
          )
        })}
      </div>
      <div className="font-mono text-[9px] text-text-muted uppercase tracking-wide mt-0.5 flex items-center justify-center gap-1">
        {label}
        {value != null && <CheckCircle2 size={9} className="text-ok" />}
      </div>
    </div>
  )
}
