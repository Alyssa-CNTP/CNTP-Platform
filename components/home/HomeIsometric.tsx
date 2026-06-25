'use client'

// components/home/HomeIsometric.tsx
// A purely decorative, pretty isometric drawing of the factory for the home page.
// Built from the REAL bay layout (lib/home/floorplan-data) so it's our building,
// but it deliberately shows no numbers or live data — just a nice illustration in
// the flat-isometric style. The accurate, dimensioned plan lives under Production.

import { useMemo } from 'react'
import { BAYS, FLOOR_W, FLOOR_H } from '@/lib/home/floorplan-data'

const CX = 0.866, CY = 0.5, EXT = 620
const iso = (x: number, y: number): [number, number] => [(x - y) * CX, (x + y) * CY]

// colour triplets: [top, left, right]
const ROO: [string, string, string] = ['#d8dccf', '#bcc3b0', '#a9b199']
const ROS: [string, string, string] = ['#f2c500', '#d6a300', '#b98a00']
const TRUCK: [string, string, string] = ['#2f6d22', '#245418', '#1c4212']
const CAB: [string, string, string] = ['#3f8a30', '#317024', '#27581b']
const WOOD: [string, string, string] = ['#cBA36a', '#b08a52', '#977443']

interface Box { x: number; y: number; w: number; h: number; ext: number; col: [string, string, string] }

// Decorative props placed in open floor areas (in plan cm coords).
const PROPS: Box[] = [
  { x: 350, y: 3950, w: 950, h: 430, ext: 470, col: TRUCK },   // truck body
  { x: 1330, y: 4010, w: 360, h: 370, ext: 640, col: CAB },    // truck cab
  { x: 6750, y: 650, w: 200, h: 200, ext: 150, col: WOOD },    // pallets
  { x: 6990, y: 650, w: 200, h: 200, ext: 150, col: WOOD },
  { x: 6750, y: 900, w: 200, h: 200, ext: 150, col: WOOD },
  { x: 11400, y: 1600, w: 200, h: 200, ext: 150, col: WOOD },
  { x: 11400, y: 1860, w: 200, h: 200, ext: 300, col: WOOD },
]

export function HomeIsometric() {
  const { boxes, vb, P } = useMemo(() => {
    const all: Box[] = [
      ...BAYS.map(b => ({ x: b[0], y: b[1], w: b[2], h: b[3], ext: EXT, col: b[5] ? ROS : ROO })),
      ...PROPS,
    ]
    const pts: [number, number][] = []
    for (const b of all) {
      for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as [number, number][]) {
        const [ix, iy] = iso(px, py); pts.push([ix, iy], [ix, iy - b.ext])
      }
    }
    for (const [px, py] of [[0, 0], [FLOOR_W, 0], [FLOOR_W, FLOOR_H], [0, FLOOR_H]] as [number, number][]) {
      pts.push(iso(px, py))
    }
    const minx = Math.min(...pts.map(p => p[0])), maxx = Math.max(...pts.map(p => p[0]))
    const miny = Math.min(...pts.map(p => p[1])), maxy = Math.max(...pts.map(p => p[1]))
    const pad = 300
    const P = (x: number, y: number) => `${(x - minx + pad).toFixed(0)},${(y - miny + pad).toFixed(0)}`
    const boxes = all.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y))
    return { boxes, vb: `0 0 ${maxx - minx + pad * 2} ${maxy - miny + pad * 2}`, P }
  }, [])

  const floor = ([[0, 0], [FLOOR_W, 0], [FLOOR_W, FLOOR_H], [0, FLOOR_H]] as [number, number][])
    .map(([x, y]) => { const [ix, iy] = iso(x, y); return P(ix, iy) }).join(' ')

  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img" aria-label="Isometric illustration of the Cape Natural factory">
      <polygon points={floor} fill="#eef1ea" stroke="#dfe4d8" strokeWidth={16} />
      {boxes.map((b, i) => {
        const a = iso(b.x, b.y), bb = iso(b.x + b.w, b.y), c = iso(b.x + b.w, b.y + b.h), d = iso(b.x, b.y + b.h)
        const at: [number, number] = [a[0], a[1] - b.ext], bt: [number, number] = [bb[0], bb[1] - b.ext]
        const ct: [number, number] = [c[0], c[1] - b.ext], dt: [number, number] = [d[0], d[1] - b.ext]
        return (
          <g key={i}>
            <polygon points={`${P(...d)} ${P(...c)} ${P(...ct)} ${P(...dt)}`} fill={b.col[1]} />
            <polygon points={`${P(...c)} ${P(...bb)} ${P(...bt)} ${P(...ct)}`} fill={b.col[2]} />
            <polygon points={`${P(...at)} ${P(...bt)} ${P(...ct)} ${P(...dt)}`} fill={b.col[0]} stroke="#ffffff" strokeWidth={6} strokeOpacity={0.5} />
          </g>
        )
      })}
    </svg>
  )
}
