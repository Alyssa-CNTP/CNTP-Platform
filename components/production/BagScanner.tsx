'use client'

/**
 * BagScanner — three modes for filling a debagging row from a bag tag.
 *
 * Mode 1: QR / USB Scanner  — scans or types the serial number, looks up bag_tags in Supabase
 * Mode 2: Camera QR         — uses BarcodeDetector Web API (Android/Chrome) for QR scanning
 * Mode 3: OCR               — delegates to TagCapture (Gemini vision) for old paper tags
 *                             that don't have a QR code yet
 *
 * On success, calls onConfirm(ScanResult) which maps to the debagging row fields.
 */

import { useState, useRef, useEffect } from 'react'
import { getDb } from '@/lib/supabase/db'
import { parseSerial } from '@/lib/qr/serial'
import { Scan, Camera, X, Loader2, CheckCircle2, AlertTriangle, Keyboard, ScanLine } from 'lucide-react'
import TagCapture from '@/components/production/TagCapture'
import type { TagCaptureResult } from '@/components/production/TagCapture'

export interface ScanResult {
  serial_number: string
  product_type:  string | null
  lot_number:    string | null
  weight_kg:     string
  variant:       string | null
  local_export:  string | null
  tag_date:      string | null
  section_id:    string | null
  section_name:  string | null
}

interface BagScannerProps {
  rowLabel:     string
  sessionId?:   string | null
  sectionId?:   string
  sectionName?: string
  onConfirm:    (result: ScanResult) => void
  className?:   string
}

type ScanMode  = 'qr' | 'camera' | 'ocr'
type ScanState = 'idle' | 'input' | 'camera' | 'loading' | 'found' | 'notfound' | 'error'

const VARIANT_MAP: Record<string, string> = {
  'C': 'CON', 'O': 'ORG', 'RC': 'RA-CON', 'RO': 'RA-ORG',
  'Conventional': 'CON', 'Organic': 'ORG',
  'RA-Conventional': 'RA-CON', 'RA-Organic': 'RA-ORG',
}

