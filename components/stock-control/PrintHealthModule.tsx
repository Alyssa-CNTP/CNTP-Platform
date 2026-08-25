'use client'

// components/stock-control/PrintHealthModule.tsx
//
// Print system health (lives inside the Stock Control page under Operations,
// alongside the Printers config module). Answers "is printing actually
// working?" from what's observable in the database — this session cannot
// SSH into the VPS or the factory LAN, so it can't confirm PRINT_RELAY/
// PRINT_AGENT_SECRET are set, or that the relay agent process is running.
// What it CAN show: the print_jobs queue's real status breakdown, recent
// errors, and the last successful print per section — enough for a
// supervisor to tell "untested" apart from "broken" without reading logs.

import { useEffect, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { PRINTER_SECTIONS, sectionMeta, LABEL_PRINTING_ENABLED } from '@/lib/production/capture-config'
import { Radio, AlertTriangle, CheckCircle2, Clock, Loader2, Info } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'

interface JobRow {
  id: string
  section_id: string
  printer_ip: string
  status: 'pending' | 'printing' | 'done' | 'error'
  attempts: number
  error: string | null
  created_at: string
  printed_at: string | null
}

const STATUS_STYLE: Record<JobRow['status'], string> = {
  pending:  'bg-stone-100 text-stone-600',
  printing: 'bg-blue-100 text-blue-700',
  done:     'bg-emerald-100 text-emerald-700',
  error:    'bg-red-100 text-red-700',
}

export default function PrintHealthModule() {
  const [jobs, setJobs]       = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await getDb().schema('production').from('print_jobs')
        .select('id, section_id, printer_ip, status, attempts, error, created_at, printed_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw err
      setJobs((data as JobRow[]) ?? [])
    } catch (e: any) {
      // A missing table reads as "queue empty / never provisioned" — surfaced
      // distinctly from a genuine query failure so it's not mistaken for "no
      // print jobs have run yet" when the migration itself hasn't landed.
      setError(e?.message ?? 'Failed to load print_jobs')
    } finally {
      setLoading(false)
    }
  }

  const counts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
  const errors = jobs.filter(j => j.status === 'error').slice(0, 20)
  const lastDoneBySection = new Map<string, string>()
  for (const j of jobs) {
    if (j.status === 'done' && j.printed_at && !lastDoneBySection.has(j.section_id)) {
      lastDoneBySection.set(j.section_id, j.printed_at)
    }
  }
  // Any row at all in print_jobs means relay mode has been exercised at least
  // once (direct-print mode never writes a queue row) — a heuristic, not a
  // read of the actual PRINT_RELAY env var, which this session can't access.
  const relayEverUsed = jobs.length > 0

  if (loading) {
    return <div className="py-8 font-mono text-[11px] uppercase tracking-widest text-text-muted animate-pulse">Loading print health…</div>
  }

  return (
    <div>
      <h2 className="text-[18px] font-bold text-text flex items-center gap-2">
        <Radio size={18} /> Print system health
      </h2>
      <p className="text-[13px] text-text-muted mt-1 max-w-2xl">
        What the database can show about whether printing is actually working. This can't confirm the VPS's
        relay env vars are set or that an agent process is running on the factory LAN — only what jobs have
        actually been queued/printed.
      </p>

      {!LABEL_PRINTING_ENABLED && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <Info size={16} className="shrink-0 mt-0.5" />
          <div>
            <strong>Label printing is currently OFF for capture</strong> (<span className="font-mono text-[12px]">LABEL_PRINTING_ENABLED = false</span> in capture-config.ts).
            Output bags show a serial to hand-write instead of printing. This is expected and doesn't mean anything's broken —
            the "Test print" button on the Printers tab still queues/sends real jobs regardless of this flag, so you can
            verify the pipeline below before flipping it on.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div><strong>Couldn't load the print queue.</strong> {error}</div>
        </div>
      )}

      {!error && jobs.length === 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-[13px] text-stone-600">
          <Info size={16} className="shrink-0 mt-0.5" />
          <div>No print jobs recorded yet. Either nothing has printed yet, or the printer is set to direct-print mode
            (no <span className="font-mono text-[12px]">PRINT_RELAY</span>) — direct mode never writes a queue row here.
            Try "Test print" on the Printers tab to generate one.</div>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['pending', 'printing', 'done', 'error'] as const).map(s => (
              <div key={s} className="rounded-2xl border border-surface-rule bg-surface-card p-4 text-center">
                <div className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[s]}`}>{s}</div>
                <div className="text-[24px] font-bold text-text mt-2 font-mono">{counts[s] ?? 0}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 text-[12px] text-text-muted flex items-center gap-1.5">
            <Radio size={13} className={relayEverUsed ? 'text-ok' : 'text-stone-400'} />
            {relayEverUsed
              ? 'This queue has real rows — relay mode has printed at least once (or is set up and waiting).'
              : 'No rows yet — can\'t tell if relay mode is even active. Run a test print to find out.'}
          </div>

          <div className="mt-6">
            <div className="text-[13px] font-semibold text-text mb-2">Last successful print per section</div>
            <div className="space-y-1.5">
              {PRINTER_SECTIONS.map(id => {
                const meta = sectionMeta(id)
                const last = lastDoneBySection.get(id)
                return (
                  <div key={id} className="flex items-center gap-3 rounded-xl border border-surface-rule bg-surface-card px-3 py-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-white text-[10px] font-bold shrink-0" style={{ background: meta.colorHex }}>{meta.code}</span>
                    <span className="text-[13px] text-text flex-1">{meta.name}</span>
                    {last ? (
                      <span className="text-[12px] text-ok inline-flex items-center gap-1"><CheckCircle2 size={13} /> {formatDistanceToNow(new Date(last), { addSuffix: true })}</span>
                    ) : (
                      <span className="text-[12px] text-stone-400 inline-flex items-center gap-1"><Clock size={13} /> never</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="mt-6">
              <div className="text-[13px] font-semibold text-text mb-2">Recent errors ({errors.length})</div>
              <div className="space-y-1.5">
                {errors.map(j => (
                  <div key={j.id} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-red-800">{sectionMeta(j.section_id).name} · {j.printer_ip}</span>
                      <span className="text-red-500 text-[11px]">{format(new Date(j.created_at), 'd MMM HH:mm')} · {j.attempts} attempt{j.attempts !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-red-700 mt-1">{j.error ?? 'No error message recorded.'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
