'use client'

// components/layout/Sidebar.tsx
// Corporate glass-finish sidebar.
// Fonts: font-display (Barlow Condensed), font-body (Barlow), font-mono (DM Mono)
// Background: deep layered dark green glass with subtle borders and depth.
// IT users bypass all permission/department checks.

import { useState } from 'react'
import Link         from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth }  from '@/lib/auth/context'
import {
  LayoutDashboard, ClipboardList, Factory, BarChart2,
  Users, Radio, Info, Tag, RotateCcw,
  ChevronLeft, ChevronRight, LogOut, Beaker,
  TrendingUp, Globe, UserCheck, Target,
  FlaskConical, Microscope, FileText,
  BookOpen, Layers, Settings,
} from 'lucide-react'
import type { PermissionKey } from '@/lib/auth/permissions'

interface NavItem {
  href:         string
  label:        string
  icon:         React.ElementType
  group:        string
  departments?: string[]
  permission?:  PermissionKey
}

const NAV: NavItem[] = [
  { href: '/dashboard',              label: 'Dashboard',       icon: LayoutDashboard, group: 'Operations' },
  { href: '/count',                  label: 'Morning count',   icon: ClipboardList,   group: 'Operations', departments: ['IT','Production'], permission: 'can_submit_count' },
  { href: '/recount',                label: 'Recount',         icon: RotateCcw,       group: 'Operations', departments: ['IT','Production'], permission: 'can_edit_count' },
  { href: '/production',             label: 'Live capture',    icon: Factory,         group: 'Operations', departments: ['IT','Production'], permission: 'can_submit_count' },
  { href: '/info',                   label: 'Section info',    icon: Info,            group: 'Operations', departments: ['IT','Production'], permission: 'can_view_ops_dashboard' },

  { href: '/quality/raw-material',   label: 'Raw material',    icon: Layers,          group: 'Quality',    departments: ['IT','Quality'], permission: 'can_upload_pdfs' },
  { href: '/quality/pasteuriser',    label: 'Pasteuriser',     icon: FlaskConical,    group: 'Quality',    departments: ['IT','Quality'], permission: 'can_create_runs' },
  { href: '/quality/granule',        label: 'Granule line',    icon: Microscope,      group: 'Quality',    departments: ['IT','Quality'], permission: 'can_create_runs' },
  { href: '/quality/sieving',        label: 'Sieving',         icon: Beaker,          group: 'Quality',    departments: ['IT','Quality'], permission: 'can_add_sieving_runs' },
  { href: '/quality/lab-results',    label: 'Lab results',     icon: FileText,        group: 'Quality',    departments: ['IT','Quality'], permission: 'can_save_lab_results' },
  { href: '/quality/customer-specs', label: 'Customer specs',  icon: BookOpen,        group: 'Quality',    departments: ['IT','Quality','Sales'], permission: 'can_edit_customer_specs' },

  { href: '/management',             label: 'Overview',        icon: BarChart2,       group: 'Management', departments: ['IT','Management'], permission: 'can_view_management' },
  { href: '/management/recounts',    label: 'Recount review',  icon: RotateCcw,       group: 'Management', departments: ['IT','Management'], permission: 'can_view_reports' },
  { href: '/status',                 label: 'Analytics',       icon: Radio,           group: 'Management', departments: ['IT'] },

  { href: '/sales',                  label: 'Sales overview',  icon: TrendingUp,      group: 'Sales',      departments: ['IT','Sales','Management'], permission: 'can_access_sales' },
  { href: '/sales/customers',        label: 'Accounts',        icon: UserCheck,       group: 'Sales',      departments: ['IT','Sales','Management'], permission: 'can_access_sales' },
  { href: '/sales/intelligence',     label: 'Intelligence',    icon: Globe,           group: 'Sales',      departments: ['IT','Sales'],             permission: 'can_access_research' },
  { href: '/sales/targets',          label: 'Targets & OKRs',  icon: Target,          group: 'Sales',      departments: ['IT','Sales','Management'], permission: 'can_access_sales' },

  { href: '/research',               label: 'Research engine', icon: Beaker,          group: 'Intelligence', departments: ['IT','Sales'], permission: 'can_access_research' },

  { href: '/users',                  label: 'Users & roles',   icon: Users,           group: 'Admin',      permission: 'can_manage_users' },
  { href: '/tags',                   label: 'Bag tags',        icon: Tag,             group: 'Admin',      departments: ['IT'] },
  { href: '/settings',               label: 'Settings',        icon: Settings,        group: 'Admin' },
]

