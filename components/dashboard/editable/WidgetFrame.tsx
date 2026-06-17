'use client'

// components/dashboard/editable/WidgetFrame.tsx
// Wraps a single widget on the grid. In view mode it renders the widget bare
// (widgets carry their own card styling). In edit mode it adds a toolbar with a
// drag handle, size toggle, and remove button, and disables interaction with the
// widget itself so dragging/clicking chrome never triggers links inside.

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { SPAN_COLS, SPAN_LABEL, SPAN_ORDER, type WidgetInstance, type WidgetSpan } from '@/lib/dashboard/types'
import { getWidgetMeta } from '@/lib/dashboard/registry'

interface Props {
  widget:   WidgetInstance
  editing:  boolean
  onSpan:   (span: WidgetSpan) => void
  onRemove: () => void
}

export default function WidgetFrame({ widget, editing, onSpan, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.instanceId,
    disabled: !editing,
  })

  const meta = getWidgetMeta(widget.type)
  const spanClass = SPAN_COLS[widget.span]

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }

  if (!meta) {
    // Unknown widget type (e.g. removed from the build) — render nothing in view
    // mode, a small placeholder in edit mode so the user can drop it.
    if (!editing) return null
    return (
      <div ref={setNodeRef} style={style} className={`col-span-1 ${spanClass}`}>
        <div className="rounded-2xl border border-dashed border-surface-rule p-4 font-mono text-[11px] text-text-faint">
          Unknown widget: {widget.type}
          <button onClick={onRemove} className="ml-2 text-err underline">remove</button>
        </div>
      </div>
    )
  }

  const Widget = meta.component
  const allowedSpans = SPAN_ORDER.filter(s => meta.allowedSpans.includes(s))

  if (!editing) {
    return (
      <div className={`col-span-1 ${spanClass}`}>
        <Widget />
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className={`col-span-1 ${spanClass}`}>
      <div className="rounded-2xl ring-2 ring-brand/30 ring-offset-2 ring-offset-surface overflow-hidden">
        {/* Edit toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-brand/5 border-b border-brand/15">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text touch-none"
            aria-label="Drag to reorder"
          >
            <GripVertical size={15} />
          </button>
          <span className="flex items-center gap-1.5 font-body font-semibold text-[12px] text-text truncate">
            <span className="text-text-muted">{meta.icon}</span>
            {meta.label}
          </span>

          {/* Size toggle */}
          {allowedSpans.length > 1 && (
            <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-surface border border-surface-rule p-0.5">
              {allowedSpans.map(s => (
                <button
                  key={s}
                  onClick={() => onSpan(s)}
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] transition-colors ${
                    widget.span === s ? 'bg-brand text-white' : 'text-text-muted hover:text-text'
                  }`}
                >
                  {SPAN_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          {/* Remove */}
          <button
            onClick={onRemove}
            className={`${allowedSpans.length > 1 ? '' : 'ml-auto'} w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-err hover:bg-err/10 transition-colors`}
            aria-label="Remove widget"
          >
            <X size={14} />
          </button>
        </div>

        {/* Widget preview — interaction disabled while editing */}
        <div className="p-2 pointer-events-none select-none">
          <Widget />
        </div>
      </div>
    </div>
  )
}
