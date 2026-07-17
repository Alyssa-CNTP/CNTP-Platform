'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Activity, Package, Scale, CheckCircle2, AlertTriangle, RefreshCw, Layers, ChevronRight } from 'lucide-react'
import { sectionMeta, SECTION_ORDER, MASS_BALANCE_TOLERANCE_KG } from '@/lib/production/capture-config'

/**
 * Live capture KPIs — driven entirely by the structured capture tables
 * (prod_sessions, prod_bagging, prod_mass_balance, bag_tags), so it always
 * reflects what's actually being captured today. Auto-refreshes.
 */
interface SectionRow {
  sectionId: string
  status: string          // none | draft | submitted | approved
  kgIn: number
  kgOut: number
  variance: number
  bags: number
}

const STATUS = {
  none:      { label: 'Idle',          cls: 'bg-stone-100 text-stone-500' },
  draft:     { label: 'Capturing',     cls: 'bg-warn/10 text-warn' },
  submitted: { label: 'Submitted',     cls: 'bg-info/10 text-info' },
  approved:  { label: 'Signed off',    cls: 'bg-ok/10 text-ok' },
} as const

export function LiveCaptureKPIs() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const shiftNow = (() => { const h = new Date().getHours(); return h >= 7 && h < 16 ? 'morning' : 'afternoon' })()
  const [rows, setRows] = useState<SectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    const db = getDb()
    const todayStart = `${today}T00:00:00`

    const [{ data: sessions }, { data: bags }] = await Promise.all([
      db.schema('production').from('prod_sessions').select('id,section_id,status').eq('date', today).is('deleted_at', null),
      db.schema('production').from('bag_tags').select('section_id,weight_kg,created_at').gte('created_at', todayStart),
    ])
    const sess = (sessions as any[]) ?? []
    const sessIds = sess.map(s => s.id)

    let mb: any[] = []
    if (sessIds.length) {
      const { data } = await db.schema('production').from('prod_mass_balance')
        .select('session_id,total_input_kg,total_output_b_kg,total_output_c_kg,total_output_d_kg,balance_kg')
        .in('session_id', sessIds)
      mb = (data as any[]) ?? []
    }
    const mbBySession = new Map(mb.map(m => [m.session_id, m]))

    const rank = (s: string) => ({ approved: 3, submitted: 2, draft: 1 } as any)[s] ?? 0
    const out: SectionRow[] = SECTION_ORDER.map(sectionId => {
      const secSessions = sess.filter(s => s.section_id === sectionId)
      const status = secSessions.reduce((acc, s) => rank(s.status) > rank(acc) ? s.status : acc, 'none')
      let kgIn = 0, kgOut = 0
      secSessions.forEach(s => {
        const m = mbBySession.get(s.id)
        if (m) { kgIn += Number(m.total_input_kg) || 0; kgOut += (Number(m.total_output_b_kg) || 0) + (Number(m.total_output_c_kg) || 0) + (Number(m.total_output_d_kg) || 0) }
      })
      const bagCount = ((bags as any[]) ?? []).filter(b => b.section_id === sectionId).length
      return { sectionId, status, kgIn, kgOut, variance: kgIn - kgOut, bags: bagCount }
    })
    setRows(out)
    setLoading(false); setRefreshing(false)
  }, [today])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 60_000); return () => clearInterval(t) }, [load])

  const active   = rows.filter(r => r.status === 'draft').length
  const signed   = rows.filter(r => r.status === 'approved').length
  const totalKg  = rows.reduce((s, r) => s + r.kgOut, 0)
  const totalBags = rows.reduce((s, r) => s + r.bags, 0)
  const flags    = rows.filter(r => r.kgIn > 0 && Math.abs(r.variance) > MASS_BALANCE_TOLERANCE_KG).length

  const tiles = [
    { label: 'Capturing now', value: String(active),  icon: Activity,     cls: 'text-warn' },
    { label: 'Signed off',    value: String(signed),  icon: CheckCircle2, cls: 'text-ok' },
    { label: 'Bags today',    value: String(totalBags), icon: Package,    cls: 'text-text' },
    { label: 'kg bagged',     value: Math.round(totalKg).toLocaleString(), icon: Scale, cls: 'text-text' },
    { label: 'Balance flags', value: String(flags),   icon: AlertTriangle, cls: flags ? 'text-warn' : 'text-text-muted' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold text-[15px] text-text flex items-center gap-2"><Layers size={15} /> Live capture · today</h3>
        <button onClick={() => load(true)} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-surface-card border border-surface-rule rounded-xl p-4">
            <t.icon size={14} className={`${t.cls} mb-2`} />
            <div className={`font-display font-bold text-[24px] leading-none ${t.cls}`}>{loading ? '—' : t.value}</div>
            <div className="font-mono text-[10px] text-text-muted uppercase tracking-wide mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-rule bg-surface text-left">
                {['Section', 'Status', 'kg in', 'kg out', 'Variance', 'Bags', ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-mono text-[10px] text-text-muted uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-rule">
              {rows.map(r => {
                const m = sectionMeta(r.sectionId)
                const st = (STATUS as any)[r.status] ?? STATUS.none
                const flag = r.kgIn > 0 && Math.abs(r.variance) > MASS_BALANCE_TOLERANCE_KG
                const href = `/production/capture/${r.sectionId}?date=${today}&shift=${shiftNow}`
                return (
                  <tr key={r.sectionId} className="hover:bg-surface transition-colors cursor-pointer"
                    onClick={() => { window.location.href = href }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: m.colorHex }}>
                          <span className="font-mono font-bold text-[8px] text-white">{m.code}</span>
                        </div>
                        <span className="font-body font-medium text-[13px] text-text">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text-muted">{r.kgIn ? r.kgIn.toFixed(1) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.kgOut ? r.kgOut.toFixed(1) : '—'}</td>
                    <td className={`px-4 py-3 font-mono text-[12px] ${flag ? 'text-warn font-bold' : 'text-text-muted'}`}>
                      {r.kgIn ? `${r.variance > 0 ? '+' : ''}${r.variance.toFixed(1)}` : '—'}{flag ? ' ⚠' : ''}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-text">{r.bags || '—'}</td>
                    <td className="px-4 py-3 text-right"><Link href={href} onClick={e => e.stopPropagation()} className="inline-flex text-text-muted hover:text-brand"><ChevronRight size={15} /></Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-surface-rule font-mono text-[10px] text-text-muted">
          Auto-refreshes every minute · {format(new Date(), 'HH:mm')}
        </div>
      </div>
    </div>
  )
}
