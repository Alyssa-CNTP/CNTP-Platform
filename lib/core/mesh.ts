/**
 * Sieving screen configuration — the three mesh sizes, and how they are written.
 *
 * The Rotex runs three decks. Until now the "Sieving configuration" check was a
 * free-text box with the hint "State the screen configuration in use", so what
 * landed in `production.check_events.value_text` was whatever the operator
 * typed: `#12 #14 #16`, `12/14/16`, `top 12 mid 14 bot 16`, `#12,#14,#16`.
 *
 * Four screens read that string back — the Shift Report, Batch Consolidation,
 * the batch API and yield analytics — and none of them can group or compare
 * free text. Two shifts that ran the identical configuration do not match.
 *
 * So the operator now fills in three numbers and this module writes the string.
 * The `#` is the app's job, not something to remember to type.
 *
 * Format: `#12 / #14 / #16` — top deck first, down the machine.
 */

export const MESH_DECKS = ['Top', 'Middle', 'Bottom'] as const
export type MeshDeck = typeof MESH_DECKS[number]

/** A blank deck is written as this, so the position of the others is not lost. */
const ABSENT = '—'

/**
 * Build the stored configuration string from the three deck sizes.
 *
 * Sizes are kept as strings rather than numbers because a mesh size is a
 * label, not a quantity: it is never summed or averaged, and some screens are
 * designated with a letter or a fraction rather than a plain integer. Anything
 * non-numeric the operator types is preserved as typed.
 *
 * Returns '' when every deck is blank, so a caller can tell "not filled in"
 * from "filled in as three blanks".
 */
export function formatMeshConfig(sizes: readonly (string | null | undefined)[]): string {
  const cleaned = MESH_DECKS.map((_, i) => String(sizes[i] ?? '').trim())
  if (cleaned.every(s => s === '')) return ''
  return cleaned.map(s => (s === '' ? ABSENT : `#${s.replace(/^#+/, '')}`)).join(' / ')
}

/**
 * Read the three deck sizes back out of a stored string.
 *
 * Deliberately generous, because it has to cope with everything the free-text
 * box accepted before this existed. It takes the numbers in the order they
 * appear and drops the separators, so `#12 / #14 / #16`, `12/14/16`,
 * `#12 #14 #16` and `top 12 mid 14 bottom 16` all restore to the same three
 * fields.
 *
 * Always returns exactly three entries, blank where a deck is absent, so the
 * caller can index the decks without a length check.
 */
export function parseMeshConfig(stored: string | null | undefined): string[] {
  const text = String(stored ?? '').trim()
  if (text === '') return MESH_DECKS.map(() => '')

  // A string this module wrote is slot-delimited, and the slots carry the deck
  // positions — read them positionally so a blank middle deck stays in the
  // middle. Scanning for numbers instead would return ['12','16',''] for
  // '#12 / — / #16' and silently move the bottom deck up one.
  if (text.includes('/')) {
    const slots = text.split('/').map(s => s.trim())
    if (slots.length === MESH_DECKS.length) {
      return slots.map(s => (s === ABSENT ? '' : s.replace(/^#+/, '').trim()))
    }
  }

  // Anything else is free text from before this existed: take the numbers in
  // the order they appear. Note the number pattern allows '.' but NOT '/' —
  // '/' is a separator here, and treating it as part of a number reads
  // '12/14/16' as the single token '12/14'.
  const found = text.match(/\d+(?:\.\d+)?/g) ?? []
  return MESH_DECKS.map((_, i) => found[i] ?? '')
}

/**
 * Whether a stored string round-trips — i.e. re-formatting what we parsed gives
 * back the same string.
 *
 * Used to decide whether an old free-text value can safely be shown in the
 * three boxes, or whether it should be left visible as-is so the operator can
 * see what was actually recorded before overwriting it.
 */
export function isCanonicalMeshConfig(stored: string | null | undefined): boolean {
  const s = String(stored ?? '').trim()
  if (s === '') return true
  return formatMeshConfig(parseMeshConfig(s)) === s
}
