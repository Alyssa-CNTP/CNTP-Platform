'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'

export interface SectionStatus {
  sectionId:    string
  code:         string
  name:         string
  sessionCount: number
  status:       'approved' | 'submitted' | 'draft' | 'idle'
  totalKg:      number
  avgYield:     number | null
}

interface Props {
  sections: SectionStatus[]
  loading:  boolean
}

const STATUS_DOT: Record<string, string> = {
  approved:  '#15803D',
  submitted: '#1D4ED8',
  draft:     '#B45309',
  idle:      '#D1D5DB',
}

const STATUS_LABEL: Record<string, string> = {
  approved:  'Approved',
  submitted: 'Submitted',
  draft:     'In progress',
  idle:      'No session',
}

const STATUS_FILL: Record<string, string> = {
  approved:  '#DCFCE7',
  submitted: '#DBEAFE',
  draft:     '#FEF3C7',
  idle:      '#F9FAFB',
}

const STATUS_STROKE: Record<string, string> = {
  approved:  '#86EFAC',
  submitted: '#93C5FD',
  draft:     '#FCD34D',
  idle:      '#E5E7EB',
}

// Production sections — evenly spaced across production floor
const PROD_SECTIONS = [
  { id: 'sieving',     code: 'ST', name: 'Sieving Tower' },
  { id: 'refining1',   code: 'R1', name: 'Refining 1'    },
  { id: 'refining2',   code: 'R2', name: 'Refining 2'    },
  { id: 'granule',     code: 'GL', name: 'Granule Line'  },
  { id: 'blender',     code: 'BL', name: 'Blender'       },
  { id: 'pasteuriser', code: 'PR', name: 'Pasteuriser'   },
]

// Floor plan dimensions
const VW = 960   // viewBox width
const VH = 580   // viewBox height
const MARGIN = 28

// Warehouse floor (top zone)
const WH_Y    = MARGIN
const WH_H    = 210   // warehouse zone height
const PROD_Y  = WH_Y + WH_H   // production floor starts
const PROD_H  = 230   // production floor height
const BLDG_W  = VW - MARGIN * 2
const BLDG_H  = WH_H + PROD_H

// Warehouse zone x-coordinates (within building)
const RCV_X   = MARGIN                // receiving
const RCV_W   = 130
const FGS_X   = MARGIN + BLDG_W - 300 // finished goods
const FGS_W   = 140
const DSP_X   = MARGIN + BLDG_W - 150 // dispatch
const DSP_W   = 150
const RMW_X   = RCV_X + RCV_W         // raw material warehouse
const RMW_W   = FGS_X - RMW_X

// Production section width
const N_PROD  = PROD_SECTIONS.length
const PROD_SW = Math.floor(BLDG_W / N_PROD)  // section width

