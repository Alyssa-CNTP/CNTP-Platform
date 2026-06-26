'use client'

// components/home/HomeIsometric.tsx
// A decorative, graphical isometric illustration of the factory for the home page.
// The storage racks come from the REAL bay layout (lib/home/floorplan-data) so it's
// our building, dressed up with a production line, a delivery truck, forklift,
// silos, pallets and trees, soft shadows and a warm palette. No numbers / live data.

import { useMemo } from 'react'
import { BAYS, FLOOR_W, FLOOR_H } from '@/lib/home/floorplan-data'

const CX = 0.866, CY = 0.5
const iso = (x: number, y: number): [number, number] => [(x - y) * CX, (x + y) * CY]

type Tri = [string, string, string] // [top, left, right]
const ROO: Tri = ['#dde1d0', '#c2c9ad', '#aeb796']
const ROS: Tri = ['#f6cf63', '#dcab38', '#c2942c']
const TEAL: Tri = ['#46b5a8', '#2f8c82', '#256e66']
const BLUE: Tri = ['#6aa6db', '#4a82b3', '#386690']
const ORANGE: Tri = ['#ec9a44', '#cf7a28', '#aa6320']
const STEEL: Tri = ['#d4d9dd', '#b3b9be', '#9aa0a5']
const TRUCK: Tri = ['#2f6d22', '#245418', '#1c4212']
const CAB: Tri = ['#3f8a30', '#317024', '#27581b']
const FORK: Tri = ['#f2c14e', '#d9a838', '#bb8c28']
const WOOD: Tri = ['#cba36a', '#b08a52', '#977443']
const TRUNK: Tri = ['#8a6a44', '#705636', '#5a4429']
const LEAF: Tri = ['#5d9140', '#4a7533', '#3c5e29']

interface Box { x: number; y: number; w: number; h: number; ext: number; col: Tri }

// Decorative props in plan coords (storage racks come from BAYS).
const PROPS: Box[] = [
  // production line (bottom-centre open floor)
  { x: 6600, y: 3950, w: 520, h: 360, ext: 720, col: TEAL },
  { x: 7240, y: 3950, w: 520, h: 360, ext: 600, col: BLUE },
  { x: 7880, y: 3950, w: 470, h: 360, ext: 780, col: ORANGE },
  { x: 6600, y: 4360, w: 1750, h: 110, ext: 150, col: STEEL }, // conveyor
  // silos (bottom-left open floor)
  { x: 250, y: 4050, w: 320, h: 320, ext: 1500, col: STEEL },
  { x: 640, y: 4080, w: 300, h: 300, ext: 1300, col: STEEL },
  // forklift
  { x: 5200, y: 4080, w: 280, h: 170, ext: 230, col: FORK },
  { x: 5210, y: 4070, w: 70, h: 170, ext: 560, col: STEEL }, // mast
  // pallets
  { x: 4000, y: 4120, w: 220, h: 220, ext: 140, col: WOOD },
  { x: 4260, y: 4120, w: 220, h: 220, ext: 140, col: WOOD },
  { x: 4000, y: 4380, w: 220, h: 220, ext: 90, col: WOOD },
  { x: 11300, y: 1650, w: 220, h: 220, ext: 140, col: WOOD },
  { x: 11300, y: 1910, w: 220, h: 220, ext: 280, col: WOOD },
  // delivery truck at the top door (outside the wall)
  { x: 6850, y: -760, w: 1150, h: 470, ext: 470, col: TRUCK },
  { x: 8050, y: -720, w: 380, h: 430, ext: 660, col: CAB },
]

// Trees just outside the building (trunk + canopy as two stacked boxes).
const TREES: [number, number][] = [[-500, 600], [-300, 1300], [1100, 5050], [1900, 5150], [12900, 2600]]

export function HomeIsometric() {
  const { boxes, shadows, vb, P } = useMemo(() => {
    const treeBoxes: Box[] = TREES.flatMap(([x, y]) => ([
      { x, y, w: 90, h: 90, ext: 230, col: TRUNK },
      { x: x - 110, y: y - 110, w: 300, h: 300, ext: 320, col: LEAF },
    ]))
    const all: Box[] = [
      ...BAYS.map(b => ({ x: b[0], y: b[1], w: b[2], h: b[3], ext: 620, col: b[5] ? ROS : ROO })),
      ...PROPS, ...treeBoxes,
    ]
    const pts: [number, number][] = []
    for (const b of all) {
      for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as [number, number][]) {
        const [ix, iy] = iso(px, py); pts.push([ix, iy], [ix, iy - b.ext])
      }
    }
    for (const [px, py] of [[0, 0], [FLOOR_W, 0], [FLOOR_W, FLOOR_H], [0, FLOOR_H]] as [number, number][]) pts.push(iso(px, py))
    const minx = Math.min(...pts.map(p => p[0])), maxx = Math.max(...pts.map(p => p[0]))
    const miny = Math.min(...pts.map(p => p[1])), maxy = Math.max(...pts.map(p => p[1]))
    const pad = 320
    const P = (x: number, y: number) => `${(x - minx + pad).toFixed(0)},${(y - miny + pad).toFixed(0)}`
    const sorted = all.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y))
    return { boxes: sorted, shadows: sorted, vb: `0 0 ${maxx - minx + pad * 2} ${maxy - miny + pad * 2}`, P }
  }, [])

  const floor = ([[0, 0], [FLOOR_W, 0], [FLOOR_W, FLOOR_H], [0, FLOOR_H]] as [number, number][])
    .map(([x, y]) => { const [ix, iy] = iso(x, y); return P(ix, iy) }).join(' ')

  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img" aria-label="Isometric illustration of the Cape Natural factory">
      {/* floor slab */}
      <polygon points={floor} fill="#edf0e7" stroke="#dde2d4" strokeWidth={18} />
      {/* soft shadows on the floor */}
      {shadows.map((b, i) => {
        const a = iso(b.x, b.y), bb = iso(b.x + b.w, b.y), c = iso(b.x + b.w, b.y + b.h), d = iso(b.x, b.y + b.h)
        const sx = 55, sy = 80
        const sh = [a, bb, c, d].map(([x, y]) => P(x + sx, y + sy)).join(' ')
        return <polygon key={`s${i}`} points={sh} fill="#1a2415" opacity={0.06} />
      })}
      {/* boxes (painter-sorted) */}
      {boxes.map((b, i) => {
        const a = iso(b.x, b.y), bb = iso(b.x + b.w, b.y), c = iso(b.x + b.w, b.y + b.h), d = iso(b.x, b.y + b.h)
        const at: [number, number] = [a[0], a[1] - b.ext], bt: [number, number] = [bb[0], bb[1] - b.ext]
        const ct: [number, number] = [c[0], c[1] - b.ext], dt: [number, number] = [d[0], d[1] - b.ext]
        return (
          <g key={i}>
            <polygon points={`${P(...d)} ${P(...c)} ${P(...ct)} ${P(...dt)}`} fill={b.col[1]} />
            <polygon points={`${P(...c)} ${P(...bb)} ${P(...bt)} ${P(...ct)}`} fill={b.col[2]} />
            <polygon points={`${P(...at)} ${P(...bt)} ${P(...ct)} ${P(...dt)}`} fill={b.col[0]} stroke="#ffffff" strokeWidth={5} strokeOpacity={0.45} />
          </g>
        )
      })}
    </svg>
  )
}
