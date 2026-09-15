'use client'

// app/(app)/take-in/contracts/page.tsx
//
// Contracts — the first step, and the sensitive one.
//
// THE RAND VALUES ARE NOT ON THIS QUERY. Pricing lives in its own table
// (takein.contract_pricing) behind row-level security, and this page only
// selects it when the signed-in user holds can_view_contract_pricing. That is
// not belt-and-braces theatre: Supabase RLS is ROW-level, so a policy cannot
// hide a column from `select *`. Splitting the table is the only way a depot
// clerk can read the contract list while the money stays out of their reach —
// if they craft the query by hand, the policy still refuses the row.
//
// Panel terms live here too, because "does a panel decision reach the producer"
// is a contract question, not a code question.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { takeinDb } from '@/lib/takein/db'
import {
  PANEL_TERMS, DEFAULT_BINDING,
  type Contract, type ContractPricing, type PanelTermKey,
} from '@/lib/takein/types'
import { Loader2, Lock, AlertTriangle, ShieldCheck } from 'lucide-react'

const VARIANTS = ['Conventional', 'RA-Conventional', 'Organic', 'RA-Organic', 'Fairtrade'] as const

export default function ContractsPage() {
  const { p, fullName, user } = useAuth()
  const canEdit    = p('can_manage_takein_contracts')
  const canApprove = p('can_approve_takein_contracts')
  const canSeePrice = p('can_view_contract_pricing')
  const canSetPrice = p('can_set_contract_pricing')

  const [contracts, setContracts] = useState<Contract[]>([])
  const [pricing,   setPricing]   = useState<Record<string, ContractPricing>>({})
  const [terms,     setTerms]     = useState<Record<string, Record<string, boolean>>>({})
  const [selId,     setSelId]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState('')
  const [busy,      setBusy]      = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const db = takeinDb()
      const { data, error } = await db
        .from('contracts')
        .select('*, producer:producer_id ( id, acumatica_code, name )')
        .order('contract_no')
      if (error) throw error
      const list = (data as unknown as Contract[]) ?? []
      setContracts(list)
      if (list.length && !selId) setSelId(list[0].id)

      const { data: t } = await db.from('contract_panel_terms').select('*')
      const map: Record<string, Record<string, boolean>> = {}
      for (const row of (t as any[]) ?? []) {
        (map[row.contract_id] ??= {})[row.term_key] = row.binding
      }
      setTerms(map)

      // Only ask for the money if this user is allowed to see it. Asking and
      // getting nothing back would also be safe — the policy refuses — but not
      // asking makes the intent legible in the network tab too.
      if (canSeePrice) {
        const { data: pr } = await db.from('contract_pricing').select('*')
        setPricing(Object.fromEntries(((pr as ContractPricing[]) ?? []).map(x => [x.contract_id, x])))
      } else {
        setPricing({})
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Could not load contracts.')
    } finally { setLoading(false) }
  }, [canSeePrice, selId])

  useEffect(() => { void load() }, [canSeePrice])

  const sel = useMemo(() => contracts.find(c => c.id === selId) ?? null, [contracts, selId])
  const selTerms = useMemo(() => ({ ...DEFAULT_BINDING, ...(selId ? terms[selId] ?? {} : {}) }),
                           [terms, selId])

  async function setTerm(key: PanelTermKey, binding: boolean) {
    if (!sel || !canEdit) return
    const clause = PANEL_TERMS.find(t => t.key === key)?.clause ?? null
    const { error } = await takeinDb().from('contract_panel_terms')
      .upsert({ contract_id: sel.id, term_key: key, binding, clause_ref: clause },
              { onConflict: 'contract_id,term_key' })
    if (error) { setErr(error.message); return }
    setTerms(t => ({ ...t, [sel.id]: { ...(t[sel.id] ?? {}), [key]: binding } }))
  }

  async function approve(step: 'kg' | 'release') {
    if (!sel || !canApprove) return
    setBusy(true)
    try {
      const patch = step === 'kg'
        ? { status: 'awaiting_release', approved_kg_by: user?.id ?? null, approved_kg_at: new Date().toISOString() }
        : { status: 'released',         released_by:    user?.id ?? null, released_at:    new Date().toISOString() }
      const { error } = await takeinDb().from('contracts').update(patch).eq('id', sel.id)
      if (error) throw error
      await load()
    } catch (e: any) { setErr(e?.message ?? 'Could not update the contract.') }
    finally { setBusy(false) }
  }

  const rands = (cents: number) =>
    (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading contracts…
    </div>
  )

  return (
    <div className="space-y-5">
      {err && (
        <div className="rounded-xl border border-err/25 bg-err-bg px-4 py-3 text-[12px] text-err">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{err}
        </div>
      )}

      {!canSeePrice && (
        <div className="flex items-start gap-2 rounded-xl border border-surface-rule bg-surface-dim px-4 py-3 text-[12px] text-text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="text-text">Pricing is not shown for your account.</strong> Contract
            kilograms, variant and balance stay visible — the rand values are held in a separate
            table that row-level security keeps out of reach without{' '}
            <span className="font-mono">can_view_contract_pricing</span>.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── the list ── */}
        <aside className="rounded-2xl border border-surface-rule bg-surface-card">
          <header className="border-b border-surface-rule px-4 py-3">
            <span className="font-display text-[14px] font-semibold text-text">Contracts</span>
            <span className="ml-2 font-mono text-[11px] text-text-muted">{contracts.length}</span>
          </header>
          <ul className="max-h-[560px] overflow-y-auto">
            {contracts.map(c => (
              <li key={c.id}>
                <button onClick={() => setSelId(c.id)}
                  className={`w-full border-b border-surface-rule px-4 py-3 text-left transition-colors last:border-0 ${
                    c.id === selId ? 'bg-accent-bg' : 'hover:bg-surface-raised'}`}>
                  <div className="font-mono text-[12px] font-semibold text-text">{c.contract_no}</div>
                  <div className="text-[11px] text-text-muted">{c.producer?.name ?? '—'}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <StatusChip status={c.status} />
                    <span className="font-mono text-[10px] text-text-faint">
                      {Number(c.contracted_kg).toLocaleString('en-ZA')} kg
                    </span>
                  </div>
                </button>
              </li>
            ))}
            {!contracts.length && (
              <li className="px-4 py-8 text-center text-[12px] text-text-muted">
                No contracts yet. They are raised from the Acumatica vendor list.
              </li>
            )}
          </ul>
        </aside>

        {/* ── the detail ── */}
        <div className="space-y-4">
          {!sel ? (
            <div className="rounded-2xl border border-surface-rule bg-surface-card px-4 py-8 text-center text-[12px] text-text-muted">
              Select a contract.
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="flex items-center justify-between border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    {sel.contract_no} · {sel.variant}
                  </span>
                  <StatusChip status={sel.status} />
                </header>
                <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                  <Field label="Producer"        value={sel.producer?.name ?? '—'} />
                  <Field label="Acumatica code"  value={sel.producer?.acumatica_code ?? '—'} mono />
                  <Field label="Season"          value={String(sel.season)} mono />
                  <Field label="Contracted kg"   value={Number(sel.contracted_kg).toLocaleString('en-ZA')} mono />
                </div>

                {/* pricing — its own strip, so the boundary is visible */}
                <div className="border-t border-surface-rule px-4 py-4">
                  <div className="mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-brand" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      Pricing
                    </span>
                  </div>
                  {canSeePrice ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Guaranteed price" mono
                        value={pricing[sel.id] ? `R ${rands(pricing[sel.id].guaranteed_cents)} /kg` : 'not set'} />
                      <Field label="First payment" mono
                        value={pricing[sel.id] ? `R ${rands(pricing[sel.id].first_pay_cents)} /kg` : 'not set'} />
                      {!canSetPrice && (
                        <p className="sm:col-span-2 text-[11px] text-text-faint">
                          Read-only — setting a price needs <span className="font-mono">can_set_contract_pricing</span>.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-text-muted">
                      <Lock className="mr-1 inline h-3.5 w-3.5" />
                      Held back for your account.
                    </p>
                  )}
                </div>

                {canApprove && (
                  <div className="flex flex-wrap gap-2 border-t border-surface-rule px-4 py-3">
                    <button onClick={() => approve('kg')} disabled={busy || sel.status !== 'draft'}
                      className="rounded-xl border border-surface-rule bg-surface-card px-3.5 py-2 text-[12px]
                                 font-semibold text-text disabled:opacity-40">
                      {sel.status === 'draft' ? 'Approval 1 · kilograms' : '✓ Kilograms approved'}
                    </button>
                    <button onClick={() => approve('release')} disabled={busy || sel.status !== 'awaiting_release'}
                      className="rounded-xl bg-brand px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                      {sel.status === 'released' ? '✓ Released for signing' : 'Approval 2 · release'}
                    </button>
                  </div>
                )}
              </section>

              {/* ── panel terms ── */}
              <section className="rounded-2xl border border-surface-rule bg-surface-card">
                <header className="border-b border-surface-rule px-4 py-3">
                  <span className="font-display text-[14px] font-semibold text-text">
                    Verpligte Paneel Besluit — what binds this producer
                  </span>
                </header>
                <div className="px-4 py-4">
                  <p className="mb-3 text-[12px] leading-relaxed text-text-muted">
                    A panel sitting on a batch is an <strong className="text-text">in-house quality
                    review</strong>: it does not reach the producer, their payment, or their visibility
                    on the tea. Tick a finding here and it becomes a <strong className="text-text">contract
                    term</strong> — the panel&rsquo;s outcome then reaches them and their documents print{' '}
                    <strong className="text-text">Ja</strong>. Untick it and the same finding is still
                    reviewed in-house, silently.
                  </p>
                  <div className="divide-y divide-surface-rule">
                    {PANEL_TERMS.map(t => (
                      <label key={t.key}
                        className="flex cursor-pointer items-start gap-3 py-2.5">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                          checked={!!selTerms[t.key]} disabled={!canEdit}
                          onChange={e => void setTerm(t.key, e.target.checked)} />
                        <span>
                          <span className="block text-[13px] text-text">{t.label}</span>
                          <span className="block font-mono text-[10px] text-text-faint">
                            {t.clause}{!selTerms[t.key] && ' · in-house only'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {!canEdit && (
                    <p className="mt-3 text-[11px] text-text-faint">
                      Read-only — editing terms needs <span className="font-mono">can_manage_takein_contracts</span>.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:            'bg-surface-dim text-text-muted',
    awaiting_release: 'bg-warn-bg text-warn',
    released:         'bg-ok-bg text-ok',
    closed:           'bg-surface-dim text-text-faint',
  }
  const label: Record<string, string> = {
    draft: 'Draft', awaiting_release: 'Awaiting release',
    released: 'Released for signing', closed: 'Closed',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${map[status] ?? map.draft}`}>
      {label[status] ?? status}
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-[13px] text-text ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}