export default function WarehouseMap({ sections, loading }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const getSection = (id: string) => sections.find(s => s.sectionId === id)
  const activeCount = sections.filter(s => s.status !== 'idle').length
  const hoveredData = hovered ? sections.find(s => s.sectionId === hovered) : null

  return (
    <div className="bg-surface-card border border-surface-rule rounded-2xl overflow-hidden h-full flex flex-col">

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-rule flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-brand" />
          <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>Factory Floor</span>
          <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>
            · {activeCount}/6 sections active
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-4">
          {(['approved','submitted','draft','idle'] as const).map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_FILL[s], border: `1.5px solid ${STATUS_DOT[s]}` }} />
              <span style={{ fontSize: 10, color: '#6B7280' }}>{STATUS_LABEL[s]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Floor plan */}
      <div className="flex-1 p-4 relative" style={{ minHeight: 280 }}>
        {loading ? (
          <div className="w-full h-full bg-surface rounded-xl animate-pulse" style={{ minHeight: 260 }} />
        ) : (
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            className="w-full h-auto"
            style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}
          >
            <defs>
              {/* Grid pattern — civil engineering graph paper */}
              <pattern id="grid-minor" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#E5E7EB" strokeWidth="0.4" />
              </pattern>
              <pattern id="grid-major" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
                <rect width="50" height="50" fill="url(#grid-minor)" />
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#D1D5DB" strokeWidth="0.8" />
              </pattern>

              {/* Hatching for receiving zone */}
              <pattern id="hatch-rcv" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#FCA5A5" strokeWidth="1" />
              </pattern>
              {/* Hatching for raw material */}
              <pattern id="hatch-rmw" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="10" stroke="#86EFAC" strokeWidth="0.8" />
              </pattern>
              {/* Hatching for finished goods */}
              <pattern id="hatch-fgs" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                <line x1="0" y1="4" x2="8" y2="4" stroke="#93C5FD" strokeWidth="0.8" />
              </pattern>
              {/* Hatching for dispatch */}
              <pattern id="hatch-dsp" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#FCD34D" strokeWidth="1" />
              </pattern>
            </defs>

            {/* ── Drawing sheet ── */}
            <rect width={VW} height={VH} fill="#FAFBFC" />
            <rect width={VW} height={VH} fill="url(#grid-major)" />

            {/* ── Grid coordinate labels ── */}
            {[1,2,3,4,5,6,7,8,9].map(i => (
              <text key={`col-${i}`} x={MARGIN + (i-1) * (BLDG_W/9) + 5} y={MARGIN - 6}
                fontSize="7" fill="#9CA3AF" textAnchor="middle">{i}</text>
            ))}
            {['A','B','C','D','E'].map((l,i) => (
              <text key={`row-${l}`} x={MARGIN - 8} y={WH_Y + i * (BLDG_H/5) + 10}
                fontSize="7" fill="#9CA3AF" textAnchor="middle">{l}</text>
            ))}

            {/* ── Outer building walls ── */}
            <rect
              x={MARGIN} y={WH_Y}
              width={BLDG_W} height={BLDG_H}
              fill="white" stroke="#1F2937" strokeWidth="3"
            />

            {/* ═══════════════════════════════════════
                WAREHOUSE FLOOR — top half
            ═══════════════════════════════════════ */}

            {/* RECEIVING BAY */}
            <rect x={RCV_X} y={WH_Y} width={RCV_W} height={WH_H}
              fill="#FEF2F2" stroke="#1F2937" strokeWidth="1.5" />
            <rect x={RCV_X} y={WH_Y} width={RCV_W} height={WH_H}
              fill="url(#hatch-rcv)" opacity="0.5" />
            {/* Loading dock symbol */}
            <rect x={RCV_X + 10} y={WH_Y + WH_H - 28} width={RCV_W - 20} height={18}
              fill="#FEE2E2" stroke="#F87171" strokeWidth="1" strokeDasharray="3 2" rx="2" />
            <text x={RCV_X + RCV_W/2} y={WH_Y + WH_H - 17}
              textAnchor="middle" fill="#EF4444" fontSize="6.5" fontWeight="600" letterSpacing="0.5">DOCK</text>
            {/* Zone label */}
            <text x={RCV_X + RCV_W/2} y={WH_Y + 22}
              textAnchor="middle" fill="#1F2937" fontSize="8" fontWeight="700" letterSpacing="1">RECEIVING</text>
            <text x={RCV_X + RCV_W/2} y={WH_Y + 33}
              textAnchor="middle" fill="#6B7280" fontSize="7" letterSpacing="0.5">BAY</text>
            {/* Forklift path arrow */}
            <line x1={RCV_X + RCV_W/2} y1={WH_Y + 50} x2={RCV_X + RCV_W/2} y2={WH_Y + WH_H - 34}
              stroke="#EF4444" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
            <polygon points={`${RCV_X + RCV_W/2 - 4},${WH_Y + 52} ${RCV_X + RCV_W/2 + 4},${WH_Y + 52} ${RCV_X + RCV_W/2},${WH_Y + 44}`}
              fill="#EF4444" opacity="0.6" />
            {/* Code */}
            <text x={RCV_X + RCV_W/2} y={WH_Y + WH_H/2 + 4}
              textAnchor="middle" fill="#EF4444" fontSize="28" fontWeight="900" opacity="0.15">RCV</text>

            {/* RAW MATERIAL WAREHOUSE */}
            <rect x={RMW_X} y={WH_Y} width={RMW_W} height={WH_H}
              fill="#F0FDF4" stroke="#1F2937" strokeWidth="1.5" />
            <rect x={RMW_X} y={WH_Y} width={RMW_W} height={WH_H}
              fill="url(#hatch-rmw)" opacity="0.4" />
            <text x={RMW_X + RMW_W/2} y={WH_Y + 20}
              textAnchor="middle" fill="#1F2937" fontSize="8" fontWeight="700" letterSpacing="1">RAW MATERIAL STORAGE</text>
            {/* Storage aisles */}
            {[1,2,3,4,5].map(i => {
              const ax = RMW_X + i * (RMW_W / 6)
              return (
                <g key={`aisle-${i}`}>
                  <line x1={ax} y1={WH_Y + 35} x2={ax} y2={WH_Y + WH_H - 10}
                    stroke="#16A34A" strokeWidth="0.8" strokeDasharray="5 4" opacity="0.5" />
                  <text x={ax} y={WH_Y + 30} textAnchor="middle"
                    fill="#16A34A" fontSize="7" fontWeight="600" opacity="0.7">
                    {String.fromCharCode(64 + i)}
                  </text>
                </g>
              )
            })}
            {/* Pallet rack symbols */}
            {[1,2,3,4,5,6].map(col => {
              const cx = RMW_X + col * (RMW_W / 7)
              return [1,2,3].map(row => (
                <rect key={`rack-${col}-${row}`}
                  x={cx - 12} y={WH_Y + 38 + (row - 1) * 50}
                  width={24} height={38}
                  fill="#DCFCE7" stroke="#86EFAC" strokeWidth="0.8" rx="1" opacity="0.7" />
              ))
            })}
            {/* Background code */}
            <text x={RMW_X + RMW_W/2} y={WH_Y + WH_H/2 + 12}
              textAnchor="middle" fill="#16A34A" fontSize="40" fontWeight="900" opacity="0.06">STORE</text>

            {/* FINISHED GOODS */}
            <rect x={FGS_X} y={WH_Y} width={FGS_W} height={WH_H}
              fill="#EFF6FF" stroke="#1F2937" strokeWidth="1.5" />
            <rect x={FGS_X} y={WH_Y} width={FGS_W} height={WH_H}
              fill="url(#hatch-fgs)" opacity="0.5" />
            <text x={FGS_X + FGS_W/2} y={WH_Y + 20}
              textAnchor="middle" fill="#1F2937" fontSize="8" fontWeight="700" letterSpacing="1">FINISHED</text>
            <text x={FGS_X + FGS_W/2} y={WH_Y + 30}
              textAnchor="middle" fill="#1F2937" fontSize="8" fontWeight="700" letterSpacing="1">GOODS</text>
            {[1,2].map(col =>
              [1,2,3].map(row => (
                <rect key={`fg-${col}-${row}`}
                  x={FGS_X + 14 + (col-1) * 60} y={WH_Y + 44 + (row-1) * 52}
                  width={48} height={40}
                  fill="#DBEAFE" stroke="#93C5FD" strokeWidth="0.8" rx="1" opacity="0.8" />
              ))
            )}
            <text x={FGS_X + FGS_W/2} y={WH_Y + WH_H/2 + 14}
              textAnchor="middle" fill="#3B82F6" fontSize="24" fontWeight="900" opacity="0.08">FGS</text>

            {/* DISPATCH BAY */}
            <rect x={DSP_X} y={WH_Y} width={DSP_W} height={WH_H}
              fill="#FFFBEB" stroke="#1F2937" strokeWidth="1.5" />
            <rect x={DSP_X} y={WH_Y} width={DSP_W} height={WH_H}
              fill="url(#hatch-dsp)" opacity="0.4" />
            <rect x={DSP_X + 10} y={WH_Y + WH_H - 28} width={DSP_W - 20} height={18}
              fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1" strokeDasharray="3 2" rx="2" />
            <text x={DSP_X + DSP_W/2} y={WH_Y + WH_H - 17}
              textAnchor="middle" fill="#D97706" fontSize="6.5" fontWeight="600" letterSpacing="0.5">DOCK</text>
            <text x={DSP_X + DSP_W/2} y={WH_Y + 22}
              textAnchor="middle" fill="#1F2937" fontSize="8" fontWeight="700" letterSpacing="1">DISPATCH</text>
            <text x={DSP_X + DSP_W/2} y={WH_Y + 33}
              textAnchor="middle" fill="#6B7280" fontSize="7" letterSpacing="0.5">BAY</text>
            <line x1={DSP_X + DSP_W/2} y1={WH_Y + 50} x2={DSP_X + DSP_W/2} y2={WH_Y + WH_H - 34}
              stroke="#D97706" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
            <polygon points={`${DSP_X + DSP_W/2 - 4},${WH_Y + WH_H - 36} ${DSP_X + DSP_W/2 + 4},${WH_Y + WH_H - 36} ${DSP_X + DSP_W/2},${WH_Y + WH_H - 44}`}
              fill="#D97706" opacity="0.6" />
            <text x={DSP_X + DSP_W/2} y={WH_Y + WH_H/2 + 4}
              textAnchor="middle" fill="#D97706" fontSize="28" fontWeight="900" opacity="0.15">DSP</text>

            {/* Door symbols (arc) at entrances between zones */}
            {/* RCV → RMW door */}
            <path d={`M ${RCV_X + RCV_W} ${WH_Y + WH_H - 50} Q ${RCV_X + RCV_W - 20} ${WH_Y + WH_H - 30} ${RCV_X + RCV_W} ${WH_Y + WH_H - 30}`}
              fill="none" stroke="#6B7280" strokeWidth="1" strokeDasharray="3 2" />
            {/* RMW → FGS door */}
            <path d={`M ${FGS_X} ${WH_Y + WH_H - 50} Q ${FGS_X + 20} ${WH_Y + WH_H - 30} ${FGS_X} ${WH_Y + WH_H - 30}`}
              fill="none" stroke="#6B7280" strokeWidth="1" strokeDasharray="3 2" />

            {/* ── Horizontal wall dividing warehouse / production ── */}
            <line
              x1={MARGIN} y1={PROD_Y}
              x2={MARGIN + BLDG_W} y2={PROD_Y}
              stroke="#1F2937" strokeWidth="2.5"
            />

            {/* Section label strip */}
            <rect x={MARGIN + BLDG_W/2 - 90} y={PROD_Y - 8} width={180} height={16}
              fill="#1F2937" rx="3" />
            <text x={MARGIN + BLDG_W/2} y={PROD_Y + 3}
              textAnchor="middle" fill="white" fontSize="7.5" fontWeight="700" letterSpacing="2">
              PRODUCTION FLOOR
            </text>

            {/* ═══════════════════════════════════════
                PRODUCTION SECTIONS
            ═══════════════════════════════════════ */}
            {PROD_SECTIONS.map((sec, idx) => {
              const data    = getSection(sec.id)
              const status  = data?.status ?? 'idle'
              const fill    = STATUS_FILL[status]
              const stroke  = STATUS_STROKE[status]
              const dotCol  = STATUS_DOT[status]
              const kg      = data?.totalKg ?? 0
              const yld     = data?.avgYield
              const isHov   = hovered === sec.id
              const sx      = MARGIN + idx * PROD_SW
              const sy      = PROD_Y
              const sw      = PROD_SW
              const sh      = PROD_H

              return (
                <g
                  key={sec.id}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(sec.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Room fill */}
                  <rect x={sx} y={sy} width={sw} height={sh}
                    fill={fill}
                    stroke="#1F2937"
                    strokeWidth={isHov ? 2 : 1.5}
                    style={{ transition: 'fill 150ms' }}
                  />

                  {/* Hover overlay */}
                  {isHov && (
                    <rect x={sx} y={sy} width={sw} height={sh}
                      fill={stroke} opacity="0.18" />
                  )}

                  {/* Door gap on top wall (connection to warehouse floor) */}
                  <line x1={sx + sw/2 - 16} y1={sy} x2={sx + sw/2 + 16} y2={sy}
                    stroke={fill} strokeWidth="3" />
                  {/* Door arc */}
                  <path d={`M ${sx + sw/2 - 16} ${sy} Q ${sx + sw/2 - 16} ${sy + 12} ${sx + sw/2} ${sy + 12}`}
                    fill="none" stroke="#9CA3AF" strokeWidth="0.8" strokeDasharray="2 1.5" />

                  {/* Machine symbol — circle with crosshairs */}
                  <circle cx={sx + sw/2} cy={sy + 55} r={18}
                    fill="white" stroke={dotCol} strokeWidth="1.5" />
                  <line x1={sx + sw/2 - 12} y1={sy + 55} x2={sx + sw/2 + 12} y2={sy + 55}
                    stroke={dotCol} strokeWidth="1" />
                  <line x1={sx + sw/2} y1={sy + 43} x2={sx + sw/2} y2={sy + 67}
                    stroke={dotCol} strokeWidth="1" />

                  {/* Section code — large */}
                  <text x={sx + sw/2} y={sy + 110}
                    textAnchor="middle" fill="#1F2937" fontSize="22" fontWeight="800" letterSpacing="-0.5">
                    {sec.code}
                  </text>

                  {/* Section name */}
                  <text x={sx + sw/2} y={sy + 126}
                    textAnchor="middle" fill="#6B7280" fontSize="7.5" letterSpacing="0.5">
                    {sec.name.toUpperCase()}
                  </text>

                  {/* KG today */}
                  {kg > 0 && (
                    <text x={sx + sw/2} y={sy + 148}
                      textAnchor="middle" fill="#374151" fontSize="10" fontWeight="600">
                      {kg >= 1000 ? `${(kg/1000).toFixed(1)} t` : `${Math.round(kg)} kg`}
                    </text>
                  )}

                  {/* Yield */}
                  {yld != null && (
                    <text x={sx + sw/2} y={sy + 162}
                      textAnchor="middle" fill="#6B7280" fontSize="8">
                      yield {yld.toFixed(1)}%
                    </text>
                  )}

                  {/* Idle label */}
                  {status === 'idle' && (
                    <text x={sx + sw/2} y={sy + 148}
                      textAnchor="middle" fill="#9CA3AF" fontSize="8">
                      no session
                    </text>
                  )}

                  {/* Status indicator — top right */}
                  <circle cx={sx + sw - 12} cy={sy + 14} r={6}
                    fill={dotCol} stroke="white" strokeWidth="1.5" />

                  {/* Session count — top left */}
                  {(data?.sessionCount ?? 0) > 0 && (
                    <g>
                      <circle cx={sx + 14} cy={sy + 14} r={9} fill="#1F2937" />
                      <text x={sx + 14} y={sy + 18}
                        textAnchor="middle" fill="white" fontSize="8" fontWeight="700">
                        {data!.sessionCount}
                      </text>
                    </g>
                  )}

                  {/* Room dimension line (bottom) */}
                  <line x1={sx + 4} y1={sy + sh - 6} x2={sx + sw - 4} y2={sy + sh - 6}
                    stroke="#D1D5DB" strokeWidth="0.6" />
                  <text x={sx + sw/2} y={sy + sh - 9}
                    textAnchor="middle" fill="#D1D5DB" fontSize="6">
                    {Math.round(sw * 0.15)}m
                  </text>
                </g>
              )
            })}

            {/* ═══════════════════════════════════════
                TITLE BLOCK & ANNOTATIONS
            ═══════════════════════════════════════ */}

            {/* Dimension — building width (below) */}
            <line x1={MARGIN} y1={VH - 18} x2={MARGIN + BLDG_W} y2={VH - 18}
              stroke="#6B7280" strokeWidth="0.8" />
            <line x1={MARGIN} y1={VH - 22} x2={MARGIN} y2={VH - 14}
              stroke="#6B7280" strokeWidth="0.8" />
            <line x1={MARGIN + BLDG_W} y1={VH - 22} x2={MARGIN + BLDG_W} y2={VH - 14}
              stroke="#6B7280" strokeWidth="0.8" />
            <text x={MARGIN + BLDG_W/2} y={VH - 8}
              textAnchor="middle" fill="#6B7280" fontSize="7">BLACKHEATH MANUFACTURING FACILITY — FLOOR PLAN (NOT TO SCALE)</text>

            {/* North arrow */}
            <g transform={`translate(${VW - 34}, 18)`}>
              <circle cx={0} cy={0} r={11} fill="white" stroke="#6B7280" strokeWidth="1" />
              <polygon points="0,-9 3,0 0,-3 -3,0" fill="#1F2937" />
              <polygon points="0,9 3,0 0,3 -3,0" fill="#D1D5DB" />
              <text x={0} y={-13} textAnchor="middle" fill="#374151" fontSize="7" fontWeight="700">N</text>
            </g>

            {/* Scale bar */}
            <g transform={`translate(${MARGIN}, ${VH - 40})`}>
              <rect x={0} y={0} width={40} height={5} fill="#1F2937" />
              <rect x={40} y={0} width={40} height={5} fill="white" stroke="#1F2937" strokeWidth="0.8" />
              <rect x={80} y={0} width={40} height={5} fill="#1F2937" />
              <text x={0}   y={-3} fontSize="6" fill="#6B7280" textAnchor="middle">0</text>
              <text x={40}  y={-3} fontSize="6" fill="#6B7280" textAnchor="middle">10m</text>
              <text x={80}  y={-3} fontSize="6" fill="#6B7280" textAnchor="middle">20m</text>
              <text x={120} y={-3} fontSize="6" fill="#6B7280" textAnchor="middle">30m</text>
            </g>

          </svg>
        )}

        {/* Hover tooltip */}
        {hoveredData && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-in">
            <div style={{
              background: '#1F2937',
              color: 'white',
              padding: '10px 16px',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              minWidth: 180,
              textAlign: 'center',
            }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{hoveredData.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_DOT[hoveredData.status] }} />
                <span style={{ fontSize: 11, opacity: 0.75 }}>{STATUS_LABEL[hoveredData.status]}</span>
              </div>
              {hoveredData.totalKg > 0 && (
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
                  {hoveredData.totalKg.toLocaleString('en-ZA', { maximumFractionDigits: 0 })} kg today
                </div>
              )}
              {hoveredData.avgYield != null && (
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  Yield: {hoveredData.avgYield.toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-rule flex items-center justify-between shrink-0">
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>Live · updates on refresh</span>
        <Link href="/production" style={{ fontSize: 11, color: '#16A34A', textDecoration: 'none' }}>
          View production →
        </Link>
      </div>
    </div>
  )
}
