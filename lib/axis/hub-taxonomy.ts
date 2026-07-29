// lib/axis/hub-taxonomy.ts
// Shared taxonomy for the AXIS "Intelligence Hub" radial — the business
// functions (wedges) and capability layers (rings) that axis.change_logs
// entries get auto-classified into. Used by both the categorize prompt
// (lib/axis/categorize.ts) and the visualization (components/axis/IntelligenceHub.tsx),
// so the two never drift apart.
//
// Free-text on the DB side (no CHECK constraint) — this file is the single
// source of truth for what's valid. Adding a 9th function or 7th layer is a
// change here only, no migration required.

import {
  Eye, Brain, GitFork, Zap, TrendingUp, ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

export const BUSINESS_FUNCTIONS = [
  'sales', 'marketing', 'production', 'quality',
  'supply', 'finance', 'logistics', 'hr',
] as const
export type BusinessFunction = typeof BUSINESS_FUNCTIONS[number]

export const CAPABILITY_LAYERS = [
  'sense', 'interpret', 'decide', 'orchestrate', 'learn', 'govern',
] as const
export type CapabilityLayer = typeof CAPABILITY_LAYERS[number]

export const FUNCTION_LABEL: Record<BusinessFunction, string> = {
  sales: 'Sales', marketing: 'Marketing', production: 'Production', quality: 'Quality',
  supply: 'Supply', finance: 'Finance', logistics: 'Logistics', hr: 'HR',
}

// Deck-matching navy palette — deliberately scoped to this panel only, not
// part of the app-wide (green) design system in app/globals.css.
export const FUNCTION_HUE: Record<BusinessFunction, string> = {
  sales:      '#2E75B6',
  marketing:  '#7EC8E3',
  production: '#1F3864',
  quality:    '#4472A8',
  supply:     '#5B8FB9',
  finance:    '#E8A020',
  logistics:  '#8FAEC9',
  hr:         '#3D5A80',
}

export const LAYER_LABEL: Record<CapabilityLayer, string> = {
  sense: 'Sense', interpret: 'Interpret', decide: 'Decide',
  orchestrate: 'Orchestrate', learn: 'Learn', govern: 'Govern',
}

export const LAYER_DESCRIPTION: Record<CapabilityLayer, string> = {
  sense:       'Data capture, ingestion, monitoring, logging',
  interpret:   'Analysis, dashboards, reporting, classification',
  decide:      'Rules, scoring, recommendation logic, decision support',
  orchestrate: 'Workflow automation, integrations, triggers, actions',
  learn:       'Feedback loops, retraining, continuous improvement',
  govern:      'Access control, security, compliance, audit',
}

export const LAYER_ICON: Record<CapabilityLayer, LucideIcon> = {
  sense: Eye, interpret: Brain, decide: GitFork,
  orchestrate: Zap, learn: TrendingUp, govern: ShieldCheck,
}

export function isBusinessFunction(v: unknown): v is BusinessFunction {
  return typeof v === 'string' && (BUSINESS_FUNCTIONS as readonly string[]).includes(v)
}

export function isCapabilityLayer(v: unknown): v is CapabilityLayer {
  return typeof v === 'string' && (CAPABILITY_LAYERS as readonly string[]).includes(v)
}
