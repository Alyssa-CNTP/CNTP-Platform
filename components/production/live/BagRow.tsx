'use client'
import { Trash2, Printer, CheckCircle2, Clock } from 'lucide-react'
import type { ScannedBag, OutputBag } from '@/lib/production/live-types'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

const VARIANT_COLOURS: Record<string, string> = {
  'CON':    'bg-stone-200 text-stone-700',
  'ORG':    'bg-green-100 text-green-700',
  'RA CON': 'bg-amber-100 text-amber-700',
  'RA ORG': 'bg-lime-100 text-lime-700',
}

// ─── InputBagRow ─────────────────────────────────────────────────────────────

interface InputBagRowProps {
  bag: ScannedBag
  onRemove: (id: string) => void
}

export function InputBagRow({ bag, onRemove }: InputBagRowProps) {
  const variantColour = bag.variant ? (VARIANT_COLOURS[bag.variant] ?? 'bg-stone-200 text-stone-700') : null

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3 shadow-sm">
      {/* top row: serial + weight + remove */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[13px] text-stone-900 leading-tight">
              {bag.serial_number}
            </span>
            {variantColour && (
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${variantColour}`}>
                {bag.variant}
              </span>
            )}
          </div>
          <p className="text-[12px] text-stone-600 mt-0.5 truncate">{bag.product_type}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="font-mono font-bold text-[14px] text-stone-800">{bag.weight_kg} kg</span>
          <button
            onClick={() => onRemove(bag.id)}
            className="ml-1 p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove bag"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* meta row */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {bag.lot_number && (
          <span className="text-[11px] text-stone-500">Lot: <span className="font-medium text-stone-700">{bag.lot_number}</span></span>
        )}
        <span className="flex items-center gap-1 text-[11px] text-stone-400">
          <Clock size={11} />
          {formatTime(bag.scanned_at)}
        </span>
        {bag.acumaticaId && (
          <span className="font-mono text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
            {bag.acumaticaId}
          </span>
        )}
      </div>

      {/* raw material extra row */}
      {bag.raw && (
        <div className="mt-2 pt-2 border-t border-stone-100 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-stone-500">
            Producer: <span className="font-medium text-stone-700">{bag.raw.producer}</span>
          </span>
          <span className="text-[11px] text-stone-500">
            Received: <span className="font-medium text-stone-700">{formatDate(bag.raw.date_of_receipt)}</span>
          </span>
        </div>
      )}
    </div>
  )
}

// ─── OutputBagRow ─────────────────────────────────────────────────────────────

interface OutputBagRowProps {
  bag: OutputBag
  onPrint: (bag: OutputBag) => void
  onRemove: (id: string) => void
}

export function OutputBagRow({ bag, onPrint, onRemove }: OutputBagRowProps) {
  const variantColour = VARIANT_COLOURS[bag.variant] ?? 'bg-stone-200 text-stone-700'

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3 shadow-sm">
      {/* top row: serial + weight + actions */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[13px] text-stone-900 leading-tight">
              {bag.serial_number}
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${variantColour}`}>
              {bag.variant}
            </span>
            {/* printed status indicator */}
            {bag.printed ? (
              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <CheckCircle2 size={11} className="text-emerald-500" />
                Printed
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-stone-400">
                <span className="w-2 h-2 rounded-full bg-stone-300 inline-block" />
                Not printed
              </span>
            )}
          </div>
          <p className="text-[12px] text-stone-600 mt-0.5 truncate">{bag.product_type}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="font-mono font-bold text-[14px] text-stone-800">{bag.weight_kg} kg</span>
          <button
            onClick={() => onPrint(bag)}
            className="ml-1 p-1.5 rounded-lg text-stone-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="Reprint label"
          >
            <Printer size={14} />
          </button>
          <button
            onClick={() => onRemove(bag.id)}
            className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Remove bag"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* meta row */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <span className="text-[11px] text-stone-500">Lot: <span className="font-medium text-stone-700">{bag.lot_number}</span></span>
        <span className="flex items-center gap-1 text-[11px] text-stone-400">
          <Clock size={11} />
          {formatTime(bag.created_at)}
        </span>
        {bag.acumaticaId && (
          <span className="font-mono text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
            {bag.acumaticaId}
          </span>
        )}
        {/* QC status pill */}
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
          QC: Pending
        </span>
      </div>
    </div>
  )
}
