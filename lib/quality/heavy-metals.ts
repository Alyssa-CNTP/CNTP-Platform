/**
 * The heavy metals a COA can carry a limit for — one list, because it was
 * previously written out by hand in four places (CoaSpecsTab's CONTAM_FIELDS,
 * its heavyMetals badge test, and twice in the COA builder). Adding an element
 * meant finding all four, and missing one meant a customer could enter a limit
 * that the COA then never printed.
 *
 * Order is the order they appear on a COA and in the spec editor.
 */
export const HEAVY_METALS: readonly { key: string; label: string }[] = [
  { key: 'lead',     label: 'Lead' },
  { key: 'cadmium',  label: 'Cadmium' },
  { key: 'mercury',  label: 'Mercury' },
  { key: 'arsenic',  label: 'Arsenic' },
  { key: 'chromium', label: 'Chromium' },
  { key: 'copper',   label: 'Copper' },
]

export const HEAVY_METAL_KEYS: readonly string[] = HEAVY_METALS.map(m => m.key)

/** Label for a metal key, falling back to a capitalised key for anything unknown. */
export function heavyMetalLabel(key: string): string {
  return HEAVY_METALS.find(m => m.key === key)?.label ?? (key.charAt(0).toUpperCase() + key.slice(1))
}

/**
 * A spec field counts as "required" only if it holds a real value. Blank means
 * nothing was entered; the literal 'NOT REQUIRED' is how the client spec sheet
 * writes an analysis this customer does not want, and it appears in hundreds of
 * cells — treating that string as a limit would print an empty row on the COA.
 *
 * Same rule as the COA builder's own `req()`, deliberately: these two decided
 * "is this analysis required?" separately before, and CoaSpecsTab's badge used a
 * plain truthiness test, so a spec saying NOT REQUIRED still lit the "Metals"
 * badge.
 */
export function specFieldRequired(v: unknown): boolean {
  if (v == null) return false
  const s = String(v).trim()
  return s !== '' && s.toUpperCase() !== 'NOT REQUIRED'
}

/** Does this spec's contaminants block ask for any heavy metal at all? */
export function wantsHeavyMetals(contaminants: Record<string, unknown> | null | undefined): boolean {
  if (!contaminants) return false
  return HEAVY_METAL_KEYS.some(k => specFieldRequired(contaminants[k]))
}

/** The metals this spec actually asks for, in COA order, as "Lead <3.0" strings. */
export function heavyMetalSpecParts(contaminants: Record<string, unknown> | null | undefined): string[] {
  if (!contaminants) return []
  return HEAVY_METALS
    .filter(m => specFieldRequired(contaminants[m.key]))
    .map(m => `${m.label} ${String(contaminants[m.key]).trim()}`)
}
