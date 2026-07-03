'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Search, Users } from 'lucide-react'
import clsx from 'clsx'
import AccountDrawer, {
  type AccountStub,
  stageColor,
} from '@/components/leads/AccountDrawer'

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'lead',        label: 'Lead'        },
  { key: 'qualified',   label: 'Qualified'   },
  { key: 'proposal',    label: 'Proposal'    },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won',         label: 'Won'         },
  { key: 'lost',        label: 'Lost'        },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LeadPipelinePage() {
  const [accounts,  setAccounts]  = useState<AccountStub[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [selected,  setSelected]  = useState<AccountStub | null>(null)
  const [search,    setSearch]    = useState('')
  const [stageTab,  setStageTab]  = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/accounts?limit=1000')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setAccounts(json.accounts ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // patch local state after drawer stage-change
  const handleUpdated = useCallback((id: string, patch: Partial<AccountStub>) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev)
  }, [])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    return accounts.filter(a => {
      if (stageTab !== 'all' && a.stage !== stageTab) return false
      if (q && !a.name.toLowerCase().includes(q) && !(a.country ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [accounts, stageTab, q])

  const byStage = useMemo(() => {
    const map = new Map<string, AccountStub[]>()
    for (const s of STAGES) map.set(s.key, [])
    for (const a of accounts) {
      const col = map.get(a.stage) ?? map.get('lead')!
      col.push(a)
    }
    return map
  }, [accounts])

  const totals = useMemo(() => {
    const won  = accounts.filter(a => a.stage === 'won').length
    const live = accounts.filter(a => !['won','lost'].includes(a.stage)).length
    return { total: accounts.length, won, live }
  }, [accounts])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-6 py-6 max-w-[1440px] mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 mb-5">
        <span className="w-full font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">
          Intelligence / Lead Pipeline
        </span>
        <h1 className="font-display font-bold text-[24px] text-text">Lead Pipeline</h1>
        <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-surface-rule bg-surface text-text-muted">
          {accounts.length} accounts
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-text-muted hover:text-text disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <KpiCard label="Total accounts" value={totals.total} />
        <KpiCard label="Active pipeline" value={totals.live} accent="var(--color-accent)" />
        <KpiCard label="Won" value={totals.won} accent="var(--color-ok)" />
      </div>

      {/* Stage tab filter */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <button
          onClick={() => setStageTab('all')}
          className={clsx(
            'font-mono text-[11px] px-3 py-1.5 rounded-lg border transition-colors',
            stageTab === 'all'
              ? 'border-text-faint/40 bg-surface text-text'
              : 'border-surface-rule text-text-muted hover:text-text'
          )}
        >
          All ({accounts.length})
        </button>
        {STAGES.map(s => {
          const count = byStage.get(s.key)?.length ?? 0
          return (
            <button
              key={s.key}
              onClick={() => setStageTab(s.key)}
              className={clsx(
                'font-mono text-[11px] px-3 py-1.5 rounded-lg border transition-colors',
                stageTab === s.key
                  ? 'border-transparent font-semibold'
                  : 'border-surface-rule text-text-muted hover:text-text'
              )}
              style={stageTab === s.key
                ? { background: `${stageColor(s.key)}22`, color: stageColor(s.key), borderColor: `${stageColor(s.key)}44` }
                : undefined}
            >
              {s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search accounts…"
          className="w-full pl-8 pr-3 py-1.5 bg-surface border border-surface-rule rounded-lg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent/60"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-err/30 bg-err/10 px-4 py-3 text-[13px] text-err mb-4">{error}</div>
      )}

      {/* Board — show as columns when "all" tab, flat list otherwise */}
      {stageTab === 'all' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map(s => {
            const cards = (byStage.get(s.key) ?? []).filter(a => {
              if (!q) return true
              return a.name.toLowerCase().includes(q) || (a.country ?? '').toLowerCase().includes(q)
            })
            return (
              <div key={s.key} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: stageColor(s.key) }}
                  />
                  <span className="font-mono text-[11px] font-medium text-text-muted uppercase tracking-wider">
                    {s.label}
                  </span>
                  <span className="font-mono text-[10px] text-text-faint ml-auto">{cards.length}</span>
                </div>
                {cards.length === 0 && !loading && (
                  <p className="font-mono text-[10px] text-text-faint/50 py-4 text-center border border-dashed border-surface-rule rounded-lg">
                    empty
                  </p>
                )}
                {cards.slice(0, 30).map(a => (
                  <AccountCard key={a.id} account={a} onClick={() => setSelected(a)} />
                ))}
                {cards.length > 30 && (
                  <button
                    onClick={() => setStageTab(s.key)}
                    className="font-mono text-[10px] text-text-muted hover:text-accent transition-colors text-center py-1"
                  >
                    +{cards.length - 30} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* Flat list for a single stage */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(a => (
            <AccountCard key={a.id} account={a} onClick={() => setSelected(a)} />
          ))}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full flex flex-col items-center py-16 text-text-muted gap-2">
              <Users size={24} />
              <p className="font-mono text-[12px]">No accounts in this stage</p>
            </div>
          )}
        </div>
      )}

      {/* Drawer */}
      <AccountDrawer
        account={selected}
        onClose={() => setSelected(null)}
        onUpdated={handleUpdated}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-surface-rule bg-surface-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</p>
      <p className="font-display font-bold text-[28px]" style={accent ? { color: accent } : undefined}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function AccountCard({ account, onClick }: { account: AccountStub; onClick: () => void }) {
  const color = stageColor(account.stage)
  return (
    <article
      onClick={onClick}
      className="group relative bg-surface-card rounded-xl border border-surface-rule shadow-card hover:border-text-faint/40 hover:shadow-md transition-all cursor-pointer overflow-hidden p-3 pl-4"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: color }}
      />
      <p className="font-display font-semibold text-[13px] text-text leading-snug line-clamp-1">
        {account.name}
      </p>
      {account.country && (
        <p className="font-mono text-[10px] text-text-muted mt-0.5">{account.country}</p>
      )}
      {account.sales_angle && (
        <p className="text-[11px] text-text-muted mt-1.5 line-clamp-2 leading-relaxed">
          {account.sales_angle}
        </p>
      )}
      {account.tags && account.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {account.tags.slice(0, 3).map(t => (
            <span key={t} className="font-mono text-[9px] text-text-faint bg-surface px-1.5 py-0.5 rounded border border-surface-rule">
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
