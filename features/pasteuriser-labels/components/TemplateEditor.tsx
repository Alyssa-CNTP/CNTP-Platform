'use client'

import { useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, Info, Plus, Trash2, TriangleAlert, Type, Variable,
} from 'lucide-react'
import {
  LABEL_FIELD_KEYS, LABEL_FIELD_LABEL, LABEL_FIELD_SOURCE, LABEL_SIZES,
  checkCompliance, requiredMarks,
  type LabelCertification, type LabelLine, type LabelMarkKey, type LabelMarket,
  type LabelSizeKey, type LabelTemplate,
} from '@/lib/core/labels'
import { MARK_ART, MARK_KEYS } from '../marks'
import { LabelPreview } from './LabelPreview'

/**
 * The label designer.
 *
 * A structured line list, not a free canvas. Every one of the thirteen designs
 * in use is an ordered list of `Caption: value` and fixed-wording lines plus a
 * block of certification marks — so that is what the editor offers. The gain is
 * not simplicity for its own sake: a structured label renders identically to
 * the thermal printer, to the browser and to the PDF proof, and a free-canvas
 * one only ever renders faithfully to PDF.
 *
 * Compliance is shown live and permanently, not on submit. A designer who finds
 * out at "send for approval" that the JAS mark is missing has already written
 * the whole label; one who can see it the entire time fixes it in passing.
 */

const FIELD_SOURCE_NOTE: Record<string, string> = {
  template: 'fixed on this label',
  order:    'filled when sales assigns the PO',
  job_card: 'filled when the job card is assigned',
  bag:      'filled per bag at print time',
}

let uid = 0
const newId = () => `ln_${Date.now().toString(36)}_${++uid}`

