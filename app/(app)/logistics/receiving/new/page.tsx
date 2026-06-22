'use client'

// app/(app)/logistics/receiving/new/page.tsx
// Create a new GRN: pick supplier, warehouse, optional PO id, then add lines.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { logisticsDb } from '@/lib/logistics/db'
import { useAuth } from '@/lib/auth/context'
import { Loader2, ArrowLeft, Save, Plus, X } from 'lucide-react'
import type { Supplier, Warehouse } from '@/lib/logistics/types'

interface Line {
  product_type: string
  variant:      string
  expected_kg:  string
}

export default function NewGrnPage() {
  const router = useRouter()
  const { user, displayName } = useAuth()

  const [suppliers, setSuppliers]   = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const [supplierId, setSupplierId]   = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [poId, setPoId]               = useState('')
  const [notes, setNotes]             = useState('')
  const [lines, setLines]             = useState<Line[]>([{ product_type: '', variant: '', expected_kg: '' }])

  useEffect(() => {
    void loadMasters()
  }, [])

  async function loadMasters() {
    setLoading(true)
    try {
      const db = logisticsDb()
      const [sups, whs] = await Promise.all([
        db.from('suppliers').select('*').eq('active', true).order('name'),
        db.from('warehouses').select('*').eq('active', true).order('name'),
      ])
      setSuppliers((sups.data as Supplier[]) ?? [])
      setWarehouses((whs.data as Warehouse[]) ?? [])
      if (whs.data && whs.data.length === 1) setWarehouseId((whs.data[0] as any).id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load master data')
    } finally {
      setLoading(false)
    }
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  function addLine() {
    setLines(prev => [...prev, { product_type: '', variant: '', expected_kg: '' }])
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setError(null)
    if (!supplierId)  return setError('Choose a supplier')
    if (!warehouseId) return setError('Choose a warehouse')
    const validLines = lines.filter(l => l.product_type.trim())
    if (validLines.length === 0) return setError('Add at least one line')

    setSaving(true)
    try {
      const db = logisticsDb()
      const grnCode = `GRN-${new Date().getFullYear()}-${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`

      const { data: grn, error: grnErr } = await db
        .from('grns')
        .insert({
          grn_code:        grnCode,
          acumatica_po_id: poId.trim() || null,
          supplier_id:     supplierId,
          warehouse_id:    warehouseId,
          status:          'receiving',
          notes:           notes.trim() || null,
          received_by:     user?.id ?? null,
        })
        .select('id')
        .maybeSingle()
      if (grnErr || !grn) throw grnErr ?? new Error('GRN insert failed')

      const grnId = (grn as any).id

      const linesPayload = validLines.map((l, i) => ({
        grn_id:       grnId,
        line_no:      i + 1,
        product_type: l.product_type.trim(),
        variant:      l.variant.trim() || null,
        expected_kg:  l.expected_kg.trim() ? Number(l.expected_kg) : null,
      }))
      const { error: linesErr } = await db.from('grn_lines').insert(linesPayload)
      if (linesErr) throw linesErr

      router.push(`/logistics/receiving/${grnId}`)
    } catch (e: any) {
      console.error('[receiving/new] save failed', e)
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/logistics/receiving" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to GRNs
      </Link>

      <h1 className="text-2xl font-semibold text-text mb-1">New GRN</h1>
      <p className="text-sm text-text-muted mb-6">
        Create the receipt header, then scan items into stock on the next screen.
      </p>

      <div className="rounded-xl border border-surface-rule bg-white p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Supplier" required>
            <select
              value={supplierId} onChange={e => setSupplierId(e.target.value)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-white text-sm"
            >
              <option value="">— Choose supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </Field>
          <Field label="Warehouse" required>
            <select
              value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg bg-white text-sm"
            >
              <option value="">— Choose warehouse —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          </Field>
          <Field label="Acumatica PO #">
            <input value={poId} onChange={e => setPoId(e.target.value)}
              className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm font-mono" placeholder="optional" />
          </Field>
          <Field label="Received by">
            <input value={displayName ?? '—'} disabled className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-surface" />
          </Field>
        </div>

        <Field label="Notes">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" placeholder="optional" />
        </Field>

        <div className="pt-2">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Expected lines</div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <input value={l.product_type} onChange={e => updateLine(i, { product_type: e.target.value })}
                    placeholder="Product type (e.g. Raw Rooibos)"
                    className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" />
                </div>
                <div className="col-span-3">
                  <input value={l.variant} onChange={e => updateLine(i, { variant: e.target.value })}
                    placeholder="Variant"
                    className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm" />
                </div>
                <div className="col-span-3">
                  <input value={l.expected_kg} onChange={e => updateLine(i, { expected_kg: e.target.value })}
                    placeholder="Expected kg" type="number" step="0.001"
                    className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm text-right tabular-nums" />
                </div>
                <button onClick={() => removeLine(i)} disabled={lines.length === 1}
                  className="col-span-1 p-2 text-text-muted hover:text-err disabled:opacity-30">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addLine}
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text mt-2">
            <Plus className="w-4 h-4" /> Add line
          </button>
        </div>

        {error && (
          <div className="text-sm text-err bg-err/5 border border-err/20 rounded-lg p-3">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Link href="/logistics/receiving" className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text">
            Cancel
          </Link>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create & start scanning
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">
        {label}{required && <span className="text-err ml-0.5">*</span>}
      </div>
      {children}
    </label>
  )
}