export default function BagScanner({
  rowLabel, sessionId, sectionId = '', sectionName = '', onConfirm, className = ''
}: BagScannerProps) {
  const [state,      setState]      = useState<ScanState>('idle')
  const [mode,       setMode]       = useState<ScanMode>('qr')
  const [inputVal,   setInputVal]   = useState('')
  const [result,     setResult]     = useState<ScanResult | null>(null)
  const [errorMsg,   setErrorMsg]   = useState('')
  const [cameraSupp, setCameraSupp] = useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const db = getDb()

  useEffect(() => {
    const has = typeof window !== 'undefined' &&
      ('BarcodeDetector' in window || !!(typeof navigator !== 'undefined' && navigator?.mediaDevices?.getUserMedia))
    setCameraSupp(has)
  }, [])

  useEffect(() => {
    if (state === 'input' && mode === 'qr') {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [state, mode])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function close() {
    stopCamera()
    setState('idle')
    setInputVal('')
    setResult(null)
    setErrorMsg('')
  }

  async function lookupSerial(raw: string) {
    const serial = raw.trim().toUpperCase()
    if (!serial) return
    setState('loading')
    setErrorMsg('')
    try {
      const { data, error } = await db
        .schema('production')
        .from('bag_tags')
        .select('serial_number, product_type, lot_number, weight_kg, variant, tag_date, section_id, section_name, local_export')
        .eq('serial_number', serial)
        .maybeSingle()
      if (error) throw error
      if (data) {
        setResult({
          serial_number: data.serial_number,
          product_type:  data.product_type,
          lot_number:    data.lot_number,
          weight_kg:     String(data.weight_kg ?? ''),
          variant:       VARIANT_MAP[data.variant ?? ''] ?? data.variant,
          local_export:  (data as any).local_export ?? null,
          tag_date:      data.tag_date,
          section_id:    data.section_id,
          section_name:  data.section_name,
        })
        setState('found')
      } else {
        const parsed = parseSerial(serial)
        if (parsed) {
          setResult({ serial_number:serial, product_type:null, lot_number:null, weight_kg:'', variant:null, local_export:null, tag_date:null, section_id:null, section_name:null })
          setState('notfound')
          setErrorMsg('Serial format recognised but not yet saved in system. Fill remaining fields manually.')
        } else {
          setState('notfound')
          setErrorMsg(`"${serial}" is not a recognised CNTP serial format.`)
        }
      }
    } catch (err: any) {
      setState('error')
      setErrorMsg(err.message ?? 'Lookup failed — check connection')
    }
  }

  function handleOcrConfirm(ocr: TagCaptureResult) {
    onConfirm({
      serial_number: ocr.serial_number || '',
      product_type:  ocr.product_type  || null,
      lot_number:    ocr.lot_number    || null,
      weight_kg:     ocr.weight_kg     || '',
      variant:       VARIANT_MAP[ocr.variant ?? ''] ?? ocr.variant ?? null,
      local_export:  null,
      tag_date:      ocr.tag_date      || null,
      section_id:    null,
      section_name:  null,
    })
    close()
  }

  async function startCamera() {
    setState('camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        let active = true
        async function detect() {
          if (!active || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length) { active = false; stopCamera(); await lookupSerial(codes[0].rawValue); return }
          } catch {}
          requestAnimationFrame(detect)
        }
        requestAnimationFrame(detect)
      } else {
        stopCamera(); setMode('qr'); setState('input')
      }
    } catch {
      setState('error')
      setErrorMsg('Camera access denied. Use USB scanner or OCR instead.')
    }
  }

  function confirmResult() {
    if (result) { onConfirm(result); close() }
  }

  if (state === 'idle') {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <button onClick={() => { setMode('qr'); setState('input') }}
          title="Scan or enter bag serial"
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-[11px] font-medium hover:bg-purple-100 transition-colors">
          <Scan size={12}/> Scan
        </button>
        {cameraSupp && (
          <button onClick={() => { setMode('camera'); startCamera() }}
            title="Camera QR scan"
            className="w-6 h-6 flex items-center justify-center rounded-lg border border-stone-200 text-stone-400 hover:border-purple-200 hover:text-purple-600 transition-colors">
            <Camera size={11}/>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) close() }}>
      <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl overflow-hidden shadow-2xl">

        <div className="flex items-center justify-between px-4 py-3 bg-purple-50 border-b border-purple-100">
          <div className="flex items-center gap-2">
            <ScanLine size={16} className="text-purple-600"/>
            <div>
              <p className="font-semibold text-[13px] text-purple-900">Scan bag tag</p>
              <p className="font-mono text-[10px] text-purple-400">{rowLabel}</p>
            </div>
          </div>
          <button onClick={close} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-purple-100">
            <X size={15} className="text-purple-600"/>
          </button>
        </div>

        {state === 'input' && (
          <div className="flex border-b border-stone-100">
            {([
              { id:'qr'  as ScanMode, icon:<Scan size={12}/>,     label:'USB / Serial'   },
              ...(cameraSupp ? [{ id:'camera' as ScanMode, icon:<Camera size={12}/>,   label:'Camera' }] : []),
              { id:'ocr' as ScanMode, icon:<ScanLine size={12}/>, label:'OCR (paper tag)'},
            ]).map(tab => (
              <button key={tab.id}
                onClick={() => { setMode(tab.id); if (tab.id === 'camera') startCamera() }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors border-b-2 ${
                  mode === tab.id ? 'border-purple-500 text-purple-700' : 'border-transparent text-stone-400 hover:text-stone-600'
                }`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="p-4 space-y-3">

          {state === 'camera' && (
            <div className="space-y-3">
              <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline/>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-44 h-44 border-2 border-white rounded-xl opacity-70"/>
                </div>
                <p className="absolute bottom-2 left-0 right-0 text-center text-white text-[10px] opacity-60">Point at QR code</p>
              </div>
              <button onClick={() => { stopCamera(); setMode('qr'); setState('input') }}
                className="w-full py-2 rounded-xl border border-stone-200 text-[12px] text-stone-500 hover:bg-stone-50">
                <Keyboard size={12} className="inline mr-1"/>Switch to manual entry
              </button>
            </div>
          )}

          {state === 'input' && mode === 'qr' && (
            <div className="space-y-3">
              <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2">
                <p className="text-[11px] text-purple-700 font-medium">USB scanner or manual entry</p>
                <p className="text-[10px] text-purple-400 mt-0.5">Click the field, scan QR with USB scanner — it types automatically. Or enter serial manually.</p>
              </div>
              <input ref={inputRef} value={inputVal}
                onChange={e => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupSerial(inputVal) }}}
                placeholder="e.g. FL-280426-001 or 08-04-26/1-02"
                className="w-full px-4 py-3 rounded-xl border-2 border-purple-200 font-mono text-[14px] text-stone-800 outline-none focus:border-purple-500 transition-all placeholder:text-stone-300"
                autoComplete="off" spellCheck={false} autoCapitalize="characters"/>
              <button onClick={() => lookupSerial(inputVal)} disabled={!inputVal.trim()}
                className="w-full py-3 rounded-xl bg-purple-600 text-white font-semibold text-[14px] disabled:opacity-40 hover:bg-purple-700 transition-colors">
                Look up bag record
              </button>
            </div>
          )}

          {state === 'input' && mode === 'ocr' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-amber-700 font-medium">OCR — for paper tags without a QR code</p>
                <p className="text-[10px] text-amber-500 mt-0.5">Takes a photo of the paper bag tag and reads the fields using AI vision. Use this for older bags or when a QR scan fails.</p>
              </div>
              <TagCapture
                sectionId={sectionId}
                sectionName={sectionName}
                rowLabel={rowLabel}
                sessionId={sessionId ?? null}
                onConfirm={handleOcrConfirm}
              />
              <p className="text-[10px] text-stone-400 text-center">Click the button above to photograph the paper tag</p>
            </div>
          )}

          {state === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={28} className="text-purple-500 animate-spin"/>
              <p className="text-[13px] text-stone-500">Looking up bag record…</p>
            </div>
          )}

          {state === 'found' && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-ok/8 border border-ok/30 rounded-xl">
                <CheckCircle2 size={15} className="text-ok flex-shrink-0"/>
                <div>
                  <p className="font-semibold text-[12px] text-ok">Bag found in system</p>
                  {result.section_name && <p className="text-[10px] text-ok/70">From: {result.section_name}</p>}
                </div>
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <tbody className="divide-y divide-stone-100">
                    {([
                      ['Serial',  result.serial_number,                                true],
                      ['Product', result.product_type,                                 false],
                      ['Lot',     result.lot_number,                                   true],
                      ['Weight',  result.weight_kg ? `${result.weight_kg} kg` : null, true],
                      ['Variant', result.variant,                                      false],
                      ['Tagged',  result.tag_date,                                     false],
                    ] as [string,string|null,boolean][]).filter(([,v])=>v).map(([label,value,mono])=>(
                      <tr key={label}>
                        <td className="px-3 py-2 text-stone-400 font-medium w-20">{label}</td>
                        <td className={`px-3 py-2 font-semibold ${mono?'font-mono':''} ${label==='Weight'?'text-emerald-700':'text-stone-800'}`}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={confirmResult}
                className="w-full py-3 rounded-xl bg-ok text-white font-semibold text-[14px] hover:bg-emerald-600 transition-colors">
                ✓ Use this bag
              </button>
              <button onClick={() => { setState('input'); setResult(null) }}
                className="w-full py-2 rounded-xl border border-stone-200 text-stone-400 text-[12px] hover:bg-stone-50">
                Scan a different bag
              </button>
            </div>
          )}

          {state === 'notfound' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-warn/8 border border-warn/30 rounded-xl">
                <AlertTriangle size={15} className="text-warn flex-shrink-0 mt-0.5"/>
                <p className="text-[12px] text-warn">{errorMsg || 'Bag not found in system'}</p>
              </div>
              {result && (
                <button onClick={confirmResult}
                  className="w-full py-2.5 rounded-xl border border-warn/40 bg-warn/10 text-warn font-semibold text-[13px]">
                  Use serial anyway — fill rest manually
                </button>
              )}
              <button onClick={() => { setState('input'); setResult(null); setErrorMsg('') }}
                className="w-full py-2 rounded-xl border border-stone-200 text-stone-500 text-[12px] hover:bg-stone-50">
                Try again
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-err/8 border border-err/30 rounded-xl">
                <AlertTriangle size={15} className="text-err flex-shrink-0 mt-0.5"/>
                <p className="text-[12px] text-err">{errorMsg}</p>
              </div>
              <button onClick={() => { setState('input'); setErrorMsg('') }}
                className="w-full py-2 rounded-xl border border-stone-200 text-stone-500 text-[12px] hover:bg-stone-50">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}