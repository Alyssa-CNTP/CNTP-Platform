// lib/axis/categorize.ts
// Server-only. Classifies a single axis.change_logs entry onto the Intelligence
// Hub's two axes (business function x capability layer) via Gemini. Wraps
// lib/intelligence/gemini.ts's queryGeminiDetailed (shared model-fallback
// chain, never throws) combined with app/api/upload/route.ts's technique of
// an explicit JSON-skeleton embedded in the prompt + a small fence-stripping
// parser — this file owns its own copy of that parser since it's a generic,
// dependency-free utility, not something worth cross-importing from a route.
//
// Called only by app/api/axis/categorize/run/route.ts (a background job) —
// never on the request path of a normal write, so a slow/failed Gemini call
// here never blocks a user action.

import { queryGeminiDetailed } from '@/lib/intelligence/gemini'
import {
  BUSINESS_FUNCTIONS, CAPABILITY_LAYERS,
  isBusinessFunction, isCapabilityLayer,
  type BusinessFunction, type CapabilityLayer,
} from './hub-taxonomy'

// Shared pacing across every call site (manual button + cron both import this
// module), so concurrent triggers can never burst the Gemini API.
const GEMINI_MIN_GAP_MS = 4500
let lastCallAt = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, lastCallAt + GEMINI_MIN_GAP_MS - Date.now())
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
  return fn()
}

function parseJSON(raw: string): any {
  if (!raw || typeof raw !== 'string') throw new Error('Empty response from AI model')
  const clean = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()
  const objStart = clean.indexOf('{'), objEnd = clean.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) return JSON.parse(clean.slice(objStart, objEnd + 1))
  return JSON.parse(clean)
}

const SYSTEM_PROMPT = `You are a classifier for CNTP's internal AXIS change log. CNTP is a South African rooibos/rosehip export and processing company. Given one logged change (an IT/engineering change, or a merged code PR), classify it onto exactly two axes.

BUSINESS FUNCTION — which part of the business does this change primarily serve? Pick exactly one:
- sales: customer-facing commercial systems, CRM, quoting, order intake
- marketing: campaigns, content, brand, market intelligence tooling
- production: factory floor capture, batching, blending, live sessions, roster
- quality: QMS, lab results, specs, compliance testing, COA
- supply: raw material sourcing, supplier data, inventory/BOM
- finance: Acumatica sync, invoicing, cost/margin, financial reporting
- logistics: dispatch, warehouse, forklift, shipping, order reconciliation
- hr: staff directory, training, competency, roster, timesheets

CAPABILITY LAYER — which layer of the "AI-native intelligence stack" does this change represent? Pick exactly one:
- sense: new data capture, sensors, ingestion, logging
- interpret: parsing, extraction, classification, analysis of raw data
- decide: dashboards, KPIs, alerts, decision-support surfaces
- orchestrate: automation, workflow routing, job/task execution, integration
- learn: AI/ML models, feedback loops, continuous improvement
- govern: permissions, audit, compliance, review workflows, security

You will also be given this entry's existing technical category tag (its "sector") — one of: applications-code, ai-ml, software-saas, infrastructure-hardware, security-governance, operations-continuity, projects-portfolios. This is a useful HINT (e.g. ai-ml often maps to "learn", security-governance often maps to "govern"), but it is NOT authoritative — the free-text description is the primary evidence. Do not default to a mechanical 1:1 mapping between sector and layer.

Always pick the single closest-fit value from each list, even if the entry seems generic or purely internal-infrastructure — never leave a field blank and never invent a label outside these lists.

Respond with ONLY this exact JSON shape, no markdown fences, no commentary:
{"business_function":"","capability_layer":"","confidence":0.0,"reasoning":""}
confidence is 0.0-1.0 (your own certainty). reasoning is one short clause (under 100 characters) explaining the pick, shown to IT on hover — do not restate the input.`

export interface CategorizeInput {
  id: string
  sector: string
  change_type: string
  description: string
  reason: string | null
  affected_systems: string | null
  source: string
}

export interface CategorizeResult {
  business_function: BusinessFunction | null
  capability_layer: CapabilityLayer | null
  confidence: number | null
  reasoning: string | null
  model: string | null
  ok: boolean
}

export async function classifyChangeLog(input: CategorizeInput): Promise<CategorizeResult> {
  const prompt = `sector: ${input.sector}
change_type: ${input.change_type}
description: ${input.description}
reason: ${input.reason ?? '(none given)'}
affected_systems: ${input.affected_systems ?? '(none given)'}
source: ${input.source}`

  const result = await paced(() => queryGeminiDetailed({
    prompt,
    systemOverride: SYSTEM_PROMPT,
    maxTokens: 200,
    temperature: 0.1,
  }))

  if (!result.ok) {
    return { business_function: null, capability_layer: null, confidence: null,
      reasoning: null, model: result.model, ok: false }
  }

  try {
    const parsed = parseJSON(result.response)
    const bf = isBusinessFunction(parsed.business_function) ? parsed.business_function : null
    const cl = isCapabilityLayer(parsed.capability_layer) ? parsed.capability_layer : null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : null
    return { business_function: bf, capability_layer: cl, confidence, reasoning,
      model: result.model, ok: bf !== null && cl !== null }
  } catch {
    return { business_function: null, capability_layer: null, confidence: null,
      reasoning: null, model: result.model, ok: false }
  }
}

export { BUSINESS_FUNCTIONS, CAPABILITY_LAYERS }