export function TemplateEditor({
  template,
  editable,
  onChange,
}: {
  template: LabelTemplate
  /** False for an approved/pending template — it is frozen (see types.ts). */
  editable: boolean
  onChange: (next: LabelTemplate) => void
}) {
  const [tab, setTab] = useState<'lines' | 'marks' | 'stock'>('lines')

  const issues = useMemo(() => checkCompliance(template), [template])
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const needed = useMemo(
    () => requiredMarks(template.market, template.organic),
    [template.market, template.organic],
  )

  function patch(p: Partial<LabelTemplate>) { onChange({ ...template, ...p }) }
  function setLines(lines: LabelLine[]) { patch({ lines }) }

  function move(i: number, dir: -1 | 1) {
    const next = [...template.lines]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setLines(next)
  }

  function update(i: number, line: LabelLine) {
    const next = [...template.lines]
    next[i] = line
    setLines(next)
  }

  function remove(i: number) { setLines(template.lines.filter((_, k) => k !== i)) }

  function add(kind: LabelLine['kind']) {
    const line: LabelLine =
      kind === 'fixed'  ? { kind: 'fixed', id: newId(), text: '' }
    : kind === 'spacer' ? { kind: 'spacer', id: newId() }
    :                     { kind: 'field', id: newId(), caption: 'Batch Number', field: 'batch_no' }
    setLines([...template.lines, line])
  }

  function toggleMark(mark: LabelMarkKey) {
    const has = template.certifications.some(c => c.mark === mark)
    patch({
      certifications: has
        ? template.certifications.filter(c => c.mark !== mark)
        : [...template.certifications, { mark }],
    })
  }

  function setCert(mark: LabelMarkKey, p: Partial<LabelCertification>) {
    patch({
      certifications: template.certifications.map(c => (c.mark === mark ? { ...c, ...p } : c)),
    })
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-5 items-start">
      {/* ── Editing surface ─────────────────────────────────────────────── */}
      <div className="space-y-4 min-w-0">
        {!editable && (
          <div className="card p-3 flex items-start gap-2.5 border-l-4 border-l-amber-500">
            <Info size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-text-muted">
              This version is <b className="text-text">{template.status.replace('_', ' ')}</b> and cannot be
              edited. Approval is against the exact wording, so changing it here would leave the
              record claiming an approval nobody gave. Start a new version to make changes — the
              approved one stays printable until the new one is approved.
            </p>
          </div>
        )}

        <ComplianceBanner errors={errors} warnings={warnings} />

        <div className="flex gap-1 border-b border-border">
          {([['lines', 'Label lines'], ['marks', 'Certification marks'], ['stock', 'Stock & market']] as const)
            .map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === k ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text'
                }`}>
                {label}
                {k === 'marks' && needed.length > 0 && (
                  <span className="ml-1.5 text-[10px] font-mono text-text-faint">{needed.length} required</span>
                )}
              </button>
            ))}
        </div>

        {tab === 'lines' && (
          <div className="space-y-2">
            {template.lines.length === 0 && (
              <p className="text-sm text-text-muted py-6 text-center">
                No lines yet. Add fixed wording, or a field the job card fills in.
              </p>
            )}
            {template.lines.map((line, i) => (
              <LineRow
                key={line.id}
                line={line}
                editable={editable}
                first={i === 0}
                last={i === template.lines.length - 1}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onRemove={() => remove(i)}
                onChange={l => update(i, l)}
              />
            ))}
            {editable && (
              <div className="flex flex-wrap gap-2 pt-1">
                <AddButton icon={<Type size={14} />} label="Fixed wording" onClick={() => add('fixed')} />
                <AddButton icon={<Variable size={14} />} label="Field" onClick={() => add('field')} />
                <AddButton icon={<Plus size={14} />} label="Spacer" onClick={() => add('spacer')} />
              </div>
            )}
          </div>
        )}

        {tab === 'marks' && (
          <div className="space-y-2">
            {MARK_KEYS.map(mark => {
              const cert = template.certifications.find(c => c.mark === mark)
              const required = needed.includes(mark)
              return (
                <MarkRow
                  key={mark}
                  mark={mark}
                  cert={cert}
                  required={required}
                  editable={editable}
                  onToggle={() => toggleMark(mark)}
                  onChange={p => setCert(mark, p)}
                />
              )
            })}
          </div>
        )}

        {tab === 'stock' && (
          <StockPanel template={template} editable={editable} patch={patch} />
        )}
      </div>

      {/* ── Live preview ────────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-4 space-y-2">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-text-faint">
          Preview · {LABEL_SIZES[template.size].widthMm} × {LABEL_SIZES[template.size].heightMm} mm
        </p>
        <div className="rounded-xl bg-white p-2 shadow-sm border border-border">
          <LabelPreview template={template} scale={template.size === '100x50' ? 1.05 : 0.95} />
        </div>
        <p className="text-[11px] text-text-muted max-w-[260px] leading-relaxed">
          Ruled lines are placeholders. They are filled from the job card when the
          production manager assigns it, and per bag at print time.
        </p>
      </div>
    </div>
  )
}

function AddButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-text-muted hover:text-text hover:border-text-faint transition-colors">
      {icon} {label}
    </button>
  )
}

function ComplianceBanner({ errors, warnings }: {
  errors: { code: string; message: string }[]
  warnings: { code: string; message: string }[]
}) {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="card p-3 flex items-center gap-2.5 border-l-4 border-l-emerald-500">
        <Check size={16} className="text-emerald-600 flex-shrink-0" />
        <p className="text-xs text-text-muted">
          Compliant for its market. Ready to send for approval.
        </p>
      </div>
    )
  }
  return (
    <div className={`card p-3 border-l-4 ${errors.length ? 'border-l-red-500' : 'border-l-amber-500'}`}>
      <div className="flex items-start gap-2.5">
        <TriangleAlert size={16} className={errors.length ? 'text-red-600 mt-0.5' : 'text-amber-600 mt-0.5'} />
        <div className="space-y-1.5 min-w-0">
          {errors.length > 0 && (
            <p className="text-xs font-semibold text-text">
              {errors.length} {errors.length === 1 ? 'problem blocks' : 'problems block'} this going out for approval
            </p>
          )}
          <ul className="space-y-1">
            {[...errors, ...warnings].map(i => (
              <li key={i.code} className="text-xs text-text-muted leading-relaxed">{i.message}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function LineRow({ line, editable, first, last, onUp, onDown, onRemove, onChange }: {
  line: LabelLine
  editable: boolean
  first: boolean
  last: boolean
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onChange: (l: LabelLine) => void
}) {
  const input = 'w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm text-text disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className="card p-2.5 flex items-start gap-2">
      <div className="flex flex-col gap-0.5 pt-1">
        <button onClick={onUp} disabled={!editable || first}
          className="p-0.5 rounded text-text-faint hover:text-text disabled:opacity-30" aria-label="Move up">
          <ArrowUp size={13} />
        </button>
        <button onClick={onDown} disabled={!editable || last}
          className="p-0.5 rounded text-text-faint hover:text-text disabled:opacity-30" aria-label="Move down">
          <ArrowDown size={13} />
        </button>
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        {line.kind === 'spacer' && (
          <p className="text-xs text-text-faint italic py-1.5">Blank line</p>
        )}

        {line.kind === 'fixed' && (
          <input
            className={input}
            disabled={!editable}
            value={line.text}
            placeholder="Wording printed exactly as typed"
            onChange={e => onChange({ ...line, text: e.target.value })}
          />
        )}

        {line.kind === 'field' && (
          <div className="flex flex-col sm:flex-row gap-1.5">
            <input
              className={`${input} sm:w-2/5`}
              disabled={!editable}
              value={line.caption}
              placeholder="Caption"
              onChange={e => onChange({ ...line, caption: e.target.value })}
            />
            <select
              className={`${input} sm:flex-1`}
              disabled={!editable}
              value={line.field}
              onChange={e => onChange({ ...line, field: e.target.value as typeof line.field })}
            >
              {LABEL_FIELD_KEYS.map(k => (
                <option key={k} value={k}>
                  {LABEL_FIELD_LABEL[k]} — {FIELD_SOURCE_NOTE[LABEL_FIELD_SOURCE[k]]}
                </option>
              ))}
            </select>
          </div>
        )}

        {line.kind !== 'spacer' && (
          <div className="flex gap-3 pl-0.5">
            <Toggle label="Indent" checked={!!line.indent} disabled={!editable}
              onChange={v => onChange({ ...line, indent: v })} />
            <Toggle label="Bold" checked={!!line.emphasis} disabled={!editable}
              onChange={v => onChange({ ...line, emphasis: v })} />
          </div>
        )}
      </div>

      <button onClick={onRemove} disabled={!editable}
        className="p-1 rounded text-text-faint hover:text-red-600 disabled:opacity-30" aria-label="Remove line">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function Toggle({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-[11px] ${disabled ? 'opacity-50' : 'cursor-pointer'} text-text-muted`}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)} className="accent-primary" />
      {label}
    </label>
  )
}