const GROUP_STYLE: Record<string, { dot: string; labelColor: string; activeBg: string; activeText: string; hoverBg: string; bar: string }> = {
  Operations:   { dot: '#60a5fa', labelColor: 'rgba(255,255,255,0.3)',  activeBg: 'rgba(255,255,255,0.1)',  activeText: '#ffffff',   hoverBg: 'rgba(255,255,255,0.05)', bar: '#93c5fd' },
  Quality:      { dot: '#34d399', labelColor: 'rgba(52,211,153,0.55)',  activeBg: 'rgba(52,211,153,0.12)',  activeText: '#a7f3d0',   hoverBg: 'rgba(52,211,153,0.05)', bar: '#6ee7b7' },
  Management:   { dot: '#a78bfa', labelColor: 'rgba(167,139,250,0.55)', activeBg: 'rgba(167,139,250,0.12)', activeText: '#ddd6fe',   hoverBg: 'rgba(167,139,250,0.05)', bar: '#c4b5fd' },
  Sales:        { dot: '#fbbf24', labelColor: 'rgba(251,191,36,0.55)',  activeBg: 'rgba(251,191,36,0.12)',  activeText: '#fde68a',   hoverBg: 'rgba(251,191,36,0.05)', bar: '#fcd34d' },
  Intelligence: { dot: '#2dd4bf', labelColor: 'rgba(45,212,191,0.55)',  activeBg: 'rgba(45,212,191,0.12)',  activeText: '#99f6e4',   hoverBg: 'rgba(45,212,191,0.05)', bar: '#5eead4' },
  Admin:        { dot: '#fb7185', labelColor: 'rgba(255,255,255,0.3)',  activeBg: 'rgba(255,255,255,0.1)',  activeText: '#ffffff',   hoverBg: 'rgba(255,255,255,0.05)', bar: '#fda4af' },
}

const DEPT_COLOR: Record<string, string> = {
  IT: '#a78bfa', Quality: '#34d399', Production: '#60a5fa',
  Management: '#c4b5fd', Sales: '#fbbf24', Marketing: '#f472b6',
}

