'use client'

// lib/dashboard/registry.tsx
// The catalogue of widgets that can live on a dashboard, plus the code-defined
// default layout per dashboard. Adding a widget to a department = adding an
// entry here and (if new) a component in components/dashboard/editable/widgets.
//
// `requiredPermission` lets the picker hide widgets a user can't use. Route-level
// guards still apply — this is the finer-grained, per-widget filter.

import {
  Target, Settings2, BarChart2, Tag, Scale, ClipboardList, AlertTriangle,
  Map, Activity, NotebookPen, CalendarDays,
} from 'lucide-react'
import type { PermissionKey } from '@/lib/auth/permissions'
import type { WidgetInstance, WidgetSpan } from './types'
import { WIDGET_COMPONENTS } from '@/components/dashboard/editable/widgets'

export type WidgetCategory = 'kpi' | 'production' | 'personal'

export interface WidgetMeta {
  type:         string
  label:        string
  description:  string
  icon:         React.ReactNode
  category:     WidgetCategory
  defaultSpan:  WidgetSpan
  allowedSpans: WidgetSpan[]
  requiredPermission?: PermissionKey
  component:    React.ComponentType
}

// ── Metadata, keyed by widget type ───────────────────────────────────────────
const META: Omit<WidgetMeta, 'component'>[] = [
  { type: 'kpi-accuracy',  label: 'Count Accuracy',  description: '30-day average match rate.',        icon: <Target size={16} />,        category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-sections',  label: 'Active Sections', description: 'Sections running today.',           icon: <Settings2 size={16} />,     category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-yield',     label: 'Avg Yield',       description: "Today's average mass-balance yield.",icon: <BarChart2 size={16} />,    category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-tags',      label: 'Bag Tags',        description: 'Bags tagged today.',                icon: <Tag size={16} />,           category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-tagkg',     label: 'Tagged Weight',   description: 'Total tagged weight today.',        icon: <Scale size={16} />,         category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-sessions',  label: 'Count Sessions',  description: 'Completed counts in last 30 days.', icon: <ClipboardList size={16} />, category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },
  { type: 'kpi-variances', label: 'Variances',       description: 'Counts with differences (30 days).',icon: <AlertTriangle size={16} />, category: 'kpi', defaultSpan: 'sm', allowedSpans: ['sm', 'md'] },

  { type: 'floor-map',     label: 'Factory Floor',   description: 'Live floor plan with section status.', icon: <Map size={16} />,        category: 'production', defaultSpan: 'lg',   allowedSpans: ['md', 'lg', 'full'] },
  { type: 'uptime-grid',   label: 'Section Uptime',  description: "Per-section status for today's sessions.", icon: <Settings2 size={16} />, category: 'production', defaultSpan: 'full', allowedSpans: ['full'] },
  { type: 'activity-feed', label: 'Live Activity',   description: 'Recent counts and production events.', icon: <Activity size={16} />,   category: 'production', defaultSpan: 'sm',   allowedSpans: ['sm', 'md'] },
  { type: 'yield-chart',   label: 'Yield by Section',description: "Bar chart of today's yield per section.", icon: <BarChart2 size={16} />, category: 'production', defaultSpan: 'md',  allowedSpans: ['md', 'lg', 'full'] },

  { type: 'notepad',       label: 'Notepad',         description: 'Your private scratch notes.',       icon: <NotebookPen size={16} />,   category: 'personal', defaultSpan: 'md', allowedSpans: ['sm', 'md', 'lg'] },
  { type: 'mini-calendar', label: 'Count Calendar',  description: 'Calendar of historical count sessions.', icon: <CalendarDays size={16} />, category: 'personal', defaultSpan: 'md', allowedSpans: ['sm', 'md'] },
]

export const WIDGET_REGISTRY: Record<string, WidgetMeta> = Object.fromEntries(
  META
    .filter(m => WIDGET_COMPONENTS[m.type])           // skip metadata with no component
    .map(m => [m.type, { ...m, component: WIDGET_COMPONENTS[m.type] }]),
)

export function getWidgetMeta(type: string): WidgetMeta | undefined {
  return WIDGET_REGISTRY[type]
}

// ── Default layouts, keyed by dashboard_key ──────────────────────────────────
function inst(type: string, span: WidgetSpan): WidgetInstance {
  return { instanceId: `def-${type}`, type, span }
}

const DEFAULT_LAYOUTS: Record<string, WidgetInstance[]> = {
  production: [
    inst('kpi-accuracy', 'sm'),
    inst('kpi-sections', 'sm'),
    inst('kpi-yield',    'sm'),
    inst('kpi-tags',     'sm'),
    inst('floor-map',    'lg'),
    inst('activity-feed','sm'),
    inst('uptime-grid',  'full'),
    inst('yield-chart',  'md'),
    inst('notepad',      'md'),
  ],
}

export function getDefaultLayout(dashboardKey: string): WidgetInstance[] {
  // Return a fresh copy so callers can mutate freely.
  return (DEFAULT_LAYOUTS[dashboardKey] ?? []).map(w => ({ ...w }))
}

// ── Picker helpers ───────────────────────────────────────────────────────────
// Widgets the user is allowed to add, optionally filtered by a permission test.
export function listAddableWidgets(can: (k: PermissionKey) => boolean): WidgetMeta[] {
  return Object.values(WIDGET_REGISTRY).filter(
    m => !m.requiredPermission || can(m.requiredPermission),
  )
}
