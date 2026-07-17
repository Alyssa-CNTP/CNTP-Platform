'use client'

// components/stock-control/PrintersModule.tsx
//
// Printers module (lives inside the Stock Control page under Operations).
// Assign a networked label printer to each production section. Edits save to
// production.printers; the print API reads that table (≈30s cache), so changes
// take effect within about half a minute without any code change.

import { useEffect, useState, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { SECTION_ORDER, sectionMeta, SECTION_PRINTER, KNOWN_PRINTERS, type PrinterLang } from '@/lib/production/capture-config'
import { Printer, Check, Loader2, Wifi, Info } from 'lucide-react'

interface Row {
  section_id: string
  printer_name: string
  ip: string
  port: number
  lang: PrinterLang
  enabled: boolean
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

function seedRow(sectionId: string): Row {
  const def = SECTION_PRINTER[sectionId]
  return {
    section_id: sectionId,
    printer_name: '',
    ip: def?.ip ?? '',
    port: def?.port ?? 9100,
    lang: def?.lang ?? 'zpl',
    enabled: true,
  }
}

export default function PrintersModule() {
  const { user } = useAuth()
  const [rows, setRows]       = useState<Record<string, Row>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [tests, setTests]     = useState<Record<string, TestState>>({})
  const [testMsg, setTestMsg] = useState<Record<string, string>>({})

  // Load existing rows, seeding any missing section from the code defaults.
  useEffect(() => {
    (async () => {
      const seeded: Record<string, Row> = {}
      SECTION_ORDER.forEach(id => { seeded[id] = seedRow(id) })
      try {
        const { data } = await getDb().schema('production').from('printers').select('*')
        for (const r of (data ?? []) as any[]) {
          seeded[r.section_id] = {
            section_id: r.section_id,
            printer_name: r.printer_name ?? '',
            ip: r.ip ?? '',
            port: r.port ?? 9100,
            lang: r.lang === 'pplb' ? 'pplb' : 'zpl',
            enabled: r.enabled !== false,
          }
        }
      } catch { /* table may not exist yet — fall back to seeds */ }
      setRows(seeded)
      setLoading(false)
    })()
  }, [])

  const update = useCallback((id: string, patch: Partial<Row>) => {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setSaved(false)
  }, [])

  // Picking a known printer fills IP + language (and the name, if still blank).
  const selectKnown = useCallback((id: string, knownId: string) => {
    setSaved(false)
    if (knownId === 'custom') return
    const kp = KNOWN_PRINTERS.find(k => k.id === knownId)
    if (!kp) return
    setRows(prev => {
      const cur = prev[id]
      return { ...prev, [id]: { ...cur, ip: kp.ip, lang: kp.lang, printer_name: cur.printer_name || kp.label } }
    })
  }, [])

  async function saveAll() {
    setSaving(true)
    setSaved(false)
    const now = new Date().toISOString()
    const payload = Object.values(rows).map(r => ({
      section_id: r.section_id,
      printer_name: r.printer_name,
      ip: r.ip.trim(),
      port: Number(r.port) || 9100,
      lang: r.lang,
      enabled: r.enabled,
      updated_at: now,
      updated_by: user?.id ?? null,
    }))
    try {
      await getDb().schema('production').from('printers').upsert(payload, { onConflict: 'section_id' })
      setSaved(true)
    } catch (e) {
      alert('Save failed: ' + (e instanceof Error ? e.message : String(e)))
    }
    setSaving(false)
  }

  async function testPrint(r: Row) {
    setTests(prev => ({ ...prev, [r.section_id]: 'testing' }))
    setTestMsg(prev => ({ ...prev, [r.section_id]: '' }))
    try {
      const res = await fetch('/api/print/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: r.ip.trim(), lang: r.lang, port: Number(r.port) || 9100, sectionName: sectionMeta(r.section_id).name }),
      })
      if (res.ok) {
        setTests(prev => ({ ...prev, [r.section_id]: 'ok' }))
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Unknown error' }))
        setTests(prev => ({ ...prev, [r.section_id]: 'fail' }))
        setTestMsg(prev => ({ ...prev, [r.section_id]: error }))
      }
    } catch (e) {
      setTests(prev => ({ ...prev, [r.section_id]: 'fail' }))
      setTestMsg(prev => ({ ...prev, [r.section_id]: e instanceof Error ? e.message : String(e) }))
    }
  }

  if (loading) {
    return <div className="py-8 font-mono text-[11px] uppercase tracking-widest text-text-muted animate-pulse">Loading printers…</div>
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[18px] font-bold text-text flex items-center gap-2">
            <Printer size={18} /> Printers
          </h2>
          <p className="text-[13px] text-text-muted mt-1 max-w-2xl">
            Assign a label printer to each production section. Output tags print only to the printer
            assigned to their section. Changes save to the server and take effect within about 30 seconds —
            no code change needed.
          </p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="shrink-0 inline-flex items-center gap-2 bg-brand text-white rounded-xl px-5 py-2.5 text-[14px] font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-brand/20 bg-brand/5 p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text mb-2">
          <Info size={15} /> About
        </div>
        <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-text-muted">
          <li>The section→printer binding lives server-side in a <span className="font-mono text-[12px]">production.printers</span> table.</li>
          <li>When a tag prints, the client sends only the bag; the server reads the tag&apos;s own <span className="font-mono text-[12px]">section_id</span> and routes to only that section&apos;s printer. No printer picker, no OS dialog — operators can&apos;t redirect anywhere.</li>
          <li>Edits here take effect within ~30 seconds (the print route reads the table through a short cache) — no redeploy.</li>
        </ul>
        <div className="text-[13px] font-semibold text-text mt-3 mb-1">Both printer languages, from one config</div>
        <p className="text-[13px] text-text-muted">
          ZPL for the Zebra ZD230, PPLB/EPL2 for the Argox — both reproduce the existing 100×50mm tag.
          Each section has its own IP, so you can set unique printers per section and mix brands freely.
          Several sections may also share the same printer — just pick the same one.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {SECTION_ORDER.map(id => {
          const r = rows[id]
          if (!r) return null
          const meta = sectionMeta(id)
          const test = tests[id] ?? 'idle'
          const selectedKnown = KNOWN_PRINTERS.find(k => k.ip === r.ip && k.lang === r.lang)?.id ?? 'custom'
          return (
            <div key={id} className="border border-surface-rule rounded-2xl bg-surface-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-white text-[12px] font-bold" style={{ background: meta.colorHex }}>
                  {meta.code}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-text">{meta.name}</div>
                  <div className="text-[11px] text-text-muted font-mono">{id}</div>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-text-muted cursor-pointer">
                  <input type="checkbox" checked={r.enabled} onChange={e => update(id, { enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              <div className="mb-3">
                <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1">Assigned printer</div>
                <select value={selectedKnown} onChange={e => selectKnown(id, e.target.value)} className={inputCls}>
                  {KNOWN_PRINTERS.map(k => (
                    <option key={k.id} value={k.id}>{k.label}{k.ip ? ` — ${k.ip}` : ''}</option>
                  ))}
                  <option value="custom">Custom / manual…</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <Field label="Printer name" className="sm:col-span-4">
                  <input value={r.printer_name} onChange={e => update(id, { printer_name: e.target.value })}
                    placeholder="e.g. D5J261603773" className={inputCls} />
                </Field>
                <Field label="IP address" className="sm:col-span-3">
                  <input value={r.ip} onChange={e => update(id, { ip: e.target.value })}
                    placeholder="192.168.0.115" className={`${inputCls} font-mono`} />
                </Field>
                <Field label="Port" className="sm:col-span-2">
                  <input type="number" value={r.port} onChange={e => update(id, { port: Number(e.target.value) })}
                    className={`${inputCls} font-mono`} />
                </Field>
                <Field label="Language" className="sm:col-span-3">
                  <select value={r.lang} onChange={e => update(id, { lang: e.target.value as PrinterLang })} className={inputCls}>
                    <option value="zpl">ZPL (Zebra)</option>
                    <option value="pplb">PPLB (Argox)</option>
                  </select>
                </Field>
              </div>

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => testPrint(r)}
                  disabled={!r.ip || test === 'testing'}
                  className="inline-flex items-center gap-2 text-[13px] border border-surface-rule rounded-lg px-3 py-1.5 text-text hover:bg-surface disabled:opacity-40"
                >
                  {test === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                  Test print
                </button>
                {test === 'ok'   && <span className="text-[12px] text-ok inline-flex items-center gap-1"><Check size={13} /> Sent to printer</span>}
                {test === 'fail' && <span className="text-[12px] text-red-500">Failed: {testMsg[id]}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const inputCls = 'w-full border border-surface-rule rounded-lg px-3 py-2 text-[14px] bg-surface text-text focus:outline-none focus:ring-2 focus:ring-brand/30'

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1">{label}</div>
      {children}
    </div>
  )
}
