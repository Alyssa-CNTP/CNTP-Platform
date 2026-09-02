'use client'

/**
 * The one place the app chooses between the two ways of getting an Acumatica
 * item code, so no capture screen has to know there are two.
 *
 *     const codes = useItemCodes()
 *     const acu = codes.codeFor(productType, variant, grade)   // same shape as before
 *     const problem = codes.problemFor(productType, variant, grade)
 *
 * ── Why an adapter and not a direct swap ────────────────────────────────────
 *
 * `getAcumaticaCode()` is synchronous: it builds an id from a template. The
 * resolver is synchronous too, but only once the master inventory is in memory,
 * and that is a network read. Several call sites are inside render, so making
 * them async would mean threading promises through JSX.
 *
 * So the catalogue loads once per screen and everything else stays sync. Until
 * it arrives — and whenever the flag is off — this falls back to the templates,
 * which is exactly today's behaviour.
 *
 * ── Why this lives here and not in the feature ──────────────────────────────
 *
 * features/acumatica-items must not know the legacy module exists; a feature
 * that reaches back into the code it replaces can never be finished. The app
 * owns the changeover, so the adapter is app-side. When the flag is on
 * everywhere and the templates are deleted, this file collapses to a hook that
 * returns the resolver and nothing else.
 *
 * Note lib/production/inventory.ts already imports from the feature, so the
 * feature deliberately keeps its own loader rather than calling
 * loadAllInventory() — that direction would be a cycle.
 */
import { useEffect, useState } from 'react'
import { flags } from '@/lib/config/flags'
import {
  loadCatalogue, resolveItem, resolveInputItem, explain,
  type Catalogue, type ItemResolution,
} from '@/features/acumatica-items'
import {
  getAcumaticaCode, getInputAcumaticaCode, type AcumaticaCode,
} from '@/lib/production/acumatica-codes'

export interface ItemCodes {
  /** True once the resolver is active AND its catalogue has loaded. */
  ready: boolean
  /** Which path the answers below are coming from right now. */
  source: 'resolver' | 'template'
  /** The item code for a production output, or null when there isn't one. */
  codeFor(productType: string, variant: string, grade: string): AcumaticaCode | null
  /** The item code for the farm-bag raw material consumed at Sieving. */
  inputCodeFor(grade: string, variant: string): AcumaticaCode | null
  /**
   * A line to show the operator when there is no code AND that is a problem.
   *
   * Null in three cases: the code resolved; the product legitimately has no
   * Acumatica item (waste, a blend, a packing format); or the resolver is not
   * running, in which case we genuinely do not know whether a blank is
   * correct — which is the ambiguity the resolver exists to remove.
   */
  problemFor(productType: string, variant: string, grade: string): string | null
}

function toCode(r: ItemResolution): AcumaticaCode | null {
  if (r.kind !== 'resolved') return null
  return {
    inventoryId: r.item.inventoryId,
    description: r.item.description,
    ...(r.phantomId ? { phantomId: r.phantomId } : {}),
    isPhantom: false,
  }
}

/** Only these two mean "we looked and it is missing"; the rest are fine or unknowable. */
function isProblem(r: ItemResolution): boolean {
  return r.kind === 'not-stocked' || r.kind === 'unknown-product'
}

export function useItemCodes(): ItemCodes {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)

  useEffect(() => {
    if (!flags.acumaticaResolver) return
    let live = true
    loadCatalogue()
      .then(c => { if (live) setCatalogue(c) })
      // A failed load leaves the catalogue null, which falls through to the
      // templates below. Capture keeps working; it just does not get the
      // stricter answers until the next page load.
      .catch(() => {})
    return () => { live = false }
  }, [])

  const ready = flags.acumaticaResolver && catalogue !== null

  return {
    ready,
    source: ready ? 'resolver' : 'template',

    codeFor(productType, variant, grade) {
      if (!ready) return getAcumaticaCode(productType, variant, grade)
      return toCode(resolveItem(catalogue!, { productType, variant, grade }))
    },

    inputCodeFor(grade, variant) {
      if (!ready) return getInputAcumaticaCode(grade, variant)
      return toCode(resolveInputItem(catalogue!, grade, variant))
    },

    problemFor(productType, variant, grade) {
      if (!ready) return null
      const r = resolveItem(catalogue!, { productType, variant, grade })
      return isProblem(r) ? explain(r) : null
    },
  }
}
