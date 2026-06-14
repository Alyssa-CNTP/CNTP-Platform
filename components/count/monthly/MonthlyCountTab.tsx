'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { format, subMonths, addMonths, startOfMonth } from 'date-fns'
import { ChevronLeft, ChevronRight, ShieldCheck, Clock, CheckCircle2, AlertTriangle } from 'lucide-react'
import MonthlyCountForm, { type McSession } from './MonthlyCountForm'
import MonthlyComparison      from './MonthlyComparison'
import MonthlyReconciliation  from './MonthlyReconciliation'
import MonthlyBatchLedger     from './MonthlyBatchLedger'
import MonthlyVariances       from './MonthlyVariances'

type SubTab = 'entry' | 'comparison' | 'reconciliation' | 'ledger' | 'variances'

function StatusChip({ session }: { session: McSession | null }) {
  if (!session)                                      return <span className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-surface-rule text-text-muted">Not Started</span>
  if (session.signed_off_at)                         return <span className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-ok/10 text-ok flex items-center gap-1"><ShieldCheck size={10}/> Signed Off</span>
  if (session.sup_confirmed_at && session.adm_confirmed_at) return <span className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-info/10 text-info flex items-center gap-1"><CheckCircle2 size={10}/> Both Submitted</span>
  if (session.sup_confirmed_at || session.adm_confirmed_at) return <span className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-warn/10 text-warn flex items-center gap-1"><Clock size={10}/> In Progress</span>
  return <span className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-surface-rule text-text-muted">Draft</span>
}

export default function MonthlyCountTab() {
  const { displayName, isIT } = useAuth()
  const db = getDb()

  // Default to current month
  const [pivot,   setPivot]   = useState(() => startOfMonth(new Date()))
  const [product, setProduct] = useState<'r'|'h'>('r')
  const [session, setSession] = useState<McSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab,  setSubTab]  = useState<SubTab>('entry')

  const month      = format(pivot, 'yyyy-MM')       // e.g. "2025-05"
  const monthLabel = format(pivot, 'MMMM yyyy')     // e.g. "May 2025"

  // Both roles confirmed — unlock post-entry tabs
  const bothConfirmed = !!(session?.sup_confirmed_at && session?.adm_confirmed_at)

  useEffect(() => {
    loadSession()
    setSubTab('entry')   // reset to entry when month/product changes
  }, [month, product])

  async function loadSession() {
    setLoading(true)
    const { data } = await db
      .from('mc_sessions')
      .select('*')
      .eq('count_month', `${month}-01`)
      .eq('warehouse_id', 'BHW')
      .eq('product_type', product)
      .maybeSingle()
    setSession((data as McSession) ?? null)
    setLoading(false)
  }

  // IT can see all tabs regardless of submission state; others wait for both roles to confirm
  const tabsUnlocked = bothConfirmed || isIT

  const SUB_TABS: { key: SubTab; label: string; locked?: boolean }[] = [
    { key: 'entry',          label: 'Count Entry'     },
    { key: 'comparison',     label: 'Comparison',     locked: !tabsUnlocked },
    { key: 'reconciliation', label: 'Reconciliation', locked: !tabsUnlocked },
    { key: 'ledger',         label: 'Batch Ledger',   locked: !tabsUnlocked },
    { key: 'variances',      label: 'Variances',      locked: !tabsUnlocked },
  ]

  return (
    <div className="flex flex-col min-h-0">

      {/* ── Header strip ──────────────────────────────────────────────────── */}
      <div className="border-b border-surface-rule bg-surface-card px-4 pt-4 pb-0">

        {/* Month navigator + product switcher */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {/* Month nav */}
          <div className="flex items-center gap-1 bg-surface border border-surface-rule rounded-xl overflow-hidden">
            <button
              onClick={() => setPivot(p => startOfMonth(subMonths(p, 1)))}
              className="p-2.5 hover:bg-surface-rule transition-colors"
            >
              <ChevronLeft size={14} className="text-text-muted" />
            </button>
            <span className="font-display font-bold text-[14px] text-text px-3 min-w-[130px] text-center">
              {monthLabel}
            </span>
            <button
              onClick={() => setPivot(p => startOfMonth(addMonths(p, 1)))}
              disabled={format(addMonths(pivot, 1), 'yyyy-MM') > format(new Date(), 'yyyy-MM')}
              className="p-2.5 hover:bg-surface-rule transition-colors disabled:opacity-30"
            >
              <ChevronRight size={14} className="text-text-muted" />
            </button>
          </div>

          {/* Product switcher */}
          <div className="flex border border-surface-rule rounded-xl overflow-hidden">
            {([
              { key: 'r', label: 'Rooibos' },
              { key: 'h', label: 'Rosehips' },
            ] as const).map((p, i) => (
              <button
                key={p.key}
                onClick={() => setProduct(p.key)}
                className={`px-4 py-2 font-display font-bold text-[13px] transition-colors ${i > 0 ? 'border-l border-surface-rule' : ''} ${product === p.key ? 'bg-brand text-white' : 'bg-surface-card text-text-muted hover:text-text'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Status */}
          {!loading && <StatusChip session={session} />}

          {/* Session quick stats */}
          {bothConfirmed && session && (
            <div className="flex items-center gap-3 ml-auto">
              {session.match_rate_pct != null && (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-text-muted">Match rate</span>
                  <span className={`font-mono text-[12px] font-bold ${session.match_rate_pct >= 90 ? 'text-ok' : session.match_rate_pct >= 75 ? 'text-warn' : 'text-err'}`}>
                    {Math.round(session.match_rate_pct)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Post-entry lock notice */}
        {!bothConfirmed && session && (session.sup_confirmed_at || session.adm_confirmed_at) && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-info/8 border border-info/25 rounded-xl">
            <AlertTriangle size={13} className="text-info flex-shrink-0" />
            <p className="font-mono text-[11px] text-info">
              {session.sup_confirmed_at
                ? 'Warehouse Supervisor count submitted — awaiting Stock count to unlock comparison and reconciliation.'
                : 'Stock count submitted — awaiting Warehouse Supervisor count to unlock comparison and reconciliation.'
              }
            </p>
          </div>
        )}

        {/* Sub-tab nav */}
        <div className="flex gap-0 -mb-px">
          {SUB_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => !t.locked && setSubTab(t.key)}
              disabled={!!t.locked}
              className={[
                'px-4 py-2.5 font-display font-bold text-[12px] border-b-2 transition-colors whitespace-nowrap',
                t.locked
                  ? 'border-transparent text-text-faint cursor-not-allowed'
                  : subTab === t.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-text-muted hover:text-text',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 max-w-3xl">
        {loading ? (
          <div className="py-12 text-center font-mono text-[12px] text-text-muted animate-pulse">Loading…</div>
        ) : subTab === 'entry' ? (
          <MonthlyCountForm
            session={session}
            month={month}
            product={product}
            displayName={displayName ?? ''}
            onSessionUpdate={s => { setSession(s); if (s.sup_confirmed_at && s.adm_confirmed_at) setSubTab('comparison') }}
          />
        ) : subTab === 'comparison' && session ? (
          <MonthlyComparison session={session} />
        ) : subTab === 'reconciliation' && session ? (
          <MonthlyReconciliation session={session} />
        ) : subTab === 'ledger' && session ? (
          <MonthlyBatchLedger session={session} />
        ) : subTab === 'variances' && session ? (
          <MonthlyVariances session={session} onSessionUpdate={setSession} />
        ) : null}
      </div>
    </div>
  )
}
