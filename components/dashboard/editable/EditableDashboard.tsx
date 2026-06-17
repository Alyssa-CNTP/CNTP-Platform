'use client'

// components/dashboard/editable/EditableDashboard.tsx
// The reusable shell behind every department dashboard. It loads the user's
// saved layout (or the code default), renders the widgets on a 12-col grid, and
// — in edit mode — lets the user drag to reorder, resize (S/M/L/Full), add, and
// remove widgets, then Save or Reset. Pass a dashboardKey + title; the widget
// catalogue and data come from the registry + DashboardDataProvider.

import { useState } from 'react'
import { format } from 'date-fns'
import { RefreshCw, Pencil, Plus, Check, X, RotateCcw } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'

import { useAuth } from '@/lib/auth/context'
import { DashboardDataProvider, useDashboardData } from '@/lib/dashboard/data'
import { useDashboardLayout } from '@/lib/dashboard/useDashboardLayout'
import { getDefaultLayout, getWidgetMeta } from '@/lib/dashboard/registry'
import type { WidgetInstance, WidgetSpan } from '@/lib/dashboard/types'
import WidgetFrame from './WidgetFrame'
import WidgetPicker from './WidgetPicker'

function uid() {
  try { return crypto.randomUUID() } catch { return `w-${Date.now()}-${Math.round(Math.random() * 1e6)}` }
}

interface Props {
  dashboardKey: string
  title:        string
  subtitle?:    string
}

export default function EditableDashboard(props: Props) {
  return (
    <DashboardDataProvider>
      <DashboardInner {...props} />
    </DashboardDataProvider>
  )
}

function DashboardInner({ dashboardKey, title, subtitle }: Props) {
  const { displayName } = useAuth()
  const { refresh, refreshing, loading: dataLoading } = useDashboardData()
  const { widgets, loading, saving, save, resetToDefault } = useDashboardLayout(dashboardKey)

  const [editing, setEditing]     = useState(false)
  const [draft, setDraft]         = useState<WidgetInstance[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const list = editing ? draft : widgets
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = displayName.split(' ')[0]

  // ── Edit-mode actions ───────────────────────────────────────────────────────
  function startEdit() { setDraft(widgets.map(w => ({ ...w }))); setEditing(true) }
  function cancelEdit() { setEditing(false); setPickerOpen(false) }
  async function commitEdit() { await save(draft); setEditing(false); setPickerOpen(false) }
  async function reset() {
    await resetToDefault()
    setDraft(getDefaultLayout(dashboardKey))
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setDraft(prev => {
      const from = prev.findIndex(w => w.instanceId === active.id)
      const to   = prev.findIndex(w => w.instanceId === over.id)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }

  function setSpan(instanceId: string, span: WidgetSpan) {
    setDraft(prev => prev.map(w => (w.instanceId === instanceId ? { ...w, span } : w)))
  }
  function remove(instanceId: string) {
    setDraft(prev => prev.filter(w => w.instanceId !== instanceId))
  }
  function add(type: string) {
    const meta = getWidgetMeta(type)
    if (!meta) return
    setDraft(prev => [...prev, { instanceId: uid(), type, span: meta.defaultSpan }])
    setPickerOpen(false)
  }

  const presentTypes = new Set(draft.map(w => w.type))

  return (
    <div className="px-4 py-5 space-y-5 max-w-[1400px] animate-in">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[28px] text-text leading-tight">{title}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="font-mono text-[12px] text-text-muted">
              {subtitle ?? `${greeting}, ${firstName}`}
            </span>
            <span className="h-3.5 w-px bg-surface-rule hidden sm:block" />
            <span className="font-mono text-[11px] text-text-faint">
              {format(new Date(), 'EEEE d MMMM yyyy')}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {!editing ? (
            <>
              <button
                onClick={refresh}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
              >
                <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
              >
                <Pencil size={11} />
                Customize
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors"
              >
                <Plus size={11} />
                Add widget
              </button>
              <button
                onClick={reset}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors disabled:opacity-50"
              >
                <RotateCcw size={11} />
                Reset
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card border border-surface-rule font-mono text-[10px] text-text-muted hover:text-text transition-colors disabled:opacity-50"
              >
                <X size={11} />
                Cancel
              </button>
              <button
                onClick={commitEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-white font-mono text-[10px] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check size={11} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── EDIT-MODE HINT ─────────────────────────────────────────────────── */}
      {editing && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand/5 border border-brand/15 font-mono text-[11px] text-brand">
          <Pencil size={12} />
          Drag the handle to reorder · use S / M / L / Full to resize · ✕ to remove · then Save
        </div>
      )}

      {/* ── GRID ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="lg:col-span-3 h-[120px] bg-surface-card border border-surface-rule rounded-2xl animate-pulse" />
          ))}
          <div className="lg:col-span-9 h-[320px] bg-surface-card border border-surface-rule rounded-2xl animate-pulse" />
          <div className="lg:col-span-3 h-[320px] bg-surface-card border border-surface-rule rounded-2xl animate-pulse" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="font-display font-bold text-[15px] text-text">No widgets yet</span>
          <span className="font-mono text-[11px] text-text-muted">
            {editing ? 'Add a widget to get started.' : 'Click Customize to build your dashboard.'}
          </span>
          {editing && (
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white font-mono text-[11px] hover:opacity-90 transition-opacity"
            >
              <Plus size={13} /> Add widget
            </button>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={list.map(w => w.instanceId)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {list.map(w => (
                <WidgetFrame
                  key={w.instanceId}
                  widget={w}
                  editing={editing}
                  onSpan={span => setSpan(w.instanceId, span)}
                  onRemove={() => remove(w.instanceId)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <WidgetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={add}
        presentTypes={presentTypes}
      />

      {dataLoading && !loading && (
        <div className="font-mono text-[10px] text-text-faint">Loading live data…</div>
      )}
    </div>
  )
}
