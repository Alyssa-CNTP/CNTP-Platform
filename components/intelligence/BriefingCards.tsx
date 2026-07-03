'use client'

import { useState } from 'react'
import { BookOpen, Save, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import clsx from 'clsx'

interface Section {
  title: string
  body:  string
}

function parseIntoSections(text: string): Section[] {
  // Split on ## headings — handles both `## Title\n` and `**Title**\n` patterns
  const lines  = text.split('\n')
  const sections: Section[] = []
  let current: Section | null = null

  for (const raw of lines) {
    const line = raw.trim()
    const h2   = line.match(/^##\s+(.+)/)
    const bold = line.match(/^\*\*(.+?)\*\*\s*$/)

    if (h2 || bold) {
      if (current && current.body.trim()) sections.push(current)
      current = { title: (h2?.[1] ?? bold?.[1] ?? '').trim(), body: '' }
    } else if (current) {
      current.body += raw + '\n'
    } else {
      // preamble before first heading
      if (!sections.length && line) {
        sections.push({ title: '', body: '' })
      }
      if (sections.length) sections[sections.length - 1].body += raw + '\n'
    }
  }
  if (current && current.body.trim()) sections.push(current)
  return sections.filter(s => s.body.trim())
}

function renderBody(body: string): React.ReactNode {
  // Convert bullet points and bold inline to readable output
  return body.trim().split('\n').map((line, i) => {
    const bullet = line.match(/^[\-\*•]\s+(.+)/)
    const numbered = line.match(/^\d+\.\s+(.+)/)
    const bold = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

    if (bullet) {
      return (
        <li key={i} className="ml-3 text-[13px] text-text leading-relaxed"
          dangerouslySetInnerHTML={{ __html: bullet[1].replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }}
        />
      )
    }
    if (numbered) {
      return (
        <li key={i} className="ml-3 text-[13px] text-text leading-relaxed list-decimal"
          dangerouslySetInnerHTML={{ __html: numbered[1].replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }}
        />
      )
    }
    if (!line.trim()) return <div key={i} className="h-1" />
    return (
      <p key={i} className="text-[13px] text-text leading-relaxed"
        dangerouslySetInnerHTML={{ __html: bold }}
      />
    )
  })
}

interface Props {
  text:        string
  loading:     boolean
  label?:      string
  reportTitle?: string
  reportType?: string
}

export default function BriefingCards({ text, loading, label = 'Intelligence', reportTitle, reportType = 'briefing' }: Props) {
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-4 bg-surface-card border border-surface-rule rounded-xl">
        <Loader2 size={14} className="animate-spin text-accent" />
        <span className="font-mono text-[11px] text-text-faint tracking-wide">Generating…</span>
      </div>
    )
  }
  if (!text) return null

  const sections = parseIntoSections(text)
  const hasSections = sections.some(s => s.title)

  async function saveReport() {
    if (saving || saved) return
    setSaving(true)
    try {
      await fetch('/api/marketing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'save_report',
          title:       reportTitle ?? label,
          report_type: reportType,
          body:        text,
        }),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  function toggleSection(i: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <BookOpen size={12} className="text-accent" />
          <span className="font-mono text-[10px] font-bold text-accent tracking-widest uppercase">{label}</span>
          {hasSections && (
            <span className="font-mono text-[10px] text-text-faint">· {sections.length} sections</span>
          )}
        </div>
        <button
          onClick={saveReport}
          disabled={saving || saved}
          className={clsx(
            'inline-flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
            saved
              ? 'border-ok/30 bg-ok/10 text-ok'
              : 'border-surface-rule text-text-muted hover:text-text hover:border-text-faint/40'
          )}
        >
          {saved
            ? <><Check size={11} /> Saved to reports</>
            : saving
              ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
              : <><Save size={11} /> Save to reports</>
          }
        </button>
      </div>

      {/* Sections */}
      {hasSections ? (
        sections.map((s, i) => (
          <div
            key={i}
            className="bg-surface-card border border-surface-rule rounded-xl overflow-hidden"
          >
            {s.title && (
              <button
                onClick={() => toggleSection(i)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-b border-surface-rule hover:bg-surface transition-colors text-left"
              >
                <span className="font-display font-semibold text-[13px] text-text">{s.title}</span>
                {collapsed.has(i)
                  ? <ChevronDown size={13} className="text-text-muted shrink-0" />
                  : <ChevronUp   size={13} className="text-text-muted shrink-0" />
                }
              </button>
            )}
            {!collapsed.has(i) && (
              <div className="px-4 py-3 space-y-1">
                <ul className="space-y-1">{renderBody(s.body)}</ul>
              </div>
            )}
          </div>
        ))
      ) : (
        /* Fallback: no headings — render as a single card */
        <div className="bg-surface-card border border-surface-rule rounded-xl p-4">
          <p className="text-[13px] text-text leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  )
}
