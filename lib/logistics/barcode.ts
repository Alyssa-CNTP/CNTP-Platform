// lib/logistics/barcode.ts
// Generation + validation of internal barcodes (unit barcode + location barcode).
// Internal barcode format: U-YYMMDD-XXXXXX (random base36 suffix) for units,
// LOC-... for locations (assigned at warehouse setup).
//
// USB scanners typically emit the full code followed by Enter. The barcode itself
// is the only key into the units table — so we keep it short, opaque, and unique.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid scan confusion

function randomSuffix(len = 6): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

function yymmdd(d = new Date()): string {
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return yy + mm + dd
}

/** Generate a new internal unit barcode. Format: U-YYMMDD-XXXXXX */
export function newUnitBarcode(): string {
  return `U-${yymmdd()}-${randomSuffix(6)}`
}

/** Generate a new location barcode. Format: LOC-<location-code> */
export function newLocationBarcode(code: string): string {
  return `LOC-${code.toUpperCase()}`
}

/** Returns true if the scanned string looks like a unit barcode. */
export function isUnitBarcode(s: string): boolean {
  return /^U-\d{6}-[A-Z0-9]{4,}$/.test(s.trim())
}

/** Returns true if the scanned string looks like a location barcode. */
export function isLocationBarcode(s: string): boolean {
  return /^LOC-[A-Z0-9-]+$/.test(s.trim())
}
