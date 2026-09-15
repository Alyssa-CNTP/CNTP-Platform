/**
 * Reading a blend code the way the floor reads it.
 *
 * A Blender bag is identified by its blend, and the blend's id in Acumatica is
 * a packed string: `25SFCKUN25C`. The floor does not call it that. It calls it
 * SFC-KUN25 — the blend type, then the recipe or customer it is made for. The
 * leading `25` is the range prefix and the trailing letters are the variant,
 * and neither belongs on a bag label that already shows the variant in its own
 * corner.
 *
 * Until now the Blender wrote `Blend 25SGNAT26C-1` as the bag's product_type,
 * so Bag Tracking, the printed label and every product picker showed a string
 * no operator uses.
 *
 * ── Why this fails closed ─────────────────────────────────────────────────
 *
 * A blend type that is not in BLEND_TYPES cannot be split, because the split
 * point is not derivable from the string — `SFCKUN25` could be SFC + KUN25 or
 * SF + CKUN25, and nothing in the characters says which. Guessing is not an
 * option here for the same reason `resolveTypeCode` refuses to guess a serial
 * type code (ARCHITECTURE.md §5): once it is printed on a bag, a guessed name
 * is indistinguishable from a real one.
 *
 * So an unrecognised code comes back verbatim with `configured: false`, and
 * the caller says so rather than inventing a hyphen. Add the type to
 * BLEND_TYPES to configure it — that list is the whole contract.
 *
 * Pure: no React, no I/O. See ARCHITECTURE.md §2.
 */

/**
 * Blend types currently run on the two blenders, longest first.
 *
 * Order is load-bearing: `SFC` must be tested before `SC` and `SE`, or
 * `SFCKUN25` matches nothing sensible. Sorting at use time rather than
 * trusting the literal order keeps a later edit from quietly breaking it.
 *
 * Derived from production.bom_components for work centres 05-BLENDER BIG and
 * 05-BLENDER SMALL. Extend it here when a new blend type is introduced.
 */
export const BLEND_TYPES = ['SFC', 'SG', 'SE', 'SC', 'CH'] as const
export type BlendType = typeof BLEND_TYPES[number]

/**
 * The trailing variant, and the optional run suffix that can follow it.
 *
 * `RO`/`RC` are alternated before `O`/`C` so the regex prefers the longer
 * match — otherwise `25SFCKUN23RO` reads as an organic blend called KUN23R
 * instead of an RA-Organic one called KUN23.
 *
 * Only `O`, `C`, `RO` and `RC` are variants. The letter BEFORE them is a
 * grade, not part of the variant: `25SE40F60CBO` is grade B organic, and
 * treating `BO` as the suffix would silently rename the blend from F60CB to
 * F60C. `25SE60F40CAC` / `25SG27F73CCC` are the same shape.
 *
 * The run suffix (`-1` in `25SGNAT26C-1`) sits AFTER the variant and stays in
 * the name: 25SGNAT26C and 25SGNAT26C-1 are two different BOMs, and merging
 * them would put two blends' bags under one name.
 *
 * The variant is not lost by being dropped here — it stays on
 * `bag_tags.variant` and in the label's own corner badge. It is removed only
 * from the NAME, where it would be a second copy of something already shown.
 */
const VARIANT_RE = /(RO|RC|O|C)(-\d+)?$/

/** The leading range prefix: two digits, optionally followed by `BL`. */
const PREFIX_RE = /^(\d{2})(BL)?/i

export interface ParsedBlendCode {
  /** The original code, untouched. Always present. */
  raw: string
  /** Blend type including any numeric qualifier — `SFC`, `SFC30`, `SG14`. */
  type: string | null
  /** What the blend is made for — `KUN25`, `NAT26-1`. */
  qualifier: string | null
  /** The variant letters stripped off the end, if any. */
  variantSuffix: string | null
  /**
   * The floor-facing name: `SFC-KUN25`.
   *
   * Falls back to `raw` when the code could not be parsed, so a caller that
   * ignores `configured` still shows something true rather than something
   * empty — but see `configured` before printing it as a name.
   */
  display: string
  /**
   * False when the blend type is not in BLEND_TYPES. `display` is then the raw
   * code, and a screen showing it should say the blend is not configured
   * rather than presenting a derived name it did not derive.
   */
  configured: boolean
}

