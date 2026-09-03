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
 * So the catalogue is built once per screen and everything else stays sync.
 * Until it exists — and whenever the flag is off — this falls back to the
 * templates, which is exactly today's behaviour.
 *
 * ── One read, not two ───────────────────────────────────────────────────────
 *
 * The rows come from loadAllInventory(), which is already cached and which the
 * item pickers already call. The feature briefly owned its own loader; that
 * made a Refining capture screen fetch the same ~630-row table twice per load.
 * A feature must not make a core screen slower, so the app loads once and
 * hands the rows over.
 *
 * ── Why this cannot break capture ───────────────────────────────────────────
 *
 * This is a HOOK, called by the capture page itself — so <FeatureBoundary>
 * cannot protect it. An error boundary catches a throw from a child component
 * during render; it cannot catch one from a hook the page called. If anything
 * in the resolver threw, an operator mid-shift would lose the screen.
 *
 * So every resolver call is wrapped and falls back to the template path on any
 * throw. The templates are the behaviour that shipped for months; degrading to
 * them is safe, and it is strictly better than a blank screen with a
 * half-captured session behind it. See the tests in use-item-codes.test.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { flags } from '@/lib/config/flags'
import {
  resolveItem, resolveInputItem, explain,
  type Catalogue, type ItemResolution,
} from '@/features/acumatica-items'
import { loadAllInventory, catalogueFrom } from '@/lib/production/inventory'
import {
  getAcumaticaCode, getInputAcumaticaCode, type AcumaticaCode,
} from '@/lib/production/acumatica-codes'

export interface ItemCodes {
  /** True once the resolver is active AND its catalogue is built. */
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

/**
 * Run a resolver call, falling back to `orElse` if it throws.
 *
 * Deliberately not silent: the console line is how a resolver bug gets found,
 * and swallowing it entirely would let capture run on the template path for
 * weeks with nobody knowing why the stricter warnings stopped appearing.
 */
function safely<T>(what: string, attempt: () => T, orElse: () => T): T {
  try {
    return attempt()
  } catch (err) {
    console.error(`[acumatica-items] ${what} threw; falling back to the code templates.`, err)
    return orElse()
  }
}

/**
 * The pure half: given a catalogue (or null), how do we answer?
 *
 * Split out from the hook so the fallback behaviour can be tested directly,
 * including the case where the catalogue itself is hostile.
 */
export function itemCodesFrom(catalogue: Catalogue | null): ItemCodes {
  const ready = flags.acumaticaResolver && catalogue !== null

  return {
    ready,
    source: ready ? 'resolver' : 'template',

    codeFor(productType, variant, grade) {
      if (!ready) return getAcumaticaCode(productType, variant, grade)
      return safely(
        'codeFor',
        () => toCode(resolveItem(catalogue!, { productType, variant, grade })),
        () => getAcumaticaCode(productType, variant, grade),
      )
    },

    inputCodeFor(grade, variant) {
      if (!ready) return getInputAcumaticaCode(grade, variant)
      return safely(
        'inputCodeFor',
        () => toCode(resolveInputItem(catalogue!, grade, variant)),
        () => getInputAcumaticaCode(grade, variant),
      )
    },

    problemFor(productType, variant, grade) {
      if (!ready) return null
      // A failure here must not invent a warning either — no news is the safe
      // answer, and the console line above records what happened.
      return safely(
        'problemFor',
        () => {
          const r = resolveItem(catalogue!, { productType, variant, grade })
          return isProblem(r) ? explain(r) : null
        },
        () => null,
      )
    },
  }
}

export function useItemCodes(): ItemCodes {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)

  useEffect(() => {
    if (!flags.acumaticaResolver) return
    let live = true
    loadAllInventory()
      .then(rows => { if (live) setCatalogue(catalogueFrom(rows)) })
      // A failed load leaves the catalogue null, which falls through to the
      // templates. Capture keeps working; it just does not get the stricter
      // answers until the next page load.
      .catch(err => { console.error('[acumatica-items] inventory load failed.', err) })
    return () => { live = false }
  }, [])

  // Stable across renders while the catalogue is unchanged: several call sites
  // sit inside render, and a fresh object each time would churn any child that
  // receives one of these functions as a prop.
  return useMemo(() => itemCodesFrom(catalogue), [catalogue])
}
