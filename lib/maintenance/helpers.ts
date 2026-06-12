// lib/maintenance/helpers.ts
// Pure maintenance helpers — extracted verbatim from the original page.
// calCol (hex) is replaced with calClass (a .badge variant class); calBadge text kept.

import type { QcAnswer } from './types'

export function aiSuggest(t: string) {
  const l = (t || '').toLowerCase()
  if (l.includes('rust')) return 'Rust on surface. Clean and apply food-safe coating.'
  if (l.includes('leak') || l.includes('water')) return 'Leak detected. Seal joint and inspect gaskets.'
  if (l.includes('loose') || l.includes('screw')) return 'Loose fastener found. Tighten and verify torque.'
  if (l.includes('dirty') || l.includes('dust') || l.includes('clean')) return 'Hygiene issue. Deep clean before production resumes.'
  if (l.includes('crack') || l.includes('hole') || l.includes('gap')) return 'Structural damage. Seal to prevent pest ingress.'
  if (l.includes('belt') || l.includes('chain')) return 'Belt/chain wear detected. Replace and check tension.'
  if (l.includes('broken') || l.includes('damage')) return 'Broken component. Replace and log in spares register.'
  if (l.includes('guard') || l.includes('cover')) return 'Missing guard/cover. Reinstall before operation.'
  if (l.includes('wire') || l.includes('electric') || l.includes('plug')) return 'Electrical issue. Isolate power and inspect wiring.'
  if (l.includes('oil') || l.includes('grease')) return 'Oil/grease spillage. Clean and check seals.'
  if (l.includes('light') || l.includes('bulb')) return 'Lighting fault. Replace fitting/bulb promptly.'
  if (l.includes('door') || l.includes('handle')) return 'Door/handle fault. Repair to maintain integrity.'
  if (l.includes('flush') || l.includes('shower') || l.includes('tap')) return 'Plumbing issue. Repair to prevent water waste.'
  return 'Issue detected. Inspect and take corrective action.'
}

export const fmtD  = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const fmtT  = (d: string | null) => (d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—')
export const fmtDT = (d: string | null) => (d ? fmtD(d) + ' ' + fmtT(d) : '—')
export const diffM = (a: string | null, b: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : 0)
export const diffDays = (a: string | null, b: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) : 0)
export const daysUntil = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : 0)

export function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Legacy qc_checks were booleans; v2 uses 'yes' | 'no' | 'na'
export const normQc = (v: any): QcAnswer => (v === true || v === 'yes' ? 'yes' : v === 'na' ? 'na' : 'no')

export function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new window.Image()
      img.onload = () => {
        const max = 800
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Token-based calendar urgency: returns a .badge variant class. calBadge text kept.
export const calClass = (d: number) => (d <= 0 ? 'badge-err' : d <= 7 ? 'badge-warn' : d <= 30 ? 'badge-warn' : d <= 60 ? 'badge-info' : 'badge-ok')
export const calBadge = (d: number) => (d <= 0 ? 'OVERDUE' : d <= 7 ? 'URGENT' : d <= 30 ? 'SOON' : d <= 60 ? 'PLAN' : 'OK')