/**
 * Split a blend code into type, qualifier and variant.
 *
 * `25SFCKUN25C` → type SFC, qualifier KUN25, variant C, display `SFC-KUN25`.
 * `25SFC30KUN25C` → type SFC30 — digits immediately after a known type are
 * part of the type, not the qualifier, because that is how the floor reads
 * SFC30 and SFC100 (they are different blends, not different customers).
 */
export function parseBlendCode(code: string | null | undefined): ParsedBlendCode {
  const raw = (code ?? '').trim()
  const unparsed: ParsedBlendCode = {
    raw, type: null, qualifier: null, variantSuffix: null, display: raw, configured: false,
  }
  if (!raw) return unparsed

  // Uppercased throughout: these codes are typed by hand in several places and
  // a name that changes case with its input is two names.
  const code_ = raw.toUpperCase()

  // 1. Strip the range prefix (`25`, `25BL`). A code without one — `CL-100C-A-O`
  //    — is left whole; it is not in the packed format and must not be chopped.
  const prefix = PREFIX_RE.exec(code_)
  if (!prefix) return unparsed
  let rest = code_.slice(prefix[0].length)

  // 2. Longest known type first, so SFC wins over SC/SE.
  const types = [...BLEND_TYPES].sort((a, b) => b.length - a.length)
  const type = types.find(t => rest.startsWith(t))
  if (!type) return unparsed
  rest = rest.slice(type.length)

  // 3. Digits welded to the type belong to the type (SFC30, SG14) — but only
  //    when something is left after them. `25SG27` alone is type SG,
  //    qualifier 27, not a type called SG27 with no qualifier.
  const numeric = /^(\d+)(?=[A-Za-z])/.exec(rest)
  const fullType = numeric ? `${type}${numeric[1]}` : type
  if (numeric) rest = rest.slice(numeric[1].length)

  // 4. Trailing variant, keeping any run suffix that follows it.
  const m = VARIANT_RE.exec(rest)
  // Never eat the whole qualifier: `25SGJOECC` keeps JOEC and drops one C, but
  // a bare `25SGC` has no qualifier to give up and keeps what it has.
  const variantSuffix = m && rest.length > m[0].length ? m[1] : null
  const runSuffix = variantSuffix ? (m![2] ?? '') : ''
  const qualifier = (variantSuffix ? rest.slice(0, m!.index) + runSuffix : rest)
    // A leading or trailing hyphen is not part of a name.
    .replace(/^-+|-+$/g, '')

  if (!qualifier) return { ...unparsed, type: fullType, variantSuffix, display: fullType, configured: true }

  return {
    raw, type: fullType, qualifier, variantSuffix,
    display: `${fullType}-${qualifier}`,
    configured: true,
  }
}

/**
 * The name to show for a blend — on a bag label, in Bag Tracking, on a picker.
 *
 * Returns the raw code unchanged when the blend type is not configured, which
 * is deliberately indistinguishable from "this code has no packed format"
 * (`CL-100C-A-O`). Both mean the same thing to a reader: this is the code
 * itself, not a derived name. Callers that need to TELL them apart read
 * `parseBlendCode().configured`.
 */
export function blendDisplayName(code: string | null | undefined): string {
  return parseBlendCode(code).display
}

/**
 * What a Blender output bag's `product_type` should say.
 *
 * Kept next to the parser rather than in the capture screen so the label, the
 * bag record and the capture screen cannot end up with three spellings of one
 * bag — which is exactly how "Heavy Sticks" and "Rolsiev Sticks" became two
 * products (ARCHITECTURE.md §5).
 */
export function blenderProductType(code: string | null | undefined): string {
  const name = blendDisplayName(code)
  return name || 'Blended Batch'
}