function MarkRow({ mark, cert, required, editable, onToggle, onChange }: {
  mark: LabelMarkKey
  cert?: LabelCertification
  required: boolean
  editable: boolean
  onToggle: () => void
  onChange: (p: Partial<LabelCertification>) => void
}) {
  const art = MARK_ART[mark]
  const on = !!cert
  const input = 'px-2 py-1 rounded-lg border border-border bg-surface text-xs text-text w-full'

  return (
    <div className={`card p-3 ${required && !on ? 'border-l-4 border-l-red-500' : ''}`}>
      <div className="flex items-start gap-3">
        <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" checked={on} disabled={!editable}
            onChange={onToggle} className="accent-primary flex-shrink-0" />
          <span className="w-9 h-9 flex-shrink-0 text-text"
            dangerouslySetInnerHTML={{ __html: art.svg }} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">{art.label}</span>
            {required && (
              <span className="block text-[11px] text-red-600 font-medium">
                Required for this market
              </span>
            )}
            {art.officialArtworkRequired && on && (
              <span className="block text-[11px] text-amber-700">
                {art.label} license their own artwork — replace this rendering with their supplied
                file before the proof is treated as final.
              </span>
            )}
          </span>
        </label>
      </div>

      {on && (
        <div className="grid sm:grid-cols-3 gap-2 mt-2.5 pl-8">
          {mark === 'fairtrade' ? (
            <Labelled label="FLO ID">
              <input className={input} disabled={!editable} value={cert?.floId ?? ''}
                placeholder="5500" onChange={e => onChange({ floId: e.target.value })} />
            </Labelled>
          ) : (
            <>
              <Labelled label="Registration">
                <input className={input} disabled={!editable} value={cert?.registrationNo ?? ''}
                  placeholder="ZA-BIO-149" onChange={e => onChange({ registrationNo: e.target.value })} />
              </Labelled>
              <Labelled label="Operator / CU no.">
                <input className={input} disabled={!editable} value={cert?.operatorNo ?? ''}
                  placeholder="892408" onChange={e => onChange({ operatorNo: e.target.value })} />
              </Labelled>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide font-semibold text-text-faint mb-0.5">{label}</span>
      {children}
    </label>
  )
}

function StockPanel({ template, editable, patch }: {
  template: LabelTemplate
  editable: boolean
  patch: (p: Partial<LabelTemplate>) => void
}) {
  const input = 'w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm text-text'
  const MARKETS: { value: LabelMarket; label: string }[] = [
    { value: 'local',  label: 'Local (South Africa)' },
    { value: 'export', label: 'Export (generic)' },
    { value: 'eu',     label: 'European Union' },
    { value: 'usa',    label: 'USA (NOP)' },
    { value: 'uk',     label: 'United Kingdom' },
    { value: 'japan',  label: 'Japan (JAS)' },
  ]

  return (
    <div className="space-y-3 max-w-md">
      <Labelled label="Label name">
        <input className={input} disabled={!editable} value={template.name}
          onChange={e => patch({ name: e.target.value })} />
      </Labelled>

      <Labelled label="Destination market">
        <select className={input} disabled={!editable} value={template.market}
          onChange={e => patch({ market: e.target.value as LabelMarket })}>
          {MARKETS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Labelled>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" className="accent-primary" disabled={!editable}
          checked={template.organic} onChange={e => patch({ organic: e.target.checked })} />
        <span className="text-sm text-text">Organic product</span>
      </label>
      <p className="text-[11px] text-text-muted -mt-1.5 pl-6 leading-relaxed">
        Market and organic together decide which certification marks are mandatory. Japan +
        organic requires the JAS mark; any organic market requires the Control Union
        registration and operator number.
      </p>

      <Labelled label="Label stock">
        <select className={input} disabled={!editable} value={template.size}
          onChange={e => patch({ size: e.target.value as LabelSizeKey })}>
          {(Object.keys(LABEL_SIZES) as LabelSizeKey[]).map(k => (
            <option key={k} value={k}>
              {k} — {LABEL_SIZES[k].widthMm} × {LABEL_SIZES[k].heightMm} mm
            </option>
          ))}
        </select>
      </Labelled>

      <Labelled label="Mark position">
        <select className={input} disabled={!editable} value={template.markPosition}
          onChange={e => patch({ markPosition: e.target.value as LabelTemplate['markPosition'] })}>
          <option value="right">Right of the text</option>
          <option value="bottom">Below the text</option>
          <option value="header">Above the text</option>
        </select>
      </Labelled>

      <Labelled label="Note to the certifier / customer (on the proof, not the label)">
        <textarea className={`${input} min-h-[70px]`} disabled={!editable}
          value={template.proofNote ?? ''}
          onChange={e => patch({ proofNote: e.target.value })} />
      </Labelled>
    </div>
  )
}
