'use client'
import React, { useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Info,
  Plus, Printer, Save, Package, PackageCheck, Scale, ClipboardCheck, Clock, Globe,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import ScanInput from '@/components/production/live/ScanInput'
import FormSheet from '@/components/production/live/FormSheet'
import CleaningChecklist from '@/components/production/live/CleaningChecklist'
import SectionGuide from '@/components/production/live/SectionGuide'
import { InputBagRow, OutputBagRow } from '@/components/production/live/BagRow'
import { printLabel } from '@/lib/production/label-print'
import {
  SECTION_CONFIG, SECTION_CODE_MAP,
  VARIANT_LABELS, GRADE_LABELS, BLENDER_INPUT_COLUMNS,
} from '@/lib/production/live-types'
import type { ScannedBag, OutputBag, Variant, Grade } from '@/lib/production/live-types'
import { getAcumaticaCode, getInputAcumaticaCode, formatCodeLabel } from '@/lib/production/acumatica-codes'

// ── SA Official Languages ─────────────────────────────────────────────────────
const SA_LANGS = [
  { code: 'en',  name: 'English',       native: 'English'     },
  { code: 'af',  name: 'Afrikaans',     native: 'Afrikaans'   },
  { code: 'zu',  name: 'Zulu',          native: 'isiZulu'     },
  { code: 'xh',  name: 'Xhosa',         native: 'isiXhosa'    },
  { code: 'st',  name: 'Southern Sotho',native: 'Sesotho'     },
  { code: 'tn',  name: 'Tswana',        native: 'Setswana'    },
  { code: 'ts',  name: 'Tsonga',        native: 'Xitsonga'    },
  { code: 'ss',  name: 'Swati',         native: 'siSwati'     },
  { code: 've',  name: 'Venda',         native: 'Tshivenda'   },
  { code: 'nso', name: 'Northern Sotho',native: 'Sepedi'      },
  { code: 'nr',  name: 'Ndebele',       native: 'isiNdebele'  },
]

// English source strings — also used as fallback when translation is loading
const EN_STRINGS: Record<string, string> = {
  inputs:          'Inputs',
  outputs:         'Outputs',
  totals:          'Totals',
  cleaning:        'Cleaning',
  timesheet:       'Timesheet',
  signoff:         'Sign-off',
  save:            'Save',
  saving:          'Saving…',
  saved:           'Saved',
  scanBag:         'Scan bag barcode…',
  scanIn:          'Scan in',
  registerBag:     'Register Incoming Bag',
  addOutput:       'Add Output Bag',
  sectionAccepts:  'Accepts',
  sectionProduces: 'Produces',
  guideTitle:      'How to capture',
  step1_scan:      'Scan all input bags into this session',
  step1_reg:       'Register each incoming farm bag',
  step2:           'Add all output bags produced this shift',
  step3:           'Complete the cleaning checklist',
  step4:           'Fill in the timesheet details',
  step5:           'Submit for supervisor sign-off',
  noInputsYet:     'No bags scanned yet',
  noInputsYetReg:  'No bags registered yet — tap Register to add the first bag',
  noOutputsYet:    'No output bags added yet',
  submitSignoff:   'Submit for sign-off',
  completeCleaning:'Complete cleaning first',
  approveSession:  'Approve & lock session',
  approving:       'Approving…',
  submitting:      'Submitting…',
  productType:     'Product Type',
  weight:          'Weight (kg)',
  lotNumber:       'Lot Number',
  batchNumber:     'Batch Number',
  variant:         'Variant',
  grade:           'Grade',
  generatePrint:   'Generate & Print',
  addBag:          'Add Bag',
  registerBagTitle:'Register Farm Bag',
  bagNotFound:     'Bag not found in system',
  registerBagBtn:  'Register bag',
  newOutputBag:    'New Output Bag',
  bagNo:           'Bag No. *',
  lotNo:           'Lot No. *',
  producerFarm:    'Producer / Farm',
  dateReceipt:     'Date of Receipt',
  leafShade:       'Leaf Shade',
  bulkDensity:     'Bulk Density',
  paLevel:         'PA Level',
  blendCode:       'Blend Code (Acumatica) *',
  comments:        'Comments (optional)',
  commentsPH:      'Any notes for the supervisor…',
  sessionApproved: 'Session approved and locked',
  sessionApprovedSub: 'No further changes can be made',
  sessionSubmitted: 'Submitted — awaiting supervisor approval',
  sessionSubmittedSub: 'A supervisor can approve this session from their device',
  cleaningIncomplete: 'Cleaning checklist incomplete',
  sessionSummary:  'Session summary',
  section:         'Section',
  operators:       'Operators',
  shift:           'Shift',
  balance:         'Balance',
  acumaticaCodes:  'Acumatica codes',
  saveSession:     'Save Session',
  saveTimesheet:   'Save timesheet',
  lineTimes:       'Line times',
  lineStart:       'Line start',
  lineStop:        'Line stop',
  downtime:        'Time not producing (minutes)',
  failureArea:     'Failure area',
  productionDetails: 'Production details',
  materialProduced: 'Material being produced',
  speedSetting:    'Speed setting',
  invertorSetting: 'Invertor setting',
  outputBreakdown: 'Output breakdown',
  balanceWarning:  'Balance exceeds 15 kg tolerance — please review inputs and outputs before submitting',
  blendRatio:      'Blend component ratio',
  debaggerSummary: 'Debagging column totals',
  bags:            'bags',
  bagsIn:          'Bags in',
  bagsOut:         'Bags out',
}

// ── Translation hook ──────────────────────────────────────────────────────────
function useTranslations(lang: string) {
  const [translations, setTranslations] = React.useState<Record<string, string>>(EN_STRINGS)
  const [translating, setTranslating] = React.useState(false)
  const cacheRef = React.useRef<Record<string, Record<string, string>>>({ en: EN_STRINGS })

  React.useEffect(() => {
    if (lang === 'en') { setTranslations(EN_STRINGS); return }
    if (cacheRef.current[lang]) { setTranslations(cacheRef.current[lang]); return }
    setTranslating(true)
    const langMeta = SA_LANGS.find(l => l.code === lang)
    fetch('/api/production/translate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ strings: EN_STRINGS, lang, langName: langMeta?.name ?? lang }),
    })
      .then(r => r.json())
      .then(({ translations: t }) => {
        cacheRef.current[lang] = t
        setTranslations(t)
      })
      .catch(() => setTranslations(EN_STRINGS))
      .finally(() => setTranslating(false))
  }, [lang])

  const t = (key: string) => translations[key] ?? EN_STRINGS[key] ?? key
  return { t, translating }
}

