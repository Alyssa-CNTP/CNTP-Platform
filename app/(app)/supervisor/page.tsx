'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format, parseISO, addDays } from 'date-fns'
import {
  Users, Loader2, Save, Send, Printer, X, Plus, CheckCircle2,
  Lock, ArrowRight, Info, ClipboardList, Sparkles,
} from 'lucide-react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { ROSTER_ROLE_SEED, type RosterRole } from '@/lib/production/roster-config'
import { nextPeriodConfig } from '@/lib/production/roster-rotate'
import { HubHeader } from '@/components/supervisor/HubTabs'
// The daily "Assign sections" tool (operators + variant + lot + PO per section,
// per shift) is embedded here as a second view of the Roster tab. It is
// imported UNCHANGED — its own logic, save behaviour and capture-unlock stay
// exactly as they are on /production/capture/assign; this only gives it a home
// back inside the Hub. It carries its own Suspense boundary for useSearchParams.
import AssignSectionsTool from '@/app/(app)/production/capture/assign/page'

// Supervisor Hub's "Roster" tab — a deliberately small window onto the Shift
// Roster: just the Production category, for the two people who actually own
// it day to day. It reads and writes the SAME production.roster_entries /
// roster_periods / roster_section_status tables as the full multi-department
// tool at /production/roster — this is not a fork of the data, just a
// decluttered view of one slice of it. Period creation/rotation/publish stays
// on the full tool (link at the bottom); this tab only edits people.
//
// The save/submit split: the supervisor can edit and Save a draft any time;
// only someone holding can_submit_roster_production (the Production Manager)
// can Submit it. Print is open to anyone who can view.

type RShift = 'day' | 'night'
const SHIFTS: { key: RShift; label: string; window: string }[] = [
  { key: 'day',   label: 'Day',   window: '07h00–16h00' },
  { key: 'night', label: 'Night', window: '16h00–01h00' },
]
const PRODUCTION_ROLES: RosterRole[] = ROSTER_ROLE_SEED.filter(r => r.category === 'production').sort((a, b) => a.sort - b.sort)

interface Period { id: string; name: string; start_date: string; end_date: string; day_label: string; night_label: string; status: string }
interface Entry {
  id: string; period_id: string; role_key: string; shift: RShift
  employee_id: string | null; operator_id: string | null; person_name: string
}
interface Employee { id: string; name: string; display_name: string | null; operator_id: string | null }

const db = () => getDb().schema('production')

