import type { Classification } from './types'

// ─── Classification styling ──────────────────────────────────────────────────
// Maps each classification to CSS-var-backed colours. Returned strings reference
// CSS vars so dark-mode tokens are picked up automatically.

interface PalettePair { bg: string; fg: string; border: string }

export function classificationStyle(c: Classification | string): PalettePair {
  switch (c) {
    case 'opportunity':
      return {
        bg:     'var(--color-ok-bg)',
        fg:     'var(--color-ok)',
        border: 'rgba(21,128,61,0.22)',
      }
    case 'threat':
      return {
        bg:     'var(--color-err-bg)',
        fg:     'var(--color-err)',
        border: 'rgba(185,28,28,0.22)',
      }
    case 'competitor':
      return {
        bg:     'var(--color-warn-bg)',
        fg:     'var(--color-warn)',
        border: 'rgba(194,65,12,0.22)',
      }
    case 'regulation':
      return {
        bg:     'var(--color-info-bg)',
        fg:     'var(--color-info)',
        border: 'rgba(29,78,216,0.22)',
      }
    case 'relationship':
      return {
        bg:     'rgba(46,125,50,0.10)',
        fg:     'var(--color-accent)',
        border: 'rgba(46,125,50,0.22)',
      }
    default:
      return {
        bg:     'var(--color-surface)',
        fg:     'var(--color-text-muted)',
        border: 'var(--color-surface-rule)',
      }
  }
}

// ─── Urgency styling ──────────────────────────────────────────────────────────
// Maps the pipeline's low|medium|high urgency band to the same CSS-var palette
// used elsewhere. Unknown / null values fall through to the muted default.

export function urgencyStyle(urgency: string | null | undefined): PalettePair {
  switch ((urgency ?? '').toLowerCase()) {
    case 'high':
      return {
        bg:     'var(--color-err-bg)',
        fg:     'var(--color-err)',
        border: 'rgba(185,28,28,0.22)',
      }
    case 'medium':
      return {
        bg:     'var(--color-warn-bg)',
        fg:     'var(--color-warn)',
        border: 'rgba(194,65,12,0.22)',
      }
    case 'low':
      return {
        bg:     'var(--color-ok-bg)',
        fg:     'var(--color-ok)',
        border: 'rgba(21,128,61,0.22)',
      }
    default:
      return {
        bg:     'var(--color-surface)',
        fg:     'var(--color-text-muted)',
        border: 'var(--color-surface-rule)',
      }
  }
}

export function relevanceStyle(score: number): PalettePair {
  if (score >= 7) {
    return {
      bg:     'var(--color-ok-bg)',
      fg:     'var(--color-ok)',
      border: 'rgba(21,128,61,0.22)',
    }
  }
  if (score >= 4) {
    return {
      bg:     'var(--color-warn-bg)',
      fg:     'var(--color-warn)',
      border: 'rgba(194,65,12,0.22)',
    }
  }
  return {
    bg:     'var(--color-surface)',
    fg:     'var(--color-text-muted)',
    border: 'var(--color-surface-rule)',
  }
}

// ─── Region flag emoji from ISO-2 code ───────────────────────────────────────
// Maps 2-letter region codes to their unicode flag emoji. Common region
// designators that are not ISO codes (EU, GLOBAL, etc) get fallbacks.

const REGION_OVERRIDES: Record<string, string> = {
  EU:     '🇪🇺',
  GLOBAL: '🌍',
  WORLD:  '🌍',
  AFRICA: '🌍',
  ASIA:   '🌏',
  AMERICAS: '🌎',
}

export function regionFlag(region: string | null | undefined): string {
  if (!region) return '🌐'
  const code = region.trim().toUpperCase()
  if (REGION_OVERRIDES[code]) return REGION_OVERRIDES[code]
  if (code.length !== 2) return '🌐'
  // Convert each letter to its regional indicator symbol
  const A = 0x41
  const BASE = 0x1F1E6
  try {
    return String.fromCodePoint(
      BASE + (code.charCodeAt(0) - A),
      BASE + (code.charCodeAt(1) - A),
    )
  } catch {
    return '🌐'
  }
}

// ─── Time ago helper ──────────────────────────────────────────────────────────
// Avoids pulling in date-fns to keep bundle minimal.

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const sec  = Math.round(diff / 1000)
  if (sec < 60)            return `${sec}s ago`
  const min  = Math.round(sec / 60)
  if (min < 60)            return `${min}m ago`
  const hr   = Math.round(min / 60)
  if (hr  < 24)            return `${hr}h ago`
  const day  = Math.round(hr  / 24)
  if (day < 7)             return `${day}d ago`
  const wk   = Math.round(day / 7)
  if (wk  < 5)             return `${wk}w ago`
  const mo   = Math.round(day / 30)
  if (mo  < 12)            return `${mo}mo ago`
  const yr   = Math.round(day / 365)
  return `${yr}y ago`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
