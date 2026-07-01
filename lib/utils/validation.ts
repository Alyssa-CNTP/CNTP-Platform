// lib/utils/validation.ts
//
// Shared numeric-field guard used across sieving, pasteuriser, and granule
// capture forms — no captured measurement (grams, %, moisture, temp, weight,
// counts) is ever legitimately negative.

export function isNegative(value: any): boolean {
  if (value === '' || value == null) return false
  const n = parseFloat(value)
  return !isNaN(n) && n < 0
}

// Returns the label of the first negative field found, or null if none.
export function firstNegative(fields: Record<string, any>, labels: Record<string, string>): string | null {
  for (const key of Object.keys(labels)) {
    if (isNegative(fields[key])) return labels[key]
  }
  return null
}
