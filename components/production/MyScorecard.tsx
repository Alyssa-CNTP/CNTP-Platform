'use client'

/**
 * The operator's own capture scorecard, on History / Planning.
 *
 * Shows what a supervisor already recorded about their shifts in
 * `production.capture_ratings` — performance and accuracy out of five, and
 * the system's own accuracy read alongside. Nothing is measured here that was
 * not already being measured; what changes is who can see it.
 *
 * It renders for the signed-in operator's OWN rows only. It is not a
 * leaderboard and must not become one: the supervisor's weekly board already
 * exists behind `can_view_capture_ratings`, and turning this into a
 * comparison between people is a different product decision from letting
 * someone look at their own record.
 *
 * Takes its data as props (ARCHITECTURE.md §3.3) — the page owns loading, so
 * this stays a pure render and the History page keeps one place where its
 * queries live.
 */

import { Star, Gauge, Info } from 'lucide-react'
import type { Scorecard } from '@/lib/core/production/scorecard'

function Score({ label, value, outOf, icon }: {
  label: string
  value: number | null
  outOf?: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex-1 min-w-[92px]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
        {icon}{label}
      </div>
      <div className="mt-0.5 font-mono text-[18px] font-bold text-stone-800">
        {value === null ? (
          // Not "0" and not "—" on its own: an operator seeing a zero next to
          // their name will read it as a bad score rather than as no score.
          <span className="text-[13px] font-sans font-medium text-stone-400">Not rated yet</span>
        ) : (
          <>{value}<span className="text-[12px] font-normal text-stone-400">{outOf}</span></>
        )}
      </div>
    </div>
  )
}

export function MyScorecard({ card, sectionLabel, days }: {
  card: Scorecard
  sectionLabel: string
  days: number
}) {
  // Nothing recorded at all: say so plainly rather than render an empty card
  // full of dashes, which reads as broken.
  const nothingYet =
    card.ratedShifts === 0 && card.unratedShifts === 0

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[13px] font-semibold text-stone-800">
          How you&rsquo;re doing · {sectionLabel}
        </h2>
        <span className="text-[11px] text-stone-400">last {days} days</span>
      </div>

      {nothingYet ? (
        <p className="text-[12px] text-stone-500">
          No shifts recorded for you on this line yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <Score label="Performance" value={card.avgPerformance} outOf="/5"
                   icon={<Star size={12} />} />
            <Score label="Accuracy" value={card.avgAccuracy} outOf="/5"
                   icon={<Star size={12} />} />
            <Score label="System check" value={card.avgSystemAccuracyPct} outOf="%"
                   icon={<Gauge size={12} />} />
          </div>

          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-stone-400">
            <Info size={12} className="shrink-0 mt-0.5" />
            <span>
              {card.ratedShifts === 0
                ? 'Your supervisor hasn’t scored any of these shifts yet.'
                : `From ${card.ratedShifts} scored ${card.ratedShifts === 1 ? 'shift' : 'shifts'}` +
                  (card.unratedShifts > 0
                    ? `; ${card.unratedShifts} not scored, which don’t count against you.`
                    : '.')}
              {' '}System check is worked out from the captured data, not by a person.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
