'use client'

// app/scan/[barcode]/page.tsx
// Public, multi-language customer scan page.
// No auth required — RLS lets `anon` SELECT logistics.units / logistics.batches / logistics.suppliers.
//
// Language is chosen in this priority:
//   1. ?lang=xx URL parameter (lets the customer override)
//   2. The intended customer's language_pref on the unit
//   3. Browser navigator.language
//   4. 'en' fallback
//
// Translation goes through lib/i18n/translations.ts (4 SA languages today).
// Add more languages by extending that file — this page picks them up automatically.

import { useEffect, useState, use } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { translate, LANGUAGES, LANGUAGE_META, type Language } from '@/lib/i18n/translations'
import { ScanLine, Loader2, Globe, Leaf, MapPin, Calendar, AlertCircle, ShieldCheck } from 'lucide-react'
import { format } from 'date-fns'

interface UnitView {
  id:              string
  barcode:         string
  product_type:    string | null
  variant:         string | null
  weight_kg:       number | null
  current_stage:   string
  status:          string
  arrived_at:      string
  departed_at:     string | null
  acumatica_lot_id:string | null
  batch?: {
    batch_code:       string | null
    lot_number:       string | null
    harvest_date:     string | null
    expiry_date:      string | null
    certified_organic:boolean | null
    pesticide_notes:  string | null
  } | null
  supplier?: { name: string; country: string | null } | null
  customer?: { name: string; language_pref: Language } | null
}

function pickLang(urlLang: string | null, customerLang: Language | null | undefined): Language {
  if (urlLang && (LANGUAGES as readonly string[]).includes(urlLang)) return urlLang as Language
  if (customerLang && (LANGUAGES as readonly string[]).includes(customerLang)) return customerLang
  if (typeof window !== 'undefined') {
    const code = (navigator.language || 'en').slice(0, 2)
    if ((LANGUAGES as readonly string[]).includes(code)) return code as Language
  }
  return 'en'
}

export default function PublicScanPage({ params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = use(params)
  const [unit, setUnit]       = useState<UnitView | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [lang, setLang]       = useState<Language>('en')

  useEffect(() => {
    const url = new URL(window.location.href)
    const urlLang = url.searchParams.get('lang')

    void (async () => {
      setLoading(true)
      try {
        const db = getSupabaseClient()
        const { data, error } = await db.schema('logistics' as any).from('units').select(`
          id, barcode, product_type, variant, weight_kg, current_stage, status,
          arrived_at, departed_at, acumatica_lot_id,
          batch:batch_id ( batch_code, lot_number, harvest_date, expiry_date, certified_organic, pesticide_notes ),
          supplier:supplier_id ( name, country ),
          customer:customer_id ( name, language_pref )
        `).eq('barcode', decodeURIComponent(barcode)).maybeSingle()

        if (error) console.error('[scan] query error', error)
        if (!data) { setNotFound(true); return }
        setUnit(data as UnitView)
        setLang(pickLang(urlLang, (data as any)?.customer?.language_pref))
      } finally {
        setLoading(false)
      }
    })()
  }, [barcode])

  const t = (key: string) => translate(lang, key)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    )
  }

  if (notFound || !unit) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold text-stone-800">{t('Not found')}</h1>
        <p className="text-sm text-stone-500 mt-1">{t('No product matches this code')}</p>
        <p className="text-xs text-stone-400 mt-3 font-mono">{decodeURIComponent(barcode)}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-emerald-700 text-white">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="w-5 h-5" />
              <span className="text-sm font-medium opacity-90">CNTP {t('Rooibos')}</span>
            </div>
            <LanguageSwitcher lang={lang} onChange={setLang} />
          </div>
          <h1 className="text-2xl font-semibold mt-3">{unit.product_type ?? t('Product')}</h1>
          <div className="text-sm opacity-90 mt-0.5">
            {unit.variant ?? ''}{unit.weight_kg ? ` · ${unit.weight_kg} kg` : ''}
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs bg-white/10 rounded-md px-2 py-1 font-mono">
            <ScanLine className="w-3 h-3" /> {unit.barcode}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Origin */}
        <Section title={t('Origin')} icon={MapPin}>
          <Row label={t('Supplier')}     value={unit.supplier?.name ?? '—'} />
          <Row label={t('Country')}      value={unit.supplier?.country ?? '—'} />
          <Row label={t('Harvest date')} value={fmtDate(unit.batch?.harvest_date)} />
          <Row label={t('Batch')}        value={<span className="font-mono">{unit.batch?.batch_code ?? '—'}</span>} />
          {unit.batch?.lot_number && (
            <Row label={t('Lot number')} value={<span className="font-mono">{unit.batch.lot_number}</span>} />
          )}
        </Section>

        {/* Quality */}
        <Section title={t('Quality & certification')} icon={ShieldCheck}>
          <Row label={t('Expiry date')} value={fmtDate(unit.batch?.expiry_date)} />
          <Row label={t('Certified organic')}
               value={unit.batch?.certified_organic === true ? `✓ ${t('Yes')}` :
                      unit.batch?.certified_organic === false ? t('No') : '—'} />
          {unit.batch?.pesticide_notes && (
            <div className="text-sm text-stone-700 mt-2 italic">{unit.batch.pesticide_notes}</div>
          )}
        </Section>

        {/* Journey */}
        <Section title={t('Journey')} icon={Calendar}>
          <Row label={t('Received')}   value={fmtDateTime(unit.arrived_at)} />
          {unit.departed_at && (
            <Row label={t('Dispatched')} value={fmtDateTime(unit.departed_at)} />
          )}
          <Row label={t('Current stage')} value={t(stageLabel(unit.current_stage))} />
          {unit.customer && (
            <Row label={t('Intended customer')} value={unit.customer.name} />
          )}
        </Section>

        <footer className="text-center text-xs text-stone-400 pt-4 pb-8">
          <Globe className="w-3 h-3 inline mr-1" />
          {t('Powered by CNTP barcode operations')}
        </footer>
      </main>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-3 flex items-center gap-1.5">
        <Icon className="w-3 h-3" /> {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-stone-500 shrink-0">{label}</span>
      <span className="text-stone-900 text-right">{value}</span>
    </div>
  )
}

function LanguageSwitcher({ lang, onChange }: { lang: Language; onChange: (l: Language) => void }) {
  return (
    <select
      value={lang}
      onChange={e => onChange(e.target.value as Language)}
      className="bg-white/10 text-white text-xs rounded-md px-2 py-1 border border-white/20"
    >
      {LANGUAGES.map(l => (
        <option key={l} value={l} className="text-stone-900">
          {LANGUAGE_META[l].nativeName}
        </option>
      ))}
    </select>
  )
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  try { return format(new Date(d), 'd MMM yyyy') } catch { return d }
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—'
  try { return format(new Date(d), 'd MMM yyyy HH:mm') } catch { return d }
}

function stageLabel(s: string): string {
  const map: Record<string, string> = {
    received:           'Received at warehouse',
    in_process:         'In production',
    finished:           'Finished product',
    picked:             'Picked for order',
    loaded:             'Loaded for shipping',
    dispatched:         'Dispatched',
    customer_received:  'Delivered to customer',
  }
  return map[s] ?? s
}
