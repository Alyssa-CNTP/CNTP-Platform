'use client'

// app/(app)/logistics/receiving/from-production/page.tsx
// Receive a PRODUCTION output bag into the warehouse — the counterpart to
// GRN receiving (which is supplier-sourced). Scan a production.bag_tags
// serial directly; that serial becomes the new logistics.units barcode.
//
// Flow:
//   1. Scan/type a bag serial → look up its live production.bag_tags row
//      (read-only preview — product, variant, weight, lot, current status)
//   2. Pick a location + confirm the unit type
//   3. Confirm → creates the warehouse unit AND retires the bag_tags row
//      (see receiveProductionUnit() for why both happen together)
//   4. Repeat for the next bag

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getDb } from '@/lib/supabase/db'
import { logisticsDb } from '@/lib/logistics/db'
import { receiveProductionUnit } from '@/lib/logistics/actions'
import { useAuth } from '@/lib/auth/context'
import type { Location } from '@/lib/logistics/types'
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, ScanBarcode, Boxes } from 'lucide-react'

interface BagPreview {
  serial_number: string
  product_type:  string
  variant:       string | null
  weight_kg:     number | null
  lot_number:    string | null
  section_id:    string
  status:        string
}

interface ReceivedRow { barcode: string; product_type: string; weight_kg: number | null; at: string }

export default function ReceiveFromProductionPage() {
  const { user, displayName } = useAuth()

  const [locations, setLocations]   = useState<Location[]>([])
  const [serial, setSerial]         = useState('')
  const [preview, setPreview]       = useState<BagPreview | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [looking, setLooking]       = useState(false)

  const [locationId, setLocationId] = useState('')
  const [unitType, setUnitType]     = useState<'bag' | 'box' | 'pallet'>('bag')
  const [receiving, setReceiving]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [received, setReceived]     = useState<ReceivedRow[]>([])

  useEffect(() => { void loadLocations() }, [])

  async function loadLocations() {
    const db = logisticsDb()
    const { data } = await db.from('locations').select('*').eq('active', true).order('code')
    const all = (data as Location[]) ?? []
    // Finished product belongs in finished-goods storage by default — fall back
    // to every active location if none are configured that way yet.
    const finished = all.filter(l => l.location_type === 'finished_storage')
    setLocations(finished.length ? finished : all)
    if (finished.length === 1) setLocationId(finished[0].id)
  }

  async function lookup() {
    const s = serial.trim()
    if (!s) return
    setLooking(true); setPreviewErr(null); setPreview(null); setError(null)
    try {
      const { data } = await getDb().schema('production').from('bag_tags')
        .select('serial_number, product_type, variant, weight_kg, lot_number, section_id, status')
        .eq('serial_number', s).maybeSingle()
      const bag = data as BagPreview | null
      if (!bag) { setPreviewErr(`No production bag with serial "${s}".`); return }
      if (bag.status !== 'in_stock') { setPreviewErr(`Bag ${s} is "${bag.status}" — only in-stock bags can be received into the warehouse.`); return }
      setPreview(bag)
      // Sensible default — a single line's worth of bagged product (e.g. a
      // Pasteuriser pallet run) is usually heavier than one hand-carried bag.
      setUnitType((bag.weight_kg ?? 0) > 100 ? 'pallet' : 'bag')
    } catch (e: any) {
      setPreviewErr(e?.message ?? 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  async function confirmReceive() {
    if (!preview) return
    if (!locationId) { setError('Pick a location'); return }
    setReceiving(true); setError(null)
    try {
      const res = await receiveProductionUnit({
        bagSerial:     preview.serial_number,
        unitType,
        locationId,
        operatorId:    user?.id ?? null,
        operatorName:  displayName ?? null,
      })
      if ('error' in res) { setError(res.error); return }
      setReceived(rs => [{ barcode: res.barcode, product_type: preview.product_type, weight_kg: preview.weight_kg, at: new Date().toISOString() }, ...rs])
      setSerial(''); setPreview(null)
    } catch (e: any) {
      setError(e?.message ?? 'Receive failed')
    } finally {
      setReceiving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/logistics/receiving" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to Receiving
      </Link>

      <h1 className="text-2xl font-semibold text-text">Receive from production</h1>
      <p className="text-sm text-text-muted mt-1 mb-5">
        Scan a finished bag's barcode to bring it into the warehouse. The bag's own serial becomes its warehouse barcode — one identity, both systems.
      </p>

      <div className="rounded-xl border border-surface-rule bg-white p-5 mb-5 space-y-4">
        <div>
          <FieldLabel>Bag serial</FieldLabel>
          <div className="flex gap-2">
            <input
              autoFocus data-serial="true" value={serial}
              onChange={e => { setSerial(e.target.value.toUpperCase()); setPreviewErr(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookup() } }}
              placeholder="Scan or type — press Enter to look up"
              className="flex-1 px-3 py-2 border border-surface-rule rounded-lg text-sm font-mono"
              autoCapitalize="characters" spellCheck={false}
            />
            <button onClick={lookup} disabled={!serial.trim() || looking}
              className="px-4 py-2 rounded-lg border border-surface-rule bg-white text-sm hover:bg-surface disabled:opacity-40 inline-flex items-center gap-1.5">
              {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanBarcode className="w-4 h-4" />} Look up
            </button>
          </div>
          {previewErr && (
            <div className="mt-2 flex items-center gap-2 text-sm text-err"><AlertCircle className="w-4 h-4 shrink-0" /> {previewErr}</div>
          )}
        </div>

        {preview && (
          <>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <div className="font-medium text-emerald-900">{preview.product_type}{preview.variant ? ` · ${preview.variant}` : ''}</div>
              <div className="text-emerald-700 text-xs mt-0.5 font-mono">
                {[preview.serial_number, preview.lot_number, preview.weight_kg != null ? `${preview.weight_kg} kg` : null, `from ${preview.section_id}`].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Location</FieldLabel>
                <select value={locationId} onChange={e => setLocationId(e.target.value)}
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                  <option value="">— pick —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.code} · {l.location_type}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Unit type</FieldLabel>
                <select value={unitType} onChange={e => setUnitType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-surface-rule rounded-lg text-sm bg-white">
                  <option value="bag">Bag</option>
                  <option value="box">Box</option>
                  <option value="pallet">Pallet</option>
                </select>
              </div>
            </div>

            <button onClick={confirmReceive} disabled={receiving || !locationId}
              className="w-full px-4 py-2.5 rounded-lg bg-text text-white text-sm hover:bg-text/90 disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {receiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Boxes className="w-4 h-4" />}
              Receive into warehouse
            </button>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-err/20 bg-err/5 px-4 py-2.5 flex items-center gap-2 text-sm text-err">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-surface-rule bg-white p-5">
        <div className="text-[11px] uppercase tracking-wider text-text-muted mb-3">Received this session ({received.length})</div>
        {received.length === 0 ? (
          <div className="text-sm text-text-muted py-6 text-center">Nothing received yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left py-1.5">Barcode</th><th className="text-left">Product</th><th className="text-right">Weight (kg)</th><th className="text-left">Time</th></tr>
            </thead>
            <tbody>
              {received.map(r => (
                <tr key={r.barcode} className="border-t border-surface-rule">
                  <td className="py-2 font-mono text-xs">{r.barcode}</td>
                  <td>{r.product_type}</td>
                  <td className="text-right tabular-nums">{r.weight_kg ?? '—'}</td>
                  <td className="text-text-muted text-xs">{new Date(r.at).toLocaleTimeString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{children}</div>
}