const INP = 'w-full px-3 py-3 min-h-[44px] rounded-xl border bg-white text-[14px] text-text outline-none transition-all border-stone-200 focus:border-brand focus:ring-2 focus:ring-brand/10'
const LBL = 'text-[10px] font-semibold text-stone-500 uppercase tracking-widest'

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'ok' | 'warn' | 'err' | 'info' }) {
  const cls = {
    ok:   'bg-stone-900 text-white',
    warn: 'bg-warn text-white',
    err:  'bg-err text-white',
    info: 'bg-info text-white',
  }[type]
  const Icon = type === 'ok' ? CheckCircle2 : type === 'info' ? Info : AlertTriangle
  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-xl text-[13px] font-semibold animate-in slide-in-from-top-2 duration-200 max-w-sm text-center ${cls}`}>
      <Icon size={15} className="flex-shrink-0" /> {msg}
    </div>
  )
}

// ── Pill selector (variant / grade) ──────────────────────────────────────────
function Pill<T extends string>({
  value, options, labels, onChange,
}: {
  value: T; options: T[]; labels?: Record<string, string>; onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`px-3 py-2 rounded-xl border font-medium text-[12px] transition-colors min-w-[60px] ${
            value === o
              ? 'bg-brand text-white border-brand'
              : 'bg-white text-stone-600 border-stone-200 hover:border-brand/50'
          }`}
        >
          <span className="font-mono font-bold block">{o}</span>
          {labels?.[o] && <span className="block text-[10px] opacity-70 leading-tight mt-0.5">{labels[o]}</span>}
        </button>
      ))}
    </div>
  )
}

// ── Main capture page ─────────────────────────────────────────────────────────
function CaptureInner() {
  const sp     = useSearchParams()
  const router = useRouter()
  const { user, role, isSupervisor, isIT } = useAuth()
  const canApprove = isSupervisor || isIT

  // Language
  const [lang, setLang] = React.useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('capture_lang')) || 'en'
  )
  const [showLangPicker, setShowLangPicker] = React.useState(false)
  const { t, translating } = useTranslations(lang)

  function handleLangChange(code: string) {
    setLang(code)
    localStorage.setItem('capture_lang', code)
    setShowLangPicker(false)
  }

  const sectionId      = sp.get('section')      ?? ''
  const shift          = sp.get('shift')        ?? 'morning'
  const dateParam      = sp.get('date')         ?? format(new Date(), 'yyyy-MM-dd')
  const sessionId      = sp.get('sessionId')    ?? crypto.randomUUID()
  const sessionLot     = sp.get('lot')          ?? ''
  const sessionVariant = (sp.get('variant')     ?? '') as Variant | ''

  // Operator params — support new dual-operator params with fallback to legacy single-operator params
  const primaryOperatorId    = sp.get('primaryOperatorId')   ?? sp.get('operatorId')   ?? ''
  const primaryOperatorName  = sp.get('primaryOperatorName') ?? sp.get('operatorName') ?? ''
  const secondaryOperatorId  = sp.get('secondaryOperatorId')   ?? ''
  const secondaryOperatorName = sp.get('secondaryOperatorName') ?? ''

  const cfg         = SECTION_CONFIG[sectionId]
  const sectionCode = SECTION_CODE_MAP[sectionId] ?? 'XX'

  const [inputs,  setInputs]  = useState<ScannedBag[]>([])
  const [outputs, setOutputs] = useState<OutputBag[]>([])
  const [tab,     setTab]     = useState<'inputs' | 'outputs' | 'totals' | 'cleaning' | 'timesheet' | 'signoff'>('inputs')
  const [toast,   setToast]   = useState<{ msg: string; type: 'ok'|'warn'|'err'|'info' } | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [sessionStatus, setSessionStatus] = useState<'draft'|'submitted'|'approved'>('draft')
  const [signoffComments, setSignoffComments] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Cleaning checklist progress — used for sign-off validation
  const [cleaningDone,  setCleaningDone]  = useState(0)
  const [cleaningTotal, setCleaningTotal] = useState(0)

  // Timesheet
  const [timesheet, setTimesheet] = useState({
    line_start: '',
    line_stop:  '',
    downtime_minutes: '',
    material_produced: '',
    speed_setting:     '',
    invertor_setting:  '',
    failure_areas: [] as string[],
  })

  // Blender: debagging vs bagging sub-tab
  const [blenderTab,          setBlenderTab]          = useState<'debagging' | 'bagging'>('debagging')
  const [blenderBaggingVisited, setBlenderBaggingVisited] = useState(false)

  // Stable refs for auto-save (avoids stale closures in event listeners)
  const inputsRef  = useRef<ScannedBag[]>([])
  const outputsRef = useRef<OutputBag[]>([])
  inputsRef.current  = inputs
  outputsRef.current = outputs

  // Register form (sieving — manual farm bag entry)
  const [showRegForm, setShowRegForm] = useState(false)
  const [regForm, setRegForm] = useState({
    bag_number: '', lot_number: '', producer: '',
    date_of_receipt: dateParam, weight_kg: '',
    grade: 'A' as Grade, variant: (sessionVariant || 'CON') as Variant,
    dry: false, third_party: false,
    leaf_shade: '', bulk_density: '', pa_level: 'Low',
  })

  // Granule dust inputs — one row per dust type, totals for the shift
  const [granuleDustInputs, setGranuleDustInputs] = useState<Array<{
    dustType: string; weight_kg: string; serial: string; variant: Variant
  }>>([
    { dustType: 'Brown Dust',        weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'White Dust',        weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'Indent Dust',       weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'ALT Dust',          weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'SG Dust',           weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'SF Dust',           weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'Powder Dust',       weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'Dust Extraction',   weight_kg: '', serial: '', variant: 'CON' },
    { dustType: 'Water',             weight_kg: '', serial: '', variant: 'CON' },
  ])

  // Unknown bag — shown when a scanned serial is not found in the system
  const [unknownSerial, setUnknownSerial] = useState<string | null>(null)
  const [unknownForm, setUnknownForm] = useState({
    product_type: '',
    weight_kg: '',
    variant: (sessionVariant || 'CON') as Variant,
    grade: 'A' as Grade,
    lot_number: '',
  })

  // Blend codes — loaded from Supabase for blender output form
  const [blendCodes, setBlendCodes] = React.useState<Array<{full_code: string; description: string; variant: string}>>([])
  const [blendCodesLoaded, setBlendCodesLoaded] = React.useState(false)

  // Load blend codes when section is blender
  React.useEffect(() => {
    if (sectionId !== 'blender' || blendCodesLoaded) return
    getDb().schema('production').from('blend_codes')
      .select('full_code, description, variant')
      .eq('active', true)
      .order('full_code')
      .then(({ data }: any) => {
        setBlendCodes(data ?? [])
        setBlendCodesLoaded(true)
      })
  }, [sectionId, blendCodesLoaded])

  // Output form
  const [showOutForm, setShowOutForm] = useState(false)
  const [outForm, setOutForm] = useState({
    product_type: cfg?.outputTypes[0] ?? '',
    weight_kg:    '',
    variant:      (sessionVariant || 'CON') as Variant,
    grade:        'A' as Grade,
    lot_number:   sessionLot,
  })

  // ── Auto-save on page hide / tab switch / screen lock ──────────────────────
  // Uses refs so the listener never reads stale state
  React.useEffect(() => {
    async function silentSave() {
      const ins  = inputsRef.current
      const outs = outputsRef.current
      if (ins.length === 0 && outs.length === 0) return
      const totalIn  = ins.reduce((s, b) => s + b.weight_kg, 0)
      const totalOut = outs.reduce((s, b) => s + b.weight_kg, 0)
      const ts = new window.Date().toISOString()
      try {
        await getDb().schema('production').from('prod_sessions').upsert({
          id: sessionId, section_id: sectionId,
          section_name: cfg?.name ?? sectionId,
          date: dateParam, shift, status: 'draft',
          operator_name_text: [primaryOperatorName, secondaryOperatorName].filter(Boolean).join(' + ') || undefined,
          lot_number: sessionLot || null,
          notes: JSON.stringify({ inputs: ins, outputs: outs }),
          updated_at: ts, created_at: ts,
        } as any, { onConflict: 'id' })
      } catch { /* silent */ }
    }
    document.addEventListener('visibilitychange', silentSave)
    window.addEventListener('pagehide', silentSave)
    return () => {
      document.removeEventListener('visibilitychange', silentSave)
      window.removeEventListener('pagehide', silentSave)
    }
  }, []) // stable — all values accessed via refs or captured from outer scope at mount

  function flash(msg: string, type: 'ok'|'warn'|'err'|'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  // Client-side serial: SECTION-DDMMYY-NNN
  // Ref-based counter increments across both input and output bags to avoid collisions.
  // Upgrade to DB sequence (production.serial_sequences) when ready.
  const serialCounterRef = useRef(0)
  function genSerial(): string {
    serialCounterRef.current++
    const d = format(new Date(dateParam + 'T12:00:00'), 'ddMMyy')
    return `${sectionCode}-${d}-${String(serialCounterRef.current).padStart(3, '0')}`
  }

  // ── Scan-in handler (non-sieving sections) ────────────────────────────────
  // autoFocus on ScanInput works with USB barcode scanners — the scanner acts as a
  // keyboard device and sends a Return/Enter keystroke after the barcode string.
  const handleScan = useCallback(async (serial: string) => {
    if (inputs.some(b => b.serial_number === serial)) {
      flash(`${serial} is already in this session`, 'warn')
      return
    }
    const { data, error } = await getDb().schema('production').from('bag_tags')
      .select('*').eq('serial_number', serial).maybeSingle()
    if (error || !data) {
      // Serial not in system yet — prompt operator to register it
      setUnknownSerial(serial)
      setUnknownForm(f => ({ ...f, lot_number: '', weight_kg: '', product_type: '' }))
      flash('Bag not found — please fill in the details below', 'warn')
      return
    }
    if (data.consumed_at_session && data.consumed_at_session !== sessionId) {
      flash(`Already used at ${data.consumed_at_section ?? 'another section'}`, 'warn')
    }
    setInputs(prev => [...prev, {
      id:             crypto.randomUUID(),
      serial_number:  data.serial_number,
      product_type:   data.product_type ?? '',
      variant:        data.variant      ?? null,
      grade:          data.qc_grade     ?? null,
      weight_kg:      parseFloat(data.weight_kg) || 0,
      lot_number:     data.lot_number   ?? null,
      section_id:     data.section_id   ?? '',
      scanned_at:     new Date().toISOString(),
    }])
    flash(`✓ ${data.product_type ?? serial} · ${data.weight_kg ?? '?'} kg`, 'ok')
  }, [inputs, sessionId])

  // ── Register farm bag (sieving only) ──────────────────────────────────────
  function handleRegisterBag() {
    if (!regForm.bag_number || !regForm.lot_number || !regForm.weight_kg) {
      flash('Bag No., Lot No. and Weight are required', 'warn')
      return
    }
    const serial = genSerial()
    const inputCode = getInputAcumaticaCode(regForm.grade, regForm.variant)
    const bag: ScannedBag = {
      id:             crypto.randomUUID(),
      serial_number:  serial,
      product_type:   '500kg Farm Bag',
      variant:        regForm.variant,
      grade:          regForm.grade,
      weight_kg:      parseFloat(regForm.weight_kg) || 0,
      lot_number:     regForm.lot_number,
      section_id:     sectionId,
      scanned_at:     new Date().toISOString(),
      acumaticaId:    inputCode?.inventoryId,
      acumaticaDesc:  inputCode?.description,
      raw: {
        bag_number:       regForm.bag_number,
        producer:         regForm.producer,
        date_of_receipt:  regForm.date_of_receipt,
        dry:              regForm.dry,
        third_party:      regForm.third_party,
        leaf_shade:       regForm.leaf_shade,
        bulk_density:     regForm.bulk_density,
        pa_level:         regForm.pa_level,
      },
    }
    setInputs(prev => [...prev, bag])
    setRegForm(f => ({ ...f, bag_number: '', producer: '', weight_kg: '', leaf_shade: '', bulk_density: '' }))
    setShowRegForm(false)
    flash(`Bag #${regForm.bag_number} registered as ${serial}`, 'ok')
  }

  // ── Register unknown scanned bag ─────────────────────────────────────────
  function handleRegisterUnknown() {
    if (!unknownSerial || !unknownForm.product_type || !unknownForm.weight_kg) {
      flash('Product type and weight are required', 'warn')
      return
    }
    const inputCode = getInputAcumaticaCode(unknownForm.grade, unknownForm.variant)
    const bag: ScannedBag = {
      id:            crypto.randomUUID(),
      serial_number: unknownSerial,
      product_type:  unknownForm.product_type,
      variant:       unknownForm.variant,
      grade:         unknownForm.grade,
      weight_kg:     parseFloat(unknownForm.weight_kg) || 0,
      lot_number:    unknownForm.lot_number || null,
      section_id:    sectionId,
      scanned_at:    new window.Date().toISOString(),
      acumaticaId:   inputCode?.inventoryId,
      acumaticaDesc: inputCode?.description,
    }
    setInputs(prev => [...prev, bag])
    setUnknownSerial(null)
    flash('Bag registered as ' + unknownSerial, 'ok')
  }

  // ── Add output bag ────────────────────────────────────────────────────────
  // Writes to bag_tags IMMEDIATELY so downstream sections can scan the serial
  // as soon as the label is printed — without waiting for the session Save.
  async function handleAddOutput() {
    if (!outForm.product_type || !outForm.weight_kg) {
      flash('Product type and weight are required', 'warn')
      return
    }
    if (sectionId === 'sieving' && !outForm.lot_number) {
      flash('Batch Number is required for sieving outputs', 'warn')
      return
    }
    const serial = genSerial()
    const acu = getAcumaticaCode(outForm.product_type, outForm.variant, outForm.grade)
    const now = new Date().toISOString()
    const bag: OutputBag = {
      id:            crypto.randomUUID(),
      serial_number: serial,
      product_type:  outForm.product_type,
      variant:       outForm.variant,
      grade:         outForm.grade,
      weight_kg:     parseFloat(outForm.weight_kg) || 0,
      lot_number:    outForm.lot_number || sessionLot,
      section_id:    sectionId,
      section_name:  cfg?.name ?? sectionId,
      created_at:    now,
      printed:       false,
      acumaticaId:   acu?.inventoryId,
      acumaticaDesc: acu?.description,
      phantomId:     acu?.phantomId,
    }

    // Write to bag_tags immediately so the next section can scan this serial
    // right after the label is printed — no need to wait for Save.
    try {
      await getDb().schema('production').from('bag_tags').upsert({
        serial_number:   bag.serial_number,
        section_id:      bag.section_id,
        section_name:    bag.section_name,
        product_type:    bag.product_type,
        variant:         bag.variant,
        qc_grade:        bag.grade,
        weight_kg:       bag.weight_kg,
        lot_number:      bag.lot_number,
        tag_date:        dateParam,
        prod_session_id: sessionId,
        captured_at:     now,
        status:          'in_stock',
        acumatica_id:    bag.acumaticaId    || null,
        destination:     bag.phantomId      || null,
      } as any, { onConflict: 'serial_number' })
    } catch {
      // Non-fatal — session Save will retry. Label still prints.
    }

    setOutputs(prev => [...prev, bag])
    setOutForm(f => ({ ...f, weight_kg: '', product_type: cfg?.outputTypes[0] ?? '' }))
    setShowOutForm(false)
    // Auto-print label
    printLabel(bag)
    setOutputs(prev => prev.map(b => b.id === bag.id ? { ...b, printed: true } : b))
    flash('Output bag added — label opening for print', 'info')
  }

  // ── Save session to Supabase ──────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      const now      = new Date().toISOString()
      const totalIn  = inputs.reduce((s, b) => s + b.weight_kg, 0)
      const totalOut = outputs.reduce((s, b) => s + b.weight_kg, 0)
      const balance  = totalIn - totalOut

      // Combine primary and secondary operator names for the session record
      const operatorText = [primaryOperatorName, secondaryOperatorName].filter(Boolean).join(' + ')

      // Upsert session record
      await getDb().schema('production').from('prod_sessions').upsert({
        id:                  sessionId,
        section_id:          sectionId,
        section_name:        cfg?.name ?? sectionId,
        date:                dateParam,
        shift,
        status:              'draft',
        operator_name_text:  operatorText,
        lot_number:          sessionLot || null,
        notes:               JSON.stringify({ inputs, outputs }),
        updated_at:          now,
        created_at:          now,
      } as any, { onConflict: 'id' })

      // Save output bag_tags — include Acumatica codes for production order linkage
      for (const b of outputs) {
        await getDb().schema('production').from('bag_tags').upsert({
          serial_number:   b.serial_number,
          section_id:      b.section_id,
          section_name:    b.section_name,
          product_type:    b.product_type,
          variant:         b.variant,
          qc_grade:        b.grade,
          weight_kg:       b.weight_kg,
          lot_number:      b.lot_number,
          tag_date:        dateParam,
          prod_session_id: sessionId,
          captured_at:     b.created_at,
          status:          'in_stock',
          acumatica_id:    b.acumaticaId    || null,
          destination:     b.phantomId      || null,   // phantom ID stored as destination for PO linkage
        } as any, { onConflict: 'serial_number' })
      }

      // Save raw material registrations (sieving only)
      for (const b of inputs.filter(x => x.raw)) {
        await getDb().schema('production').from('raw_material_bags').upsert({
          bag_number:      b.raw!.bag_number,
          lot_number:      b.lot_number ?? '',
          producer:        b.raw!.producer || null,
          date_of_receipt: b.raw!.date_of_receipt,
          grade:           b.grade ?? null,
          variant:         b.variant ?? null,
          dry:             b.raw!.dry,
          third_party:     b.raw!.third_party,
          weight_kg:       b.weight_kg,
          leaf_shade:      b.raw!.leaf_shade || null,
          bulk_density:    b.raw!.bulk_density || null,
          pa_level:        b.raw!.pa_level || null,
          serial_number:   b.serial_number,
          session_id:      sessionId,
          registered_by:   user?.id ?? null,
        } as any, { onConflict: 'serial_number' })
      }

      // Mark scanned input bags as consumed
      for (const b of inputs.filter(x => !x.raw)) {
        await getDb().schema('production').from('bag_tags')
          .update({
            consumed_at_session: sessionId,
            consumed_at_section: sectionId,
            consumed_weight_kg:  b.weight_kg,
          } as any)
          .eq('serial_number', b.serial_number)
      }

      // Scan events
      const events = [
        ...inputs.map(b => ({
          serial_number: b.serial_number,
          section_id:    sectionId,
          session_id:    sessionId,
          action:        'debagging_in',
          weight_kg:     b.weight_kg,
          operator_id:   user?.id ?? null,
          scanned_at:    b.scanned_at,
        })),
        ...outputs.map(b => ({
          serial_number: b.serial_number,
          section_id:    sectionId,
          session_id:    sessionId,
          action:        'bagging_out',
          weight_kg:     b.weight_kg,
          operator_id:   user?.id ?? null,
          scanned_at:    b.created_at,
        })),
      ]
      if (events.length > 0) {
        await getDb().schema('production').from('scan_events')
          .delete().eq('session_id', sessionId)
        await getDb().schema('production').from('scan_events').insert(events as any)
      }

      // Mass balance record
      await getDb().schema('production').from('prod_mass_balance').upsert({
        session_id:        sessionId,
        total_input_kg:    totalIn,
        total_output_b_kg: totalOut,
        balance_kg:        balance,
        within_tolerance:  Math.abs(balance) <= 15,
        calculated_at:     now,
      } as any, { onConflict: 'session_id' })

      // Timesheet record
      if (timesheet.line_start || timesheet.line_stop || timesheet.material_produced) {
        await getDb().schema('production').from('timesheets').upsert({
          session_id:        sessionId,
          section_id:        sectionId,
          date:              dateParam,
          shift,
          line_start:        timesheet.line_start   || null,
          line_stop:         timesheet.line_stop    || null,
          downtime_minutes:  timesheet.downtime_minutes ? parseInt(timesheet.downtime_minutes) : null,
          material_produced: timesheet.material_produced || null,
          speed_setting:     timesheet.speed_setting    || null,
          invertor_setting:  timesheet.invertor_setting || null,
          failure_areas:     timesheet.failure_areas.length > 0 ? timesheet.failure_areas : null,
          updated_at:        now,
        } as any, { onConflict: 'session_id' })
      }

      setSaved(true)
      setSessionStatus('draft')
      flash('Session saved successfully', 'ok')
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      flash('Save failed: ' + (e.message ?? 'unknown error'), 'err')
    }
    setSaving(false)
  }

  async function handleSubmit() {
    // Save first to make sure everything is persisted
    await handleSave()
    setSubmitting(true)
    try {
      const now = new window.Date().toISOString()
      await getDb().schema('production').from('prod_sessions').update({
        status:       'submitted',
        submitted_at: now,
        submitted_by: user?.id ?? null,
        updated_at:   now,
        ...(signoffComments ? { comments: signoffComments } : {}),
      } as any).eq('id', sessionId)
      setSessionStatus('submitted')
      flash('Session submitted — awaiting supervisor approval', 'ok')
    } catch (e: any) {
      flash('Submit failed: ' + (e.message ?? 'unknown error'), 'err')
    }
    setSubmitting(false)
  }

  async function handleApprove() {
    setSubmitting(true)
    try {
      const now = new window.Date().toISOString()
      await getDb().schema('production').from('prod_sessions').update({
        status:      'approved',
        approved_by: user?.id ?? null,
        approved_at: now,
        updated_at:  now,
      } as any).eq('id', sessionId)
      setSessionStatus('approved')
      flash('Session approved and locked', 'ok')
    } catch (e: any) {
      flash('Approve failed: ' + (e.message ?? 'unknown error'), 'err')
    }
    setSubmitting(false)
  }

  if (!cfg) return (
    <div className="flex items-center justify-center h-64 flex-col gap-3">
      <p className="text-err text-[14px]">No section selected.</p>
      <button onClick={() => router.back()} className="text-brand text-[13px] underline">← Go back</button>
    </div>
  )

  const totalIn    = inputs.reduce((s, b) => s + b.weight_kg, 0)
  const totalOut   = outputs.reduce((s, b) => s + b.weight_kg, 0)
  const balance    = totalIn - totalOut
  const balColor   = Math.abs(balance) <= 15 ? 'text-ok' : Math.abs(balance) <= 30 ? 'text-warn' : 'text-err'
  const balBg      = Math.abs(balance) <= 15 ? 'bg-ok/5 border-ok/20' : Math.abs(balance) <= 30 ? 'bg-warn/5 border-warn/20' : 'bg-err/5 border-err/20'

  // Output breakdown by product type
  const byType: Record<string, { count: number; kg: number }> = {}
  outputs.forEach(b => {
    if (!byType[b.product_type]) byType[b.product_type] = { count: 0, kg: 0 }
    byType[b.product_type].count++
    byType[b.product_type].kg += b.weight_kg
  })

  const locked = sessionStatus === 'approved'

  const cleaningPct = cleaningTotal > 0 ? Math.round((cleaningDone / cleaningTotal) * 100) : 0
  const tabs = [
    { id: 'inputs'    as const, label: `${t('inputs')} (${inputs.length})`,   icon: <Package size={15}/> },
    { id: 'outputs'   as const, label: `${t('outputs')} (${outputs.length})`, icon: <PackageCheck size={15}/> },
    { id: 'totals'    as const, label: t('totals'),                            icon: <Scale size={15}/> },
    { id: 'cleaning'  as const,
      label: cleaningPct === 100 ? `${t('cleaning')} ✓` : `${t('cleaning')}${cleaningPct > 0 ? ' ' + cleaningPct + '%' : ''}`,
      icon:  <ClipboardCheck size={15} className={cleaningPct === 100 ? 'text-ok' : ''}/> },
    { id: 'timesheet' as const, label: t('timesheet'), icon: <Clock size={15}/> },
    { id: 'signoff'   as const, label: t('signoff'),   icon: <CheckCircle2 size={15}/> },
  ]

  const VARIANTS: Variant[] = ['CON','ORG','RA CON','RA ORG']
  const GRADES:   Grade[]   = ['A','B','C']

  // Header operator display: "Primary · Secondary" (secondary omitted if absent)
  const operatorDisplay = [primaryOperatorName, secondaryOperatorName].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--color-surface)' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* Sticky header — tablet-optimised sizes */}
      <div className="bg-white border-b border-stone-200 px-4 py-3.5 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center">
          <ChevronLeft size={22} />
        </button>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: cfg.colorHex + '20', border: `1.5px solid ${cfg.colorHex}50` }}
        >
          <span className="font-mono font-bold text-[12px]" style={{ color: cfg.colorHex }}>{cfg.code}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[17px] text-text leading-tight">{cfg.name}</span>
            <span className="px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[12px] font-medium capitalize">{shift}</span>
            {sessionLot && (
              <span className="px-2.5 py-0.5 rounded-full bg-brand/10 text-brand text-[12px] font-mono font-semibold">{sessionLot}</span>
            )}
          </div>
          <div className="text-[13px] text-stone-400 truncate mt-0.5">{operatorDisplay}</div>
        </div>

        {/* Language picker */}
        <div className="relative">
          <button
            onClick={() => setShowLangPicker(p => !p)}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
            title="Change language"
          >
            {translating ? <Loader2 size={17} className="animate-spin"/> : <Globe size={17}/>}
          </button>
          {showLangPicker && (
            <>
              {/* Backdrop — closes picker on outside tap */}
              <div className="fixed inset-0 z-40" onClick={() => setShowLangPicker(false)} />
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-2xl shadow-2xl border border-stone-200 z-50 flex flex-col" style={{ maxHeight: 'min(340px, 70vh)' }}>
                <div className="px-3 pt-3 pb-1 flex-shrink-0">
                  <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Language / Taal</p>
                </div>
                <div className="overflow-y-auto py-1 flex-1">
                  {SA_LANGS.map(l => (
                    <button
                      key={l.code}
                      onClick={() => handleLangChange(l.code)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                        lang === l.code ? 'bg-brand/8 text-brand' : 'hover:bg-stone-50 text-stone-700'
                      }`}
                    >
                      <span className="text-[13px] font-medium">{l.native}</span>
                      <span className="text-[11px] text-stone-400">{l.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand text-white text-[14px] font-semibold disabled:opacity-40 hover:bg-brand-mid transition-colors min-h-[44px]"
        >
          {saving ? <Loader2 size={15} className="animate-spin"/> : saved ? <CheckCircle2 size={15}/> : <Save size={15}/>}
          {saving ? t('saving') : saved ? t('saved') : t('save')}
        </button>
      </div>

      {/* Tab bar — larger targets for tablet */}
      <div className="bg-white border-b border-stone-200 flex px-2 sticky top-[68px] z-10 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-3.5 font-medium text-[13px] border-b-2 transition-colors whitespace-nowrap min-h-[48px] ${
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-stone-400 hover:text-stone-600'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full space-y-4">

        {/* ════ INPUTS TAB ════════════════════════════════════════════════ */}
        {tab === 'inputs' && (
          <>
            {/* Inline section guide — replaces the old "Section Info" tab */}
            <SectionGuide
              sectionName={cfg.name}
              colorHex={cfg.colorHex}
              inputMode={cfg.inputMode}
              inputTypes={cfg.inputTypes}
              outputTypes={cfg.outputTypes}
              t={t}
            />

            {/* Blender sub-tabs: Debagging inputs vs Bagging outputs */}
            {sectionId === 'blender' && (
              <div className="flex gap-2 bg-stone-100 rounded-2xl p-1.5">
                <button
                  onClick={() => setBlenderTab('debagging')}
                  className={`flex-1 py-3 rounded-xl font-semibold text-[14px] transition-colors ${
                    blenderTab === 'debagging' ? 'bg-white text-brand shadow-sm' : 'text-stone-500'
                  }`}
                >
                  Debagging — Inputs
                </button>
                <button
                  onClick={() => { setBlenderTab('bagging'); setBlenderBaggingVisited(true) }}
                  className={`flex-1 py-3 rounded-xl font-semibold text-[14px] transition-colors ${
                    blenderTab === 'bagging' ? 'bg-white text-ok shadow-sm' : 'text-stone-500'
                  }`}
                >
                  Bagging — Outputs
                  {blenderBaggingVisited && outputs.length === 0 && (
                    <span className="ml-1.5 text-[11px] bg-warn/20 text-warn px-1.5 py-0.5 rounded-full">empty</span>
                  )}
                </button>
              </div>
            )}

            {/* Blender bagging sub-tab: output bags */}
            {sectionId === 'blender' && blenderTab === 'bagging' && (
              <>
                <button
                  onClick={() => setShowOutForm(true)}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] hover:opacity-90 transition-opacity"
                >
                  <Plus size={18}/> {t('addOutput')}
                </button>
                {outputs.length === 0 ? (
                  <div className="text-center py-12 text-stone-400 text-[14px]">No output bags added yet</div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[12px] font-semibold text-stone-500 uppercase tracking-wide">Bags out ({outputs.length})</span>
                      <span className="font-mono font-bold text-[14px] text-ok">{totalOut.toFixed(1)} kg</span>
                    </div>
                    {outputs.map(b => (
                      <OutputBagRow key={b.id} bag={b}
                        onPrint={bag => { printLabel(bag); setOutputs(prev => prev.map(x => x.id === bag.id ? {...x, printed: true} : x)) }}
                        onRemove={id => setOutputs(prev => prev.filter(x => x.id !== id))}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Standard inputs (hidden for blender when on bagging sub-tab) */}
            {(sectionId !== 'blender' || blenderTab === 'debagging') && (cfg.inputMode === 'register' ? (
              <>
                <button
                  onClick={() => setShowRegForm(f => !f)}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-[15px] text-white transition-colors hover:opacity-90"
                  style={{ background: cfg.colorHex }}
                >
                  <Plus size={18}/> {t('registerBag')}
                </button>

                {/* Register form — fixed FormSheet, not inline, so iOS keyboard never causes focus loss */}
                <FormSheet
                  open={showRegForm}
                  onClose={() => setShowRegForm(false)}
                  title={t('registerBagTitle')}
                  accentColor={cfg.colorHex}
                  footer={
                    <button onClick={handleRegisterBag}
                      className="w-full py-3.5 rounded-2xl text-white font-semibold text-[15px] hover:opacity-90 transition-opacity"
                      style={{ background: cfg.colorHex }}>
                      {t('addBag')}
                    </button>
                  }
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className={LBL}>Bag No. *</label>
                      <input className={INP} defaultValue={regForm.bag_number} placeholder="001"
                        onBlur={e => setRegForm(f => ({...f, bag_number: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Lot No. *</label>
                      <input className={INP} defaultValue={regForm.lot_number} placeholder="GS-2026-01"
                        onBlur={e => setRegForm(f => ({...f, lot_number: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Producer / Farm</label>
                      <input className={INP} defaultValue={regForm.producer} placeholder="Farm name"
                        onBlur={e => setRegForm(f => ({...f, producer: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Weight (kg) *</label>
                      <input type="text" inputMode="decimal" className={INP} defaultValue={regForm.weight_kg} placeholder="500"
                        onBlur={e => setRegForm(f => ({...f, weight_kg: e.target.value.replace(/[^0-9.]/g,'')}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Date of Receipt</label>
                      <input type="date" className={INP} defaultValue={regForm.date_of_receipt}
                        onBlur={e => setRegForm(f => ({...f, date_of_receipt: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Leaf Shade</label>
                      <input className={INP} defaultValue={regForm.leaf_shade} placeholder="e.g. Medium"
                        onBlur={e => setRegForm(f => ({...f, leaf_shade: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Bulk Density</label>
                      <input className={INP} defaultValue={regForm.bulk_density} placeholder="g/100ml"
                        onBlur={e => setRegForm(f => ({...f, bulk_density: e.target.value}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>PA Level</label>
                      <div className="flex gap-2">
                        {['Low','High'].map(v => (
                          <button key={v} type="button" onClick={() => setRegForm(f => ({...f, pa_level: v}))}
                            className={`flex-1 min-h-[44px] rounded-xl border text-[13px] font-medium transition-colors ${regForm.pa_level === v ? 'bg-brand text-white border-brand' : 'bg-white text-stone-600 border-stone-200'}`}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LBL}>Grade</label>
                    <Pill<Grade> value={regForm.grade} options={GRADES} labels={GRADE_LABELS} onChange={v => setRegForm(f => ({...f, grade: v}))}/>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LBL}>Variant</label>
                    <Pill<Variant> value={regForm.variant} options={VARIANTS} labels={VARIANT_LABELS} onChange={v => setRegForm(f => ({...f, variant: v}))}/>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                      <input type="checkbox" checked={regForm.dry} onChange={e => setRegForm(f => ({...f, dry: e.target.checked}))} className="w-5 h-5 rounded border-stone-300 accent-brand"/>
                      <span className="text-[14px] text-stone-700">Dry</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                      <input type="checkbox" checked={regForm.third_party} onChange={e => setRegForm(f => ({...f, third_party: e.target.checked}))} className="w-5 h-5 rounded border-stone-300 accent-brand"/>
                      <span className="text-[14px] text-stone-700">3rd Party</span>
                    </label>
                  </div>
                </FormSheet>
              </>
            ) : sectionId === 'granule' ? (
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <span className="font-semibold text-[13px] text-stone-700">Pellet Mill Feed — Shift Inputs</span>
                  <span className="text-[11px] text-stone-400 ml-2">Enter totals for this shift</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {granuleDustInputs.map((row, i) => {
                    const acu = getAcumaticaCode(row.dustType, row.variant, 'A')
                    return (
                      <div key={row.dustType} className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[13px] text-text">{row.dustType}</span>
                          {acu && <span className="font-mono text-[10px] text-stone-400">{acu.inventoryId}</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input type="text" inputMode="decimal" placeholder="kg" className={INP + ' text-center'}
                            value={row.weight_kg}
                            onChange={e => setGranuleDustInputs(prev => prev.map((r,j) => j===i ? {...r, weight_kg: e.target.value.replace(/[^0-9.]/g,'')} : r))}/>
                          <input type="text" placeholder="Serial No." className={INP}
                            value={row.serial}
                            onChange={e => setGranuleDustInputs(prev => prev.map((r,j) => j===i ? {...r, serial: e.target.value} : r))}/>
                          <select className={INP + ' cursor-pointer'} value={row.variant}
                            onChange={e => setGranuleDustInputs(prev => prev.map((r,j) => j===i ? {...r, variant: e.target.value as Variant} : r))}>
                            {(['CON','ORG','RA CON','RA ORG'] as Variant[]).map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-stone-600">Total</span>
                  <span className="font-mono font-bold text-[15px] text-sky-700">
                    {granuleDustInputs.reduce((s, r) => s + (parseFloat(r.weight_kg) || 0), 0).toFixed(1)} kg
                  </span>
                </div>
              </div>
            ) : (
              // autoFocus works with USB barcode scanners — scanner acts as a keyboard and sends Enter after the barcode string
              <>
                <ScanInput onScan={handleScan} placeholder={t('scanBag')} label={t('scanIn')} formOpen={showRegForm || showOutForm || !!unknownSerial} />

                {/* Unknown bag form — FormSheet overlay */}
                <FormSheet
                  open={!!unknownSerial}
                  onClose={() => setUnknownSerial(null)}
                  title={t('bagNotFound')}
                  accentColor="#b45309"
                  footer={
                    <button onClick={handleRegisterUnknown}
                      className="w-full py-3.5 rounded-2xl bg-amber-600 text-white font-semibold text-[15px] hover:opacity-90 transition-opacity">
                      {t('registerBagBtn')}
                    </button>
                  }
                >
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <span className="text-[12px] text-amber-700">Serial:</span>
                      <span className="font-mono text-[13px] font-bold text-amber-900">{unknownSerial}</span>
                    </div>
                    <p className="text-[12px] text-stone-500">Not in the system yet — fill in the details to register this bag.</p>
                    <div className="space-y-1.5">
                      <label className={LBL}>Product Type *</label>
                      <select className={INP + ' cursor-pointer'} value={unknownForm.product_type}
                        onChange={e => setUnknownForm(f => ({...f, product_type: e.target.value}))}>
                        <option value="">Select product type…</option>
                        {(cfg?.inputTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className={LBL}>Weight (kg) *</label>
                        <input type="text" inputMode="decimal" className={INP}
                          defaultValue={unknownForm.weight_kg} placeholder="e.g. 300"
                          onBlur={e => setUnknownForm(f => ({...f, weight_kg: e.target.value.replace(/[^0-9.]/g,'')}))}/>
                      </div>
                      <div className="space-y-1.5">
                        <label className={LBL}>Lot Number</label>
                        <input className={INP}
                          defaultValue={unknownForm.lot_number} placeholder="e.g. GS-2026-001"
                          onBlur={e => setUnknownForm(f => ({...f, lot_number: e.target.value}))}/>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Variant</label>
                      <Pill value={unknownForm.variant} options={(['CON','ORG','RA CON','RA ORG'] as Variant[])} labels={VARIANT_LABELS} onChange={v => setUnknownForm(f => ({...f, variant: v}))}/>
                    </div>
                    <div className="space-y-1.5">
                      <label className={LBL}>Grade</label>
                      <Pill value={unknownForm.grade} options={(['A','B','C'] as Grade[])} labels={GRADE_LABELS} onChange={v => setUnknownForm(f => ({...f, grade: v}))}/>
                    </div>
                  </div>
                </FormSheet>
              </>
            ))}

            {(sectionId !== 'blender' || blenderTab === 'debagging') && (inputs.length === 0 ? (
              <div className="text-center py-12 text-stone-400 text-[14px]">
                {cfg.inputMode === 'register' ? t('noInputsYetReg') : t('noInputsYet')}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12px] font-semibold text-stone-500 uppercase tracking-wide">Bags in ({inputs.length})</span>
                  <span className="font-mono font-bold text-[14px] text-sky-700">{totalIn.toFixed(1)} kg</span>
                </div>
                {inputs.map(b => (
                  <InputBagRow key={b.id} bag={b} onRemove={id => setInputs(prev => prev.filter(x => x.id !== id))}/>
                ))}
              </div>
            ))}

            {sectionId === 'blender' && blenderTab === 'debagging' && inputs.length > 0 && (() => {
              // Group inputs by column (A–F) for the debagging summary
              const cols: Record<string, {types: string[]; kg: number}> = {}
              inputs.forEach(b => {
                const col = BLENDER_INPUT_COLUMNS[b.product_type] ?? 'F'
                if (!cols[col]) cols[col] = { types: [], kg: 0 }
                if (!cols[col].types.includes(b.product_type)) cols[col].types.push(b.product_type)
                cols[col].kg += b.weight_kg
              })
              const total = Object.values(cols).reduce((s, c) => s + c.kg, 0)
              return (
                <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-stone-100 bg-purple-50">
                    <span className="font-semibold text-[13px] text-purple-800">Debagging column totals</span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {Object.entries(cols).sort().map(([col, { types, kg }]) => (
                      <div key={col} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <span className="font-mono font-bold text-[11px] text-purple-600 mr-2">({col})</span>
                          <span className="text-[12px] text-stone-600">{types.join(', ')}</span>
                        </div>
                        <span className="font-mono font-bold text-[13px] text-stone-800">{kg.toFixed(1)} kg</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50">
                      <span className="font-semibold text-[13px] text-stone-700">Total (I)</span>
                      <span className="font-mono font-bold text-[15px] text-purple-700">{total.toFixed(1)} kg</span>
                    </div>
                  </div>
                </div>
              )
            })()}

          </>
        )}

        {/* ════ OUTPUTS TAB ════════════════════════════════════════════════ */}
        {tab === 'outputs' && (
          <>
            <button
              onClick={() => setShowOutForm(f => !f)}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] hover:opacity-90 transition-opacity"
            >
              <Plus size={18}/> {t('addOutput')}
            </button>

            {/* Output form — fixed FormSheet overlay so iOS keyboard never causes focus loss */}
            <FormSheet
              open={showOutForm}
              onClose={() => setShowOutForm(false)}
              title={t('newOutputBag')}
              accentColor={cfg.colorHex}
              footer={
                <button onClick={handleAddOutput}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-ok text-white font-semibold text-[15px] hover:opacity-90 transition-opacity">
                  <Printer size={16}/> {t('generatePrint')}
                </button>
              }
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className={LBL}>{sectionId === 'blender' ? 'Blend Code (Acumatica) *' : 'Product Type *'}</label>
                  {sectionId === 'blender' ? (
                    <select className={INP + ' cursor-pointer'} value={outForm.product_type}
                      onChange={e => setOutForm(f => ({...f, product_type: e.target.value}))}>
                      <option value="">Select blend…</option>
                      {blendCodes.map(bc => (
                        <option key={bc.full_code} value={bc.full_code}>
                          {bc.full_code} — {bc.description}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select className={INP + ' cursor-pointer'} value={outForm.product_type}
                        onChange={e => setOutForm(f => ({...f, product_type: e.target.value}))}>
                        {cfg.outputTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        <option value="Other">Other (specify below)</option>
                      </select>
                      {outForm.product_type === 'Other' && (
                        <input className={INP + ' mt-2'} placeholder="Specify product type…"
                          onBlur={e => setOutForm(f => ({...f, product_type: e.target.value}))}/>
                      )}
                    </>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className={LBL}>Weight (kg) *</label>
                  <input type="text" inputMode="decimal" className={INP}
                    defaultValue={outForm.weight_kg} placeholder="e.g. 25.5"
                    onBlur={e => setOutForm(f => ({...f, weight_kg: e.target.value.replace(/[^0-9.]/g,'')}))}/>
                </div>
                <div className="space-y-1.5">
                  <label className={LBL}>{sectionId === 'sieving' ? 'Batch Number *' : 'Lot Number'}</label>
                  <input className={INP}
                    defaultValue={outForm.lot_number || sessionLot}
                    placeholder={sessionLot || 'e.g. GS-2026-001'}
                    onBlur={e => setOutForm(f => ({...f, lot_number: e.target.value}))}/>
                </div>
                <div className="space-y-1.5">
                  <label className={LBL}>Variant</label>
                  <Pill<Variant> value={outForm.variant} options={VARIANTS} labels={VARIANT_LABELS} onChange={v => setOutForm(f => ({...f, variant: v}))}/>
                </div>
                <div className="space-y-1.5">
                  <label className={LBL}>Grade</label>
                  <Pill<Grade> value={outForm.grade} options={GRADES} labels={GRADE_LABELS} onChange={v => setOutForm(f => ({...f, grade: v}))}/>
                </div>
                {sectionId !== 'blender' && (() => {
                  const liveCode = getAcumaticaCode(outForm.product_type, outForm.variant, outForm.grade)
                  if (!liveCode) return null
                  return (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl">
                      <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider flex-shrink-0">Acumatica</span>
                      <span className="font-mono text-[13px] font-bold text-stone-800">{liveCode.inventoryId}</span>
                      <span className="text-[11px] text-stone-500 flex-1 truncate">{liveCode.description}</span>
                    </div>
                  )
                })()}
              </div>
            </FormSheet>

            {outputs.length === 0 ? (
              <div className="text-center py-12 text-stone-400 text-[13px]">{t('noOutputsYet')}</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Bags out ({outputs.length})</span>
                  <span className="font-mono font-bold text-[13px] text-ok">{totalOut.toFixed(1)} kg</span>
                </div>
                {outputs.map(b => (
                  <OutputBagRow
                    key={b.id}
                    bag={b}
                    onPrint={bag => {
                      printLabel(bag)
                      setOutputs(prev => prev.map(x => x.id === bag.id ? {...x, printed: true} : x))
                    }}
                    onRemove={id => setOutputs(prev => prev.filter(x => x.id !== id))}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ════ TOTALS TAB ════════════════════════════════════════════════ */}
        {tab === 'totals' && (
          <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 text-center">
                <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-1">Total In</div>
                <div className="font-mono font-bold text-[22px] text-sky-700">{totalIn.toFixed(1)}</div>
                <div className="text-[10px] text-stone-400">kg</div>
              </div>
              <div className="bg-ok/5 border border-ok/20 rounded-2xl p-4 text-center">
                <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-1">Total Out</div>
                <div className="font-mono font-bold text-[22px] text-ok">{totalOut.toFixed(1)}</div>
                <div className="text-[10px] text-stone-400">kg</div>
              </div>
              <div className={`${balBg} border rounded-2xl p-4 text-center`}>
                <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-1">Balance</div>
                <div className={`font-mono font-bold text-[22px] ${balColor}`}>{Math.abs(balance).toFixed(1)}</div>
                <div className="text-[10px] text-stone-400">kg</div>
              </div>
            </div>

            {/* Tolerance warning */}
            {Math.abs(balance) > 15 && (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-warn/8 border border-warn/20 text-warn text-[12px]">
                <AlertTriangle size={14} className="flex-shrink-0"/>
                Balance exceeds 15 kg tolerance — please review inputs and outputs before submitting
              </div>
            )}

            {/* Output breakdown table */}
            {Object.keys(byType).length > 0 && (
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <span className="font-semibold text-[13px] text-stone-700">Output breakdown</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {Object.entries(byType).map(([type, { count, kg }]) => (
                    <div key={type} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-text">{type}</div>
                        <div className="text-[11px] text-stone-400">{count} bag{count !== 1 ? 's' : ''}</div>
                      </div>
                      <span className="font-mono font-bold text-[14px] text-ok">{kg.toFixed(1)} kg</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sectionId === 'blender' && inputs.length > 0 && (() => {
              const cols: Record<string, number> = {}
              inputs.forEach(b => {
                const col = BLENDER_INPUT_COLUMNS[b.product_type] ?? 'F'
                cols[col] = (cols[col] ?? 0) + b.weight_kg
              })
              const totalI = Object.values(cols).reduce((s, v) => s + v, 0)
              const colLabels: Record<string, string> = {
                A: 'Sieved Fine Leaf', B: 'Sieved Coarse Leaf',
                C: 'Blocks Clean', D: 'Blocks Cut / CHS',
                E: 'Other 1', F: 'Other 2',
              }
              return (
                <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-stone-100 bg-purple-50">
                    <span className="font-semibold text-[13px] text-purple-800">Blend component ratio</span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {Object.entries(cols).sort().map(([col, kg]) => {
                      const pct = totalI > 0 ? ((kg / totalI) * 100).toFixed(1) : '0.0'
                      return (
                        <div key={col} className="flex items-center px-4 py-2.5 gap-3">
                          <span className="font-mono font-bold text-[11px] text-purple-600 w-6">({col})</span>
                          <span className="flex-1 text-[12px] text-stone-600">{colLabels[col] ?? col}</span>
                          <span className="font-mono text-[12px] text-stone-700">{kg.toFixed(1)} kg</span>
                          <span className="font-mono font-bold text-[12px] text-purple-700 w-14 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50">
                      <span className="text-[12px] font-semibold text-stone-700">Total (I)</span>
                      <span className="font-mono font-bold text-[14px] text-purple-700">{totalI.toFixed(1)} kg</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-[12px] text-stone-600">Mass balance (G − I)</span>
                      <span className={`font-mono font-bold text-[13px] ${Math.abs(totalOut - totalI) <= 15 ? 'text-ok' : 'text-warn'}`}>
                        {(totalOut - totalI).toFixed(1)} kg
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || locked}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40 hover:bg-brand-mid transition-colors"
            >
              {saving ? <Loader2 size={18} className="animate-spin"/> : saved ? <CheckCircle2 size={18}/> : <Save size={18}/>}
              {saving ? t('saving') : saved ? `${t('saveSession')} ✓` : t('saveSession')}
            </button>
          </div>
        )}

        {/* ════ CLEANING TAB ══════════════════════════════════════════════ */}
        {tab === 'cleaning' && (
          <CleaningChecklist
            sectionId={sectionId}
            locked={locked}
            onProgress={(done, total) => { setCleaningDone(done); setCleaningTotal(total) }}
          />
        )}

        {/* ════ TIMESHEET TAB ═════════════════════════════════════════════ */}
        {tab === 'timesheet' && (() => {
          const FAILURE_AREAS = [
            'End of day','No feed material','Product change','Feed tank',
            'Conveyor','Main sieve','Screw conveyor','Aspirator','Bag filter',
            'Pasteuriser','Boiler','Drier heater','Drier shaker','Post sieve',
            'Bin shaker','Bagging unit','Bin stamper',
          ]
          const toggleFailure = (area: string) => {
            setTimesheet(prev => ({
              ...prev,
              failure_areas: prev.failure_areas.includes(area)
                ? prev.failure_areas.filter(a => a !== area)
                : [...prev.failure_areas, area],
            }))
          }
          return (
            <div className="space-y-5">
              {/* Line times */}
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <span className="font-semibold text-[13px] text-stone-700">Line times</span>
                </div>
                <div className="px-4 py-4 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className={LBL}>Line start</label>
                    <input
                      type="time"
                      className={INP}
                      defaultValue={timesheet.line_start}
                      onBlur={e => setTimesheet(p => ({...p, line_start: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LBL}>Line stop</label>
                    <input
                      type="time"
                      className={INP}
                      defaultValue={timesheet.line_stop}
                      onBlur={e => setTimesheet(p => ({...p, line_stop: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <label className={LBL}>Time not producing (minutes)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={INP}
                      defaultValue={timesheet.downtime_minutes}
                      placeholder="0"
                      onBlur={e => setTimesheet(p => ({...p, downtime_minutes: e.target.value.replace(/[^0-9]/g,'')}))}
                    />
                  </div>
                </div>
              </div>

              {/* Failure areas */}
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-stone-700">Failure area</span>
                  {timesheet.failure_areas.length > 0 && (
                    <span className="text-[11px] font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                      {timesheet.failure_areas.length} selected
                    </span>
                  )}
                </div>
                <div className="px-4 py-3 grid grid-cols-2 gap-2">
                  {FAILURE_AREAS.map(area => (
                    <button
                      key={area}
                      type="button"
                      onClick={() => toggleFailure(area)}
                      className={`text-left px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-colors min-h-[44px] ${
                        timesheet.failure_areas.includes(area)
                          ? 'bg-brand/10 border-brand text-brand'
                          : 'bg-white border-stone-200 text-stone-600 hover:border-brand/40'
                      }`}
                    >
                      {area}
                    </button>
                  ))}
                </div>
              </div>

              {/* Production details */}
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <span className="font-semibold text-[13px] text-stone-700">Production details</span>
                </div>
                <div className="px-4 py-4 space-y-3">
                  <div className="space-y-1.5">
                    <label className={LBL}>Material being produced</label>
                    <input
                      className={INP}
                      defaultValue={timesheet.material_produced}
                      placeholder="e.g. Fine Leaf Export CON"
                      onBlur={e => setTimesheet(p => ({...p, material_produced: e.target.value}))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LBL}>Speed setting</label>
                    <input
                      className={INP}
                      defaultValue={timesheet.speed_setting}
                      placeholder="e.g. 45 Hz"
                      onBlur={e => setTimesheet(p => ({...p, speed_setting: e.target.value}))}
                    />
                  </div>
                  {sectionId === 'pasteuriser' && (
                    <div className="space-y-1.5">
                      <label className={LBL}>Invertor setting</label>
                      <input
                        className={INP}
                        defaultValue={timesheet.invertor_setting}
                        placeholder="e.g. 35 Hz"
                        onBlur={e => setTimesheet(p => ({...p, invertor_setting: e.target.value}))}
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || locked}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40 hover:bg-brand-mid transition-colors"
              >
                {saving ? <Loader2 size={18} className="animate-spin"/> : saved ? <CheckCircle2 size={18}/> : <Save size={18}/>}
                {saving ? t('saving') : saved ? `${t('saved')} ✓` : t('saveTimesheet')}
              </button>
            </div>
          )
        })()}

        {/* ════ SIGN-OFF TAB ══════════════════════════════════════════════ */}
        {tab === 'signoff' && (
          <div className="space-y-4">

            {/* Status banner */}
            {sessionStatus === 'approved' && (
              <div className="flex items-center gap-3 px-4 py-4 bg-ok/8 border border-ok/30 rounded-2xl">
                <CheckCircle2 size={20} className="text-ok flex-shrink-0"/>
                <div>
                  <p className="font-semibold text-[14px] text-ok">{t('sessionApproved')}</p>
                  <p className="text-[11px] text-ok/70 mt-0.5">{t('sessionApprovedSub')}</p>
                </div>
              </div>
            )}
            {sessionStatus === 'submitted' && (
              <div className="flex items-center gap-3 px-4 py-4 bg-info/8 border border-info/30 rounded-2xl">
                <CheckCircle2 size={20} className="text-info flex-shrink-0"/>
                <div>
                  <p className="font-semibold text-[14px] text-info">{t('sessionSubmitted')}</p>
                  <p className="text-[11px] text-info/70 mt-0.5">{t('sessionSubmittedSub')}</p>
                </div>
              </div>
            )}

            {/* Cleaning validation — warn if checklist incomplete */}
            {cleaningTotal > 0 && cleaningDone < cleaningTotal && (
              <div className="flex items-start gap-3 px-4 py-4 bg-warn/8 border border-warn/30 rounded-2xl">
                <ClipboardCheck size={20} className="text-warn flex-shrink-0 mt-0.5"/>
                <div>
                  <p className="font-semibold text-[15px] text-warn">Cleaning checklist incomplete</p>
                  <p className="text-[13px] text-warn/80 mt-0.5">
                    {cleaningDone}/{cleaningTotal} tasks done — complete the Cleaning tab before submitting
                  </p>
                  <button
                    onClick={() => setTab('cleaning')}
                    className="mt-2 text-[13px] text-warn underline font-medium"
                  >
                    Go to Cleaning tab →
                  </button>
                </div>
              </div>
            )}

            {/* Session summary */}
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-stone-100 bg-stone-50">
                <span className="font-semibold text-[13px] text-stone-700">Session summary</span>
              </div>
              <div className="divide-y divide-stone-100">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-stone-600">Section</span>
                  <span className="font-medium text-[13px] text-text">{cfg?.name}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-stone-600">Operators</span>
                  <span className="font-medium text-[13px] text-text">
                    {[primaryOperatorName, secondaryOperatorName].filter(Boolean).join(' + ') || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-stone-600">Shift</span>
                  <span className="font-medium text-[13px] text-text capitalize">{shift}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-stone-600">Inputs</span>
                  <span className="font-mono font-bold text-[13px] text-sky-700">{inputs.length} bags · {totalIn.toFixed(1)} kg</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-stone-600">Outputs</span>
                  <span className="font-mono font-bold text-[13px] text-ok">{outputs.length} bags · {totalOut.toFixed(1)} kg</span>
                </div>
                <div className={`flex items-center justify-between px-4 py-3 ${Math.abs(balance) > 15 ? 'bg-warn/5' : ''}`}>
                  <span className="text-[13px] text-stone-600">Balance</span>
                  <span className={`font-mono font-bold text-[13px] ${balColor}`}>{Math.abs(balance).toFixed(1)} kg {Math.abs(balance) > 15 ? '⚠' : '✓'}</span>
                </div>
                {outputs.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2">Acumatica codes</p>
                    {Object.entries(byType).map(([type, { count, kg }]) => {
                      const acu = getAcumaticaCode(type, outForm.variant, outForm.grade)
                      return (
                        <div key={type} className="flex items-center justify-between py-1">
                          <span className="font-mono text-[11px] text-stone-500">{acu?.inventoryId ?? type}</span>
                          <span className="text-[11px] text-stone-400">{count} bags · {kg.toFixed(1)} kg</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Comments */}
            {!locked && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-widest">Comments (optional)</label>
                <textarea
                  value={signoffComments}
                  onChange={e => setSignoffComments(e.target.value)}
                  rows={3}
                  placeholder="Any notes for the supervisor…"
                  className="w-full px-3 py-3 rounded-xl border border-stone-200 bg-white text-[14px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 resize-none"
                />
              </div>
            )}

            {/* Submit button — operator */}
            {!locked && sessionStatus === 'draft' && (
              <button
                onClick={handleSubmit}
                disabled={submitting || inputs.length === 0 || (cleaningTotal > 0 && cleaningDone < cleaningTotal)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand text-white font-semibold text-[15px] disabled:opacity-40 hover:bg-brand-mid transition-colors"
              >
                {submitting ? <Loader2 size={18} className="animate-spin"/> : <CheckCircle2 size={18}/>}
                {submitting ? t('submitting') : cleaningTotal > 0 && cleaningDone < cleaningTotal ? t('completeCleaning') : t('submitSignoff')}
              </button>
            )}

            {/* Approve button — supervisor / IT only */}
            {canApprove && sessionStatus === 'submitted' && (
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-ok text-white font-semibold text-[15px] disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {submitting ? <Loader2 size={18} className="animate-spin"/> : <CheckCircle2 size={18}/>}
                {submitting ? t('approving') : t('approveSession')}
              </button>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

export default function CapturePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-stone-400"/>
      </div>
    }>
      <CaptureInner />
    </Suspense>
  )
}