export default function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { department, role, displayName, initials, signOut, p, isIT } = useAuth()

  const visibleNav = NAV.filter(item => {
    if (item.href === '/dashboard' || item.href === '/settings') return true
    if (item.departments && !isIT && !(department && item.departments.includes(department))) return false
    if (item.permission  && !isIT && !p(item.permission)) return false
    return true
  })

  const groups: { label: string; items: NavItem[] }[] = []
  for (const item of visibleNav) {
    const g = groups.find(s => s.label === item.group)
    if (g) g.items.push(item)
    else   groups.push({ label: item.group, items: [item] })
  }

  const roleLabel = role?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? ''
  const deptColor = department ? DEPT_COLOR[department] ?? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)'

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={onMobileClose}
        />
      )}

      <aside
        className={[
          'fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto',
          'flex flex-col transition-all duration-200 ease-in-out overflow-hidden',
          collapsed ? 'w-[60px]' : 'w-[220px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        style={{
          background: 'linear-gradient(175deg, #0e200e 0%, #0a180a 50%, #0c1c0c 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.5), inset -1px 0 0 rgba(255,255,255,0.03)',
        }}
      >
        {/* Subtle glass sheen overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 60%)',
        }} />

        {/* ── Brand ─────────────────────────────────────────────────────────── */}
        <div className="relative flex items-center gap-3 px-4 py-[17px] flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 8px rgba(0,0,0,0.3)',
            }}>
            <span className="font-display font-bold text-[12px] text-white tracking-wider">CN</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden min-w-0">
              <div className="font-display font-bold text-[16px] text-white tracking-wide whitespace-nowrap leading-none">
                CNTP · Ops
              </div>
              <div className="font-mono text-[9px] tracking-[0.14em] uppercase whitespace-nowrap mt-1"
                style={{ color: 'rgba(255,255,255,0.28)' }}>
                Blackheath · BHW
              </div>
            </div>
          )}
        </div>

        {/* ── Nav ───────────────────────────────────────────────────────────── */}
        <nav className="relative flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: 'none' }}>
          {groups.map(({ label, items }) => {
            const s = GROUP_STYLE[label] ?? GROUP_STYLE.Operations
            return (
              <div key={label}>
                {/* Group heading */}
                {!collapsed ? (
                  <div className="flex items-center gap-1.5 px-4 pt-5 pb-1">
                    <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: s.dot, opacity: 0.7 }} />
                    <span className="font-mono text-[9px] tracking-[0.15em] uppercase font-medium"
                      style={{ color: s.labelColor }}>{label}</span>
                  </div>
                ) : (
                  <div className="mx-3 mt-4 mb-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
                )}

                {/* Items */}
                {items.map(({ href, label: itemLabel, icon: Icon }) => {
                  const isActive =
                    pathname === href ||
                    (href !== '/management' && href !== '/sales' && href !== '/dashboard' && pathname.startsWith(href + '/')) ||
                    (href === '/management' && pathname === '/management') ||
                    (href === '/sales'      && pathname === '/sales')

                  return (
                    <Link key={href} href={href} onClick={onMobileClose}
                      title={collapsed ? itemLabel : undefined}
                      className="relative flex items-center gap-2.5 mx-2 my-px rounded-lg transition-all duration-150"
                      style={{
                        padding: collapsed ? '9px 0' : '8px 12px',
                        justifyContent: collapsed ? 'center' : undefined,
                        background: isActive ? s.activeBg : 'transparent',
                        color: isActive ? s.activeText : 'rgba(255,255,255,0.42)',
                        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 4px rgba(0,0,0,0.2)' : undefined,
                        border: isActive ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent',
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = s.hoverBg; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)' }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.42)' }}
                    >
                      {/* Active bar */}
                      {isActive && !collapsed && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
                          style={{ height: '60%', background: s.bar, opacity: 0.9, boxShadow: `0 0 8px ${s.bar}60` }} />
                      )}
                      <Icon size={15} className="flex-shrink-0" style={{ opacity: isActive ? 0.95 : 0.65 }} />
                      {!collapsed && (
                        <span className="font-body text-[13px] whitespace-nowrap"
                          style={{ fontWeight: isActive ? 500 : 400, letterSpacing: '0.01em' }}>
                          {itemLabel}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="relative flex-shrink-0 p-2.5 space-y-0.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>

          {/* User card */}
          {!collapsed && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-1.5"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.08))',
                  border: '1px solid rgba(255,255,255,0.16)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
                }}>
                <span className="font-display text-[11px] font-bold text-white">{initials}</span>
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <div className="font-body text-[12px] font-medium text-white/90 truncate leading-snug">
                  {displayName}
                </div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  {department && (
                    <span className="font-mono text-[9px] px-1.5 py-px rounded tracking-[0.06em]"
                      style={{ background: `${deptColor}18`, border: `1px solid ${deptColor}35`, color: deptColor }}>
                      {department}
                    </span>
                  )}
                  {roleLabel && (
                    <span className="font-mono text-[9px] px-1.5 py-px rounded tracking-[0.06em]"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>
                      {roleLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {collapsed && (
            <div className="flex justify-center py-1 mb-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.07))',
                  border: '1px solid rgba(255,255,255,0.14)',
                }}>
                <span className="font-display text-[11px] font-bold text-white">{initials}</span>
              </div>
            </div>
          )}

          {/* Sign out */}
          <button onClick={() => signOut()}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 ${collapsed ? 'justify-center' : ''}`}
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}>
            <LogOut size={14} className="flex-shrink-0" />
            {!collapsed && <span className="font-body text-[12px]">Sign out</span>}
          </button>

          {/* Collapse */}
          <button onClick={() => setCollapsed(c => !c)}
            className={`hidden lg:flex w-full items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 ${collapsed ? 'justify-center' : ''}`}
            style={{ color: 'rgba(255,255,255,0.22)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.22)' }}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && <span className="font-mono text-[9px] tracking-[0.1em] uppercase">Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  )
}