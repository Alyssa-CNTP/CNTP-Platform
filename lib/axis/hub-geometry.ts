// lib/axis/hub-geometry.ts
// Pure polar-coordinate helpers for the Intelligence Hub radial diagram.
// No React, no side effects — safe to reason about and verify in isolation
// before wiring into components/axis/IntelligenceHub.tsx.
//
// Convention: 0deg = 12 o'clock, angles increase clockwise (matches the
// reference board-deck mockup's own convention).

export interface Point { x: number; y: number }

export function pt(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = (angleDeg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

// Builds an annular-sector ("donut slice") path between two radii and two
// angles. Handles the large-arc-flag so any single wedge up to just under
// 360 degrees renders correctly.
export function sector(
  cx: number, cy: number,
  rInner: number, rOuter: number,
  angle0: number, angle1: number,
): string {
  const largeArc = angle1 - angle0 > 180 ? 1 : 0
  const po0 = pt(cx, cy, rOuter, angle0)
  const po1 = pt(cx, cy, rOuter, angle1)
  const pi1 = pt(cx, cy, rInner, angle1)
  const pi0 = pt(cx, cy, rInner, angle0)
  return [
    `M ${po0.x} ${po0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${po1.x} ${po1.y}`,
    `L ${pi1.x} ${pi1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${pi0.x} ${pi0.y}`,
    'Z',
  ].join(' ')
}

// A full, unsplit ring. Uses 359.99deg (not 360) to avoid the degenerate SVG
// arc case where an arc command with identical start/end points draws nothing.
export function ring(cx: number, cy: number, rInner: number, rOuter: number): string {
  return sector(cx, cy, rInner, rOuter, 0, 359.99)
}

// Path for a curved label following an arc at a given radius, for use with
// <textPath>. Mirrors the reference mockup's own (proven-working) technique:
// for a label centered in the top half of the circle (within +-90deg of the
// 12-o'clock mark), draw the arc left-to-right in the clockwise direction so
// text reads upright. For a label centered in the bottom half, draw the arc
// in the reverse direction instead — without this flip, text on the bottom
// half of a circle renders upside-down (the path's local "up" normal points
// away from the viewer down there).
export function curvedLabelPath(cx: number, cy: number, r: number, angle0: number, angle1: number): string {
  const center = (angle0 + angle1) / 2
  const halfSpan = Math.abs(angle1 - angle0) / 2
  const normalized = ((center % 360) + 360) % 360
  const isTopHalf = normalized <= 90 || normalized >= 270

  const [a0, a1, sweep] = isTopHalf
    ? [center - halfSpan, center + halfSpan, 1]
    : [center + halfSpan, center - halfSpan, 0]

  const p0 = pt(cx, cy, r, a0)
  const p1 = pt(cx, cy, r, a1)
  const largeArc = halfSpan * 2 > 180 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`
}

// Growth-mechanic intensity: 0 count -> visible floor (0.08), scales
// logarithmically up to 1 at maxCount. A logarithmic (not linear) curve keeps
// one huge outlier cell from making every other real cell look empty by
// comparison.
export function cellIntensity(count: number, maxCount: number): number {
  if (maxCount <= 0) return 0.08
  const raw = Math.log(count + 1) / Math.log(maxCount + 1)
  return Math.max(0.08, Math.min(1, raw))
}
