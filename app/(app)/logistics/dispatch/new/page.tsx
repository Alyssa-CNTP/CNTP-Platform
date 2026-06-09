'use client'

// app/(app)/logistics/dispatch/new/page.tsx
// Create a dispatch. Pick (or create) a sales order, container info, schedule.
// For the prototype the SO is created inline if it doesn't exist yet.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { logisticsDb } from '@/lib/logistics/db'
import { DISPATCH_DOC_CODES } from '@/lib/logistics/types'
import type { SalesOrder, Customer } from '@/lib/logistics/types'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'

export default function NewDispatchPage() {
  const router = useRouter()

  const [orders, setOrders]       = useState<(SalesOrder & { customer: { name: string } | null })[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [mode, setMode]           = useState<'existing' | 'new-so'>('new-so')
  const [soId, setSoId]           = useState<string>('')
  const [customerId, setCustomerId] = useState<string>('')
  const [soCode, setSoCode]       = useState<string>('')
  const [containerNo, setContainerNo]     = useState('')
  const [containerSize, setContainerSize] = useState<'20ft'|'40ft'|'truck'|'other'>('20ft')
  const [sealNo, setSealNo]               = useState('')
  const [transporter, setTransporter]     = useState('')
  const [scheduledAt, setScheduledAt]     = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [soRes, custRes] = await Promise.all([
        db.from('sales_orders').select('*, customer:customer_id(name)').in('status', ['open','allocating','picking','loading']).order('created_at', { ascending: false }),
        db.from('customers').select('*').eq('active', true).order('name'),
      ])
      setOrders((soRes.data as any) ?? [])
      setCustomers((custRes.data as Customer[]) ?? [])
    } finally { setLoading(false) }
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const db = logisticsDb()
      let theSoId = soId

      if (mode === 'new-so') {
        if (!customerId) { setError('Choose a customer'); return }
        const code = soCode.trim() || `SO-${new Date().getFullYear()}-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`
        const { data: so, error: soErr } = await db.from('sales_orders').insert({
          so_code: code,
          customer_id: customerId,
          status: 'allocating',
        }).select('id').maybeSingle()
        if (soErr || !so) throw soErr ?? new Error('SO insert failed')
        theSoId = (so as any).id
      } else if (!theSoId) {
        setError('Choose a sales order'); return
      }

      const dispatchCode = `DSP-${new Date().getFullYear()}-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`
      const { data: dsp, error: dspErr } = await db.from('dispatches').insert({
        dispatch_code:  dispatchCode,
        so_id:          theSoId,
        container_no:   containerNo.trim() || null,
        container_size: containerSize,
        seal_no:        sealNo.trim() || null,
        transporter:    transporter.trim() || null,
        scheduled_at:   scheduledAt ? new Date(scheduledAt).toISOString() : null,
        status:         'planning',
      }).select('id').maybeSingle()
      if (dspErr || !dsp) throw dspErr ?? new Error('Dispatch insert failed')

      const dispatchId = (dsp as any).id

      // Pre-create the 10 checklist rows in pending state
      await db.from('dispatch_documents').insert(
        DISPATCH_DOC_CODES.map(code => ({ dispatch_id: dispatchId, doc_code: code, status: 'pending' }))
      )

      router.push(`/logistics/dispatch/${dispatchId}`)
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-12 text-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/logistics/dispatch" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to dispatches
      </Link>
      <h1 className="text-2xl font-semibold text-text mb-1">New dispatch</h1>
      <p className="text-sm text-text-muted mb-6">Link to a sales order, set container info, then pick units on the next screen.</p>

      <div className="rounded-xl border border-surface-rule bg-white p-5 space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Sales order</div>
          <div className="flex items-center gap-3 mb-2">
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
              Existing
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="radio" checked={mode === 'new-so'} onChange={() => setMode('new-so')} />
              Create new
            </label>
          </div>
          {mode === 'existing' ? (
            <select value={soId} onChange={e => setSoId(e.target.value)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
              <option value="">— pick a sales order —</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.so_code} · {o.customer?.name ?? '?'}</option>)}
            </select>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input value={soCode} onChange={e => setSoCode(e.target.value)} placeholder="SO code (auto if blank)"
                className="px-3 py-2 border border-surface-rule rounded-lg text-sm" />
              <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                className="px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                <option value="">— customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.country ?? '—'})</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Container #">
            <input value={containerNo} onChange={e => setContainerNo(e.target.value)} placeholder="optional"
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm font-mono" />
          </Field>
          <Field label="Container size">
            <select value={containerSize} onChange={e => setContainerSize(e.target.value as any)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
              <option value="20ft">20ft</option>
              <option value="40ft">40ft</option>
              <option value="truck">Truck</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Seal #">
            <input value={sealNo} onChange={e => setSealNo(e.target.value)} placeholder="optional"
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm font-mono" />
          </Field>
          <Field label="Transporter">
            <input value={transporter} onChange={e => setTransporter(e.target.value)} placeholder="optional"
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" />
          </Field>
          <Field label="Scheduled dispatch">
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" />
          </Field>
        </div>

        {error && <div className="text-sm text-err bg-err/5 border border-err/20 rounded-lg p-3">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link href="/logistics/dispatch" className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text">Cancel</Link>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create dispatch
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</div>
      {children}
    </label>
  )
}
