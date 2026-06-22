// lib/dashboard/types.ts
// Shared vocabulary for the user-editable dashboards.
//
// A dashboard is an ordered list of WidgetInstance rows. The registry
// (lib/dashboard/registry.tsx) maps each `type` to a component + metadata.
// Layouts are persisted per-user in shared.dashboard_layouts.

// Width presets on the 12-column grid. Below the `lg` breakpoint every widget
// stretches full width, so these only take effect on wide screens.
//   sm   → 3 cols (KPI tiles, four-up; or a narrow side panel)
//   md   → 6 cols (half width — charts, panels)
//   lg   → 9 cols (three-quarters — the floor map next to a narrow feed)
//   full → 12 cols (uptime grid, anything that wants the whole row)
export type WidgetSpan = 'sm' | 'md' | 'lg' | 'full'

export const SPAN_COLS: Record<WidgetSpan, string> = {
  sm:   'lg:col-span-3',
  md:   'lg:col-span-6',
  lg:   'lg:col-span-9',
  full: 'lg:col-span-12',
}

export const SPAN_LABEL: Record<WidgetSpan, string> = {
  sm:   'S',
  md:   'M',
  lg:   'L',
  full: 'Full',
}

export const SPAN_ORDER: WidgetSpan[] = ['sm', 'md', 'lg', 'full']

// A single placed widget. Array order in the layout IS the display order.
export interface WidgetInstance {
  instanceId: string        // stable id for React keys + dnd-kit
  type:       string        // key into the widget registry
  span:       WidgetSpan
}

// Persisted shape of a row in shared.dashboard_layouts.
export interface DashboardLayoutRow {
  user_id:       string
  dashboard_key: string
  widgets:       WidgetInstance[]
  updated_at:    string
}