// Today's date in SAST (Africa/Johannesburg), independent of the browser's timezone.
function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function SupervisorRoster() {
  const { user, p, isFullAdmin } = useAuth()
  const canEdit   = isFullAdmin || p('can_edit_roster_production')
  const canSubmit = isFullAdmin || p('can_submit_roster_production')

  const [period, setPeriod]     = useState<Period | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries]   = useState<Entry[]>([])
  const [status, setStatus]     = useState<{ status: string; submitted_by: string | null; submitted_at: string | null } | null>(null)
  const [leaveIds, setLeaveIds] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [addingCell, setAddingCell] = useState<string | null>(null)  // `${roleKey}:${shift}`
  // 'staffing' = the fortnightly who-works-which-role grid (this file);
  // 'sections' = the daily Assign-sections tool, embedded unchanged.
  const [view, setView] = useState<'staffing' | 'sections'>('staffing')
  // The tab is never blank: when the period covering today has no production
  // crew yet (or no period exists at all), we show an unsaved DRAFT pre-filled
  // from the most recent populated period, day↔night swapped — the same rule
  // the weekly rotate cron uses. isPrefill flags that the shown grid isn't saved
  // yet; latestPeriod is the newest period overall (for cadence chaining when we
  // have to create today's period on save); prefillSourceName is for the banner.
  const [isPrefill, setIsPrefill]           = useState(false)
  const [latestPeriod, setLatestPeriod]     = useState<Period | null>(null)
  const [prefillSourceName, setPrefillSourceName] = useState<string | null>(null)

  async function loadLeave(start: string, end: string) {
    const { data: leave } = await db().from('employee_leave_active').select('employee_id')
      .lte('start_date', end).gte('end_date', start)
    setLeaveIds(new Set(((leave as any[]) ?? []).map(r => r.employee_id).filter(Boolean)))
  }

  async function load() {
    setLoading(true); setError(null)
    try {
      const today = sastToday()
      const roleKeys = PRODUCTION_ROLES.map(r => r.key)
      // Pull the recent periods (not just today's) so we can both find the one
      // covering today AND fall back to the last populated one for a pre-fill.
      const [{ data: periodsData }, { data: emps }] = await Promise.all([
        db().from('roster_periods')
          .select('id,name,start_date,end_date,day_label,night_label,status')
          .order('start_date', { ascending: false }).limit(8),
        db().from('employees').select('id,name,display_name,operator_id').eq('active', true).order('name'),
      ])
      setEmployees((emps as Employee[]) ?? [])
      const periodsList = (periodsData as Period[]) ?? []
      setLatestPeriod(periodsList[0] ?? null)
      const covering = periodsList.find(pp => pp.start_date <= today && today <= pp.end_date) ?? null

      // Production entries for every recent period in one query, grouped by period.
      const byPeriod = new Map<string, Entry[]>()
      if (periodsList.length) {
        const { data: allRows } = await db().from('roster_entries')
          .select('id,period_id,role_key,shift,employee_id,operator_id,person_name')
          .in('period_id', periodsList.map(pp => pp.id)).in('role_key', roleKeys)
        ;((allRows as Entry[]) ?? []).forEach(e => {
          const a = byPeriod.get(e.period_id) ?? []; a.push(e); byPeriod.set(e.period_id, a)
        })
      }
      const coveringEntries = covering ? (byPeriod.get(covering.id) ?? []) : []

      if (covering && coveringEntries.length > 0) {
        // Normal path — the covering period already has a crew (usually written
        // by the weekly rotate cron). Show it as-is.
        setPeriod(covering); setEntries(coveringEntries)
        setIsPrefill(false); setPrefillSourceName(null)
        const { data: st } = await db().from('roster_section_status')
          .select('status,submitted_by,submitted_at').eq('period_id', covering.id).eq('section', 'production').maybeSingle()
        setStatus((st as any) ?? { status: 'draft', submitted_by: null, submitted_at: null })
        await loadLeave(covering.start_date, covering.end_date)
      } else {
        // Empty or missing covering period → build an unsaved pre-fill draft from
        // the most recent period that HAS a crew, day↔night swapped, so the tab
        // is never blank. It saves into the covering period (created on save if
        // none exists yet).
        const source = periodsList.find(pp => pp.id !== covering?.id && (byPeriod.get(pp.id)?.length ?? 0) > 0) ?? null
        setPeriod(covering)  // may be null — saveDraft() will create it
        if (source) {
          const src = byPeriod.get(source.id) ?? []
          setEntries(src.map((e, i) => ({
            id: `tmp-prefill-${i}`, period_id: covering?.id ?? '',
            role_key: e.role_key, shift: (e.shift === 'day' ? 'night' : 'day') as RShift,
            employee_id: e.employee_id, operator_id: e.operator_id, person_name: e.person_name,
          })))
          setIsPrefill(true); setPrefillSourceName(source.name)
        } else {
          setEntries([]); setIsPrefill(false); setPrefillSourceName(null)
        }
        setStatus({ status: 'draft', submitted_by: null, submitted_at: null })
        await loadLeave(covering?.start_date ?? today, covering?.end_date ?? today)
      }
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const cellEntries = (roleKey: string, shift: RShift) => entries.filter(e => e.role_key === roleKey && e.shift === shift)

  function addPerson(roleKey: string, shift: RShift, employeeId: string) {
    const emp = employees.find(e => e.id === employeeId)
    if (!emp) return
    if (cellEntries(roleKey, shift).some(e => e.employee_id === employeeId)) { setAddingCell(null); return }
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setEntries(es => [...es, {
      id: tempId, period_id: period?.id ?? '', role_key: roleKey, shift,
      employee_id: emp.id, operator_id: emp.operator_id ?? null,
      person_name: emp.display_name || emp.name,
    }])
    setAddingCell(null)
    setSaved(false)
  }
  function removePerson(id: string) {
    setEntries(es => es.filter(e => e.id !== id))
    setSaved(false)
  }

  const isSubmitted = status?.status === 'submitted'

  // The period covering today, creating it if none exists. New periods are dated
  // by chaining nextPeriodConfig() forward from the latest period — the SAME
  // cadence the rotate cron uses — so a period created here lines up with what
  // the cron would have made (its idempotency check then skips it, no duplicate).
  // With no history at all, fall back to a plain 7-day week starting today.
  async function ensurePeriod(): Promise<Period | null> {
    if (period) return period
    const today = sastToday()
    let cfg: { name: string; start: string; end: string; dayLabel: string; nightLabel: string }
    if (latestPeriod) {
      let c = nextPeriodConfig(latestPeriod)
      let guard = 0
      while (c.end < today && guard < 104) {
        c = nextPeriodConfig({ id: '', name: c.name, start_date: c.start, end_date: c.end, day_label: c.dayLabel, night_label: c.nightLabel })
        guard++
      }
      cfg = c
      // If the newest period is itself in the future, the chain overshoots today;
      // fall back to a today-anchored week rather than create a wrong-dated one.
      if (cfg.start > today) {
        const s = parseISO(today + 'T12:00:00'), e = addDays(s, 6)
        cfg = { name: `${format(s, 'd')}–${format(e, 'd MMM')}`, start: today, end: format(e, 'yyyy-MM-dd'), dayLabel: latestPeriod.night_label || 'Shift B', nightLabel: latestPeriod.day_label || 'Shift A' }
      }
    } else {
      const s = parseISO(today + 'T12:00:00'), e = addDays(s, 6)
      cfg = { name: `${format(s, 'd')}–${format(e, 'd MMM')}`, start: today, end: format(e, 'yyyy-MM-dd'), dayLabel: 'Shift A', nightLabel: 'Shift B' }
    }
    const { data, error: e } = await db().from('roster_periods').insert({
      name: cfg.name, start_date: cfg.start, end_date: cfg.end,
      day_label: cfg.dayLabel, night_label: cfg.nightLabel, created_by: user?.id ?? null,
    } as any).select('id,name,start_date,end_date,day_label,night_label,status').single()
    if (e || !data) throw (e ?? new Error('Could not create a roster period'))
    const created = { ...(data as any), status: (data as any).status ?? 'draft' } as Period
    setPeriod(created)
    return created
  }

  // Returns the period it saved into (null on failure) so the caller (submit)
  // can act on a period that was created during this same save.
  async function saveDraft(): Promise<Period | null> {
    if (!canEdit) return null
    setSaving(true); setError(null)
    try {
      const per = period ?? await ensurePeriod()
      if (!per) throw new Error('No roster period')
      const roleKeys = PRODUCTION_ROLES.map(r => r.key)
      await db().from('roster_entries').delete().eq('period_id', per.id).in('role_key', roleKeys)
      const toInsert = entries.map((e, i) => ({
        period_id: per.id, role_key: e.role_key, shift: e.shift,
        employee_id: e.employee_id, operator_id: e.operator_id, person_name: e.person_name, sort_order: i,
      }))
      let fresh: Entry[] = []
      if (toInsert.length > 0) {
        const { data, error: iErr } = await db().from('roster_entries').insert(toInsert as any)
          .select('id,period_id,role_key,shift,employee_id,operator_id,person_name')
        if (iErr) throw iErr
        fresh = (data as Entry[]) ?? []
      }
      setEntries(fresh)
      setIsPrefill(false)  // it's now saved, no longer an unsaved pre-fill
      // Editing again un-submits it — matches the full roster tool's rule that a
      // save always drops the section back to draft (submit is a deliberate,
      // separate step over the CURRENT saved state, never stale).
      await db().from('roster_section_status').upsert({
        period_id: per.id, section: 'production', status: 'draft', submitted_by: null, submitted_at: null,
      } as any, { onConflict: 'period_id,section' })
      setStatus({ status: 'draft', submitted_by: null, submitted_at: null })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      return per
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true); setError(null)
    try {
      const per = await saveDraft()
      if (!per) { setSubmitting(false); return }
      const submitted_at = new Date().toISOString()
      await db().from('roster_section_status').upsert({
        period_id: per.id, section: 'production', status: 'submitted',
        submitted_by: user?.id ?? null, submitted_at,
      } as any, { onConflict: 'period_id,section' })
      setStatus({ status: 'submitted', submitted_by: user?.id ?? null, submitted_at })
    } catch (e: any) {
      setError(e.message)
    }
    setSubmitting(false)
  }

  const availableFor = (roleKey: string, shift: RShift) => {
    const taken = new Set(cellEntries(roleKey, shift).map(e => e.employee_id))
    return employees.filter(e => !taken.has(e.id))
  }

  const totalAssigned = entries.length

  return (
    <div className="px-4 py-6 max-w-[900px] mx-auto space-y-5 print-full-width">
      <div className="no-print">
        <HubHeader
          subtitle={view === 'sections'
            ? "Today's operators, variant, lot & production order per section"
            : (period ? `${period.name} · ${format(parseISO(period.start_date + 'T12:00:00'), 'd MMM')}–${format(parseISO(period.end_date + 'T12:00:00'), 'd MMM')}` : 'Who is on which line this roster period')}
          action={view === 'staffing'
            ? (
              <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-600 hover:border-brand hover:text-brand transition-colors">
                <Printer size={13} /> Print
              </button>
            )
            : undefined}
        />
      </div>

      {/* Sub-view toggle — the fortnightly staffing grid vs today's per-section
          assignment. Two different jobs that both live under "Roster": who works
          which role over the period, and who runs which section (with variant /
          lot / PO) today. */}
      <div className="no-print flex gap-1 p-1 bg-stone-100 rounded-lg w-max">
        {([['staffing', 'Staffing', Users], ['sections', "Today's sections", ClipboardList]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${view === v ? 'bg-white text-brand shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === 'sections' ? (
        <div className="no-print"><AssignSectionsTool /></div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 size={22} className="animate-spin text-stone-300" /></div>
      ) : (!period && !isPrefill && entries.length === 0) ? (
        <div className="text-center py-16 bg-surface-card border border-surface-rule rounded-2xl">
          <p className="font-mono text-[12px] text-stone-400">No roster period covers today yet, and no earlier roster to pre-fill from.</p>
          <Link href="/production/roster" className="text-[12px] text-brand hover:underline mt-1 inline-block">Set one up on the full Shift Roster →</Link>
        </div>
      ) : (
        <>
          {/* Pre-fill notice — the grid below is an unsaved suggestion carried
              over from the last populated roster (day↔night swapped), so the
              tab is never blank. Saving confirms it for this period. */}
          {isPrefill && (
            <div className="no-print flex items-start gap-2.5 px-4 py-3 rounded-xl text-[12px] border bg-brand/5 border-brand/20 text-brand-mid">
              <Sparkles size={14} className="shrink-0 mt-0.5" />
              <span>
                Pre-filled from <strong>{prefillSourceName ?? 'the last roster'}</strong>, day &amp; night swapped — a starting point so this week is never blank.
                Adjust who&apos;s where, then <strong>Save</strong> to confirm{!period ? ' (this also creates this week&apos;s roster period)' : ''}.
              </span>
            </div>
          )}

          {/* Status + explanation */}
          <div className={`no-print flex items-start gap-2.5 px-4 py-3 rounded-xl text-[12px] border ${isSubmitted ? 'bg-ok/5 border-ok/20 text-ok' : 'bg-info/5 border-info/20 text-info'}`}>
            {isSubmitted ? <Lock size={14} className="shrink-0 mt-0.5" /> : <Info size={14} className="shrink-0 mt-0.5" />}
            <span>
              {isSubmitted
                ? `Submitted${status?.submitted_at ? ` ${format(parseISO(status.submitted_at), 'd MMM HH:mm')}` : ''} — locked in for the full roster. Editing and saving again reopens it.`
                : canSubmit
                  ? 'Edit who is on each line, Save, then Submit to sign it off.'
                  : 'Edit who is on each line and Save. A Production Manager submits it to sign it off.'}
            </span>
          </div>

          {error && <p className="no-print text-[12px] text-err px-1">{error}</p>}

          {/* Print header (screen shows the HubHeader above instead) */}
          <div className="print-only mb-4">
            <h1 className="font-display font-bold text-[18px]">Production Roster{period ? ` · ${period.name}` : ''}</h1>
            {period && <p className="text-[12px] text-stone-500">{format(parseISO(period.start_date + 'T12:00:00'), 'd MMM')}–{format(parseISO(period.end_date + 'T12:00:00'), 'd MMM yyyy')}</p>}
          </div>

          {/* Role grid */}
          <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_1fr] bg-surface border-b border-surface-rule text-[10px] font-semibold text-text-muted uppercase tracking-wide">
              <div className="px-4 py-2.5">Role</div>
              {SHIFTS.map(s => <div key={s.key} className="px-4 py-2.5 border-l border-surface-rule">{s.label} <span className="font-normal normal-case text-stone-400">· {s.window}</span></div>)}
            </div>
            <div className="divide-y divide-surface-rule">
              {PRODUCTION_ROLES.map(role => (
                <div key={role.key} className="grid grid-cols-[1fr_1fr_1fr]">
                  <div className="px-4 py-3 font-body font-medium text-[13px] text-text flex items-center">{role.name}</div>
                  {SHIFTS.map(s => {
                    const cellKey = `${role.key}:${s.key}`
                    const list = cellEntries(role.key, s.key)
                    return (
                      <div key={s.key} className="px-4 py-3 border-l border-surface-rule space-y-1.5">
                        {list.map(e => {
                          const onLeave = !!(e.employee_id && leaveIds.has(e.employee_id))
                          return (
                            <span key={e.id} className={`inline-flex items-center gap-1.5 mr-1.5 mb-1.5 px-2.5 py-1 rounded-full text-[12px] ${onLeave ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-stone-100 text-stone-700'}`}>
                              {e.person_name}{onLeave && <span className="text-[9px] font-semibold uppercase">· leave</span>}
                              {canEdit && !isSubmitted && (
                                <button onClick={() => removePerson(e.id)} className="text-stone-400 hover:text-err"><X size={11} /></button>
                              )}
                            </span>
                          )
                        })}
                        {canEdit && !isSubmitted && (
                          addingCell === cellKey ? (
                            <select autoFocus defaultValue="" onBlur={() => setAddingCell(null)}
                              onChange={e => addPerson(role.key, s.key, e.target.value)}
                              className="mt-1 block w-full px-2 py-1.5 rounded-lg border border-brand text-[12px] outline-none">
                              <option value="" disabled>Search a name…</option>
                              {availableFor(role.key, s.key).map(e => (
                                <option key={e.id} value={e.id}>{e.display_name || e.name}</option>
                              ))}
                            </select>
                          ) : (
                            <button onClick={() => setAddingCell(cellKey)}
                              className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-brand mt-0.5">
                              <Plus size={12} /> Add
                            </button>
                          )
                        )}
                        {!canEdit && list.length === 0 && <span className="text-[12px] text-stone-300">—</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="no-print flex items-center gap-2 text-[11px] text-text-muted px-1">
            <Users size={12} /> {totalAssigned} {totalAssigned === 1 ? 'person' : 'people'} rostered this period
          </div>

          {/* Actions */}
          {(canEdit || canSubmit) && (
            <div className="no-print flex items-center gap-3">
              {canEdit && (
                <button onClick={saveDraft} disabled={saving || isSubmitted}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-stone-200 bg-white font-medium text-[14px] text-text disabled:opacity-40 hover:bg-stone-50 transition-colors">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} className="text-ok" /> : <Save size={15} />}
                  {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
                </button>
              )}
              {canSubmit && (
                <button onClick={submit} disabled={submitting || isSubmitted}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-white font-semibold text-[14px] disabled:opacity-40 hover:bg-brand-mid transition-colors">
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : isSubmitted ? <Lock size={15} /> : <Send size={15} />}
                  {isSubmitted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit'}
                </button>
              )}
            </div>
          )}
          {!canEdit && !canSubmit && (
            <p className="no-print text-[12px] text-stone-400 px-1">You have read-only access to the roster.</p>
          )}

          <Link href="/production/roster" className="no-print flex items-center gap-1 text-[12px] text-brand hover:underline px-1">
            Full company roster (all departments, periods) <ArrowRight size={12} />
          </Link>
        </>
      )}
    </div>
  )
}
