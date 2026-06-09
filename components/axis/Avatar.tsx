'use client'

// components/axis/Avatar.tsx
// Initials-based circular avatar. Deterministic colour from the user_id seed.

import React from 'react'

const PALETTE = [
  { bg: '#dbeafe', fg: '#1e40af' }, // blue
  { bg: '#dcfce7', fg: '#15803d' }, // green
  { bg: '#fef3c7', fg: '#92400e' }, // amber
  { bg: '#fce7f3', fg: '#9d174d' }, // pink
  { bg: '#ede9fe', fg: '#5b21b6' }, // purple
  { bg: '#e0f2fe', fg: '#075985' }, // sky
  { bg: '#fee2e2', fg: '#991b1b' }, // red
  { bg: '#f3e8ff', fg: '#6b21a8' }, // violet
  { bg: '#ecfccb', fg: '#3f6212' }, // lime
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function Avatar({
  initials, userId = '', size = 26, title,
}: {
  initials: string
  userId?: string
  size?: number
  title?: string
}) {
  const palette = PALETTE[hash(userId || initials) % PALETTE.length]
  return (
    <div
      title={title}
      className="rounded-full flex items-center justify-center font-mono font-semibold flex-shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: palette.bg,
        color: palette.fg,
        fontSize: Math.max(9, Math.floor(size * 0.38)),
        letterSpacing: '0.02em',
      }}
    >
      {initials}
    </div>
  )
}
