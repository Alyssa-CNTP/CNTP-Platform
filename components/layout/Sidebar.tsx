'use client'

import { useState }    from 'react'
import Image           from 'next/image'
import Link            from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth }     from '@/lib/auth/context'
import {
  LayoutDashboard, ClipboardList, ChartNoAxesCombined, BarChart2, Home,
  Users, Radio, Info, Tag, LogOut, Beaker, Leaf,
  TrendingUp, Globe, FlaskConical,
  Microscope, FileText, BookOpen, Layers, Settings,
  FolderKanban, GitPullRequest, Inbox, Send, Shield, MessageSquare, KanbanSquare,
  PanelLeftClose, PanelLeftOpen,
  Boxes, PackageOpen,
  Sparkles, Flag, Network, Cpu, Ticket, Flower2,
  CalendarCheck, CalendarRange, Activity, ClipboardCheck,
  FileSpreadsheet, GraduationCap, Printer, Warehouse, Wrench,
  Tags, History,
} from 'lucide-react'
import type { PermissionKey } from '@/lib/auth/permissions'
import { flags } from '@/lib/config/flags'

export interface NavItem {
  href:         string
  label:        string
  icon:         React.ElementType
  group:        string
  departments?: string[]
  permission?:  PermissionKey
  itOnly?:      boolean
  // permission is an ALTERNATIVE to department (department OR permission), not an
  // additional requirement — see the matching flag in app/(app)/layout.tsx.
  orPermission?: boolean
}

// Group order is driven by first-appearance below:
// Production → Pasteuriser → Operations → HR → Quality → Maintenance → Sales → Marketing →
// Logistics → Management → Workspace → AXIS → Admin.
// Home is rendered as a standalone item above the groups (see render).
export const NAV: NavItem[] = [
  // ── Production — capture work & oversight ──
  { href: '/production/dashboard',      label: 'Production Dashboard',       icon: ChartNoAxesCombined, group: 'Production', departments: ['Production','Management'] },
  { href: '/production/capture',        label: 'Capture',                    icon: ClipboardList,   group: 'Production', departments: ['Production'], permission: 'can_submit_count' },
  { href: '/production/orders',         label: 'Production Orders',          icon: FileText,        group: 'Production', departments: ['Production','Management'], permission: 'can_view_live_history', orPermission: true },
  { href: '/production/inventory',      label: 'Master Inventory',           icon: PackageOpen,     group: 'Production', departments: ['Production','Management'], permission: 'can_view_inventory', orPermission: true },
  { href: '/production/blends',         label: 'BOMs',                       icon: Layers,          group: 'Production', departments: ['Production','Management'], permission: 'can_view_blends', orPermission: true },
  { href: '/job-cards',                 label: 'Job Cards',                  icon: FileText,        group: 'Production', departments: ['Production','Management'], permission: 'can_view_blends', orPermission: true },
  { href: '/count',                     label: 'Stock Count',                icon: Boxes,           group: 'Production', departments: ['Production'], permission: 'can_submit_count' },
  { href: '/supervisor',                label: 'Supervisor Hub',             icon: Activity,        group: 'Production', departments: ['Production','Management'] },

  // ── Pasteuriser — the finished-product label chain ──
  // Four entries rather than one, because three different people own three of
  // them and each lands on the screen for their own step. Sales appear here via
  // orPermission: they are not in the Production department but the Labels
  // screen is theirs.
  { href: '/pasteuriser/labels',        label: 'Labels',                     icon: Tags,            group: 'Pasteuriser', departments: ['Production','Sales','Management'], permission: 'can_view_labels', orPermission: true },
  { href: '/pasteuriser/job-cards',     label: 'Label Job Cards',            icon: ClipboardList,   group: 'Pasteuriser', departments: ['Production','Management'], permission: 'can_view_labels', orPermission: true },
  { href: '/pasteuriser/run',           label: 'Run & Print',                icon: Printer,         group: 'Pasteuriser', departments: ['Production'], permission: 'can_print_labels', orPermission: true },
  { href: '/pasteuriser/history',       label: 'Label History',              icon: History,         group: 'Pasteuriser', departments: ['Production','Sales','Management','Quality'], permission: 'can_view_labels', orPermission: true },

  // ── Operations — cross-role, universal entries ──
  { href: '/production/roster',         label: 'Shift Rosters',              icon: CalendarRange,   group: 'Operations', permission: 'can_view_roster' },
  { href: '/tags',                      label: 'Bag Tracking',               icon: Tag,             group: 'Operations', departments: ['Production','Quality'], permission: 'can_access_bag_tracking', orPermission: true },
  { href: '/stock-control',             label: 'Stock Control',              icon: Printer,         group: 'Operations', departments: ['Production','Management'] },

  // ── Warehousing — GRN / Delivery Note books, one tab per receiving site.
  // More sites (and, per-site, more areas like tea courts vs depots) get added
  // here as they come online; for now it's these five, each its own book pair.
  { href: '/notebooks',                 label: 'All Sites',                  icon: BookOpen,        group: 'Warehousing', permission: 'can_access_notebooks' },
  { href: '/notebooks/site/BH',         label: 'Blackheath',                 icon: Warehouse,       group: 'Warehousing', permission: 'can_access_notebooks' },
  { href: '/notebooks/site/GD',         label: 'Graafwater Depot',           icon: Warehouse,       group: 'Warehousing', permission: 'can_access_notebooks' },
  { href: '/notebooks/site/GT',         label: 'Graafwater Tea Court',       icon: Warehouse,       group: 'Warehousing', permission: 'can_access_notebooks' },
  { href: '/notebooks/site/VD',         label: 'Vanrhynsdorp Depot',         icon: Warehouse,       group: 'Warehousing', permission: 'can_access_notebooks' },
  { href: '/notebooks/site/VT',         label: 'Vanrhynsdorp Tea Court',     icon: Warehouse,       group: 'Warehousing', permission: 'can_access_notebooks' },

  // ── HR — just two doors in. Staff Directory is people + how they sign in
  // (gated — it's OTHER people's data); Training is the whole qualification
  // home (courses, assignments, sign-offs, Skills Matrix, SOP Catalogue) and
  // stays open to everyone since it's also how every employee reaches their
  // own assigned training — the sub-pages that view others' records gate
  // themselves via ROUTE_GUARDS in app/(app)/layout.tsx.
  { href: '/production/staff',          label: 'Staff Directory',            icon: Users,           group: 'HR', permission: 'can_access_hr' },
  { href: '/training',                  label: 'Training',                   icon: GraduationCap,   group: 'HR' },

  // ── Quality ──
  // Ordered to follow the physical/QC flow: Raw Material → Sieving → Pasteuriser
  // → Granule Line → Final Product Lab Results → COA Generator → Customer Specs
  // → Lab Manager → Maintenance QC.
  { href: '/quality/raw-material',      label: 'Raw Material',               icon: Layers,          group: 'Quality', departments: ['Quality'], permission: 'can_upload_pdfs' },
  { href: '/quality/sieving',           label: 'Sieving',                    icon: Beaker,          group: 'Quality', departments: ['Quality'], permission: 'can_add_sieving_runs' },
  { href: '/quality/pasteuriser',       label: 'Pasteuriser',                icon: FlaskConical,    group: 'Quality', departments: ['Quality'], permission: 'can_create_runs' },
  { href: '/quality/granule',           label: 'Granule Line',               icon: Microscope,      group: 'Quality', departments: ['Quality'], permission: 'can_create_runs' },
  { href: '/quality/lab-results',       label: 'Final Product Lab Results',  icon: FileText,        group: 'Quality', departments: ['Quality'], permission: 'can_save_lab_results' },
  { href: '/quality/coa',               label: 'COA Generator',              icon: FileSpreadsheet, group: 'Quality', departments: ['Quality'], permission: 'can_save_lab_results' },
  { href: '/quality/customer-specs',    label: 'Customer Specs',             icon: BookOpen,        group: 'Quality', departments: ['Quality','Sales'], permission: 'can_edit_customer_specs' },
  { href: '/quality/lab-manager',       label: 'Lab Manager',                icon: ClipboardCheck,  group: 'Quality', departments: ['Quality'], permission: 'can_approve_runs' },
  { href: '/quality/maintenance-qc',    label: 'Maintenance QC',             icon: ClipboardCheck,  group: 'Quality', departments: ['Quality','Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },

  // ── Maintenance — full module is Maintenance + Management; Production sees only Job Cards ──
  { href: '/maintenance',               label: 'Dashboard',                  icon: LayoutDashboard, group: 'Maintenance', departments: ['Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/maintenance/job-cards',     label: 'Job Cards',                  icon: ClipboardList,   group: 'Maintenance', departments: ['Maintenance','Management','Production'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/maintenance/my-jobs',        label: 'My Job Cards',               icon: Wrench,          group: 'Maintenance', departments: ['Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/quality/maintenance-qc',    label: 'QC Sign-off',                icon: ClipboardCheck,  group: 'Maintenance', departments: ['Maintenance','Quality','Management'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/maintenance/scheduled',     label: 'Scheduled',                  icon: CalendarCheck,   group: 'Maintenance', departments: ['Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/maintenance/planner',       label: 'Planner & Roster',           icon: CalendarRange,   group: 'Maintenance', departments: ['Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },
  { href: '/maintenance/stock',         label: 'Stock & Spares',             icon: Boxes,           group: 'Maintenance', departments: ['Maintenance','Management'], permission: 'can_access_maintenance', orPermission: true },

  // ── Sales ──
  { href: '/sales',                     label: 'Sales Dashboard',            icon: TrendingUp,      group: 'Sales', departments: ['Sales','Management'], permission: 'can_access_sales' },
  { href: '/intelligence/expansion',    label: 'Expansion',                  icon: Globe,           group: 'Sales', departments: ['Sales','Management','Marketing'], permission: 'can_access_intelligence' as PermissionKey },
  { href: '/intelligence/global-wits',  label: 'Global Wits',                icon: FileSpreadsheet, group: 'Sales', departments: ['Sales','Management','Marketing'], permission: 'can_access_intelligence' as PermissionKey },
  { href: '/intelligence/leads',        label: 'Lead Pipeline',              icon: KanbanSquare,    group: 'Sales', departments: ['Sales','Management','Marketing'], permission: 'can_access_intelligence' as PermissionKey },
  { href: '/research',                  label: 'Alara',                      icon: Leaf,            group: 'Sales', departments: ['Sales','Management','Marketing'], permission: 'can_access_research' },
  { href: '/intelligence/south-africa', label: 'South Africa',               icon: Flag,            group: 'Sales', departments: ['Sales','Management','Marketing'], permission: 'can_access_intelligence' as PermissionKey },

  // ── Marketing ──
  { href: '/marketing',                 label: 'Marketing Hub',              icon: Sparkles,        group: 'Marketing', departments: ['Marketing','Management'], permission: 'can_access_marketing' as PermissionKey },
  { href: '/intelligence/marketing',    label: 'Marketing Intelligence',     icon: TrendingUp,      group: 'Marketing', departments: ['Marketing','Sales','Management'], permission: 'can_access_intelligence' as PermissionKey },

  // ── Logistics — module hidden for now (not in use); routes are also
  // blocked in app/(app)/layout.tsx's ROUTE_GUARDS (disabled: true). Re-add
  // these entries and drop that flag to bring it back.
  // { href: '/logistics',                 label: 'Overview',                   icon: Boxes,           group: 'Logistics', departments: ['Production','Quality','Management'], permission: 'can_access_logistics', orPermission: true },
  // { href: '/logistics/dispatch',        label: 'Dispatch',                   icon: Truck,           group: 'Logistics', departments: ['Production','Quality','Management'], permission: 'can_access_logistics', orPermission: true },
  // { href: '/logistics/receiving',       label: 'Receiving',                  icon: PackageOpen,     group: 'Logistics', departments: ['Production','Quality','Management'], permission: 'can_access_logistics', orPermission: true },
  // { href: '/logistics/warehouse',       label: 'Warehouse',                  icon: WarehouseIcon,   group: 'Logistics', departments: ['Production','Quality','Management'], permission: 'can_access_logistics', orPermission: true },

  // ── Management ──
  { href: '/management',                label: 'Operations Review',          icon: BarChart2,       group: 'Management', departments: ['Management'], permission: 'can_view_management' },
  { href: '/management/platform',       label: 'Platform Health',            icon: Cpu,             group: 'Management', departments: ['Management'], permission: 'can_view_management' },

  // ── Workspace ──
  { href: '/workspace',                 label: 'My Workspace',               icon: Flower2,         group: 'Workspace', permission: 'can_access_workspace' as PermissionKey },

  // ── AXIS — IT change & project tracking (last module group) ──
  { href: '/axis',                      label: 'AXIS Dashboard',             icon: FolderKanban,    group: 'AXIS', itOnly: true },
  { href: '/axis/changelog',            label: 'Change Log',                 icon: GitPullRequest,  group: 'AXIS', itOnly: true },
  { href: '/axis/consideration',        label: 'Consideration',              icon: Inbox,           group: 'AXIS', itOnly: true },
  { href: '/axis/standards',            label: 'Dev Standards',              icon: Shield,          group: 'AXIS', itOnly: true },
  { href: '/axis/request',              label: 'Submit Request',             icon: Send,            group: 'AXIS' },
  { href: '/axis/tickets',              label: 'Tickets',                    icon: Ticket,          group: 'AXIS', departments: ['IT'], permission: 'can_assign_tickets', orPermission: true },

  // ── Admin — always last ──
  { href: '/settings',                  label: 'Settings',                   icon: Settings,        group: 'Admin' },
  { href: '/users',                     label: 'Users & Roles',              icon: Users,           group: 'Admin', permission: 'can_manage_users' },
]

// Shared visibility rule — same predicate Sidebar renders with, exported so
// other surfaces (e.g. the command search's page results) show exactly the
// pages a user could actually reach, no more and no less.
export function getVisibleNavItems(nav: NavItem[], ctx: {
  role:        string | null
  department:  string | null
  isIT:        boolean
  isFullAdmin: boolean
  p:           (key: PermissionKey) => boolean
}): NavItem[] {
  // Floor operators get a sandboxed, app-like nav — their own dashboard + capture only.
  // No general dashboard, no settings, no other modules.
  if (ctx.role === 'floor_operator') {
    return [
      { href: '/production/capture', label: 'My Dashboard', icon: LayoutDashboard, group: 'Production' },
      { href: '/training/my',        label: 'Training',     icon: GraduationCap,   group: 'Production' },
    ]
  }

  const isUnassigned = !ctx.role && !ctx.department
  return nav.filter(item => {
    // Unassigned users (no role, no department) see only Submit Request + Settings
    if (isUnassigned) return item.href === '/axis/request' || item.href === '/settings'
    if (item.href === '/settings') return true
    if (item.href === '/suggest') return true
    if (item.itOnly && !ctx.isIT && !ctx.isFullAdmin) return false
    if (item.href === '/axis/request') return true
    if (ctx.isFullAdmin) return true

    // Core rule: if the item has a permission gate AND the user has that permission
    // explicitly enabled (override), let them through regardless of department.
    // This means permissions are the single source of truth.
    // Department is only used when there is NO explicit permission override.
    const hasExplicitPermission = item.permission && ctx.p(item.permission)

    // Developers (senior_developer handled above, co_developer here) see every
    // department's nav — they bypass the department check but still need any
    // permission an item requires (so admin-only items stay hidden).
    const isDeveloper = ctx.role === 'co_developer'

    if (!hasExplicitPermission) {
      // No explicit permission — fall back to department check
      if (item.departments && !isDeveloper && !(ctx.department && item.departments.includes(ctx.department))) return false
      // Department matches — still need the permission, unless it's an alternative
      // to department (orPermission), in which case department alone suffices.
      if (item.permission && !item.orPermission && !ctx.p(item.permission)) return false
    }

    return true
  })
}

export default function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname  = usePathname()
  const { department, role, displayName, initials, signOut, p, isIT, isFullAdmin } = useAuth()

  // Plain conditional filtering, not a registry (ARCHITECTURE.md §3.2). The
  // flag is a ROLLOUT control: it hides the entries while the label set is
  // being transcribed and re-approved. Access is still the route guards' job.
  const nav = flags.pasteuriserLabels ? NAV : NAV.filter(i => i.group !== 'Pasteuriser')
  const visibleNav = getVisibleNavItems(nav, { role, department, isIT, isFullAdmin, p })

  const groups: { label: string; items: NavItem[] }[] = []
  for (const item of visibleNav) {
    const g = groups.find(s => s.label === item.group)
    if (g) g.items.push(item)
    else   groups.push({ label: item.group, items: [item] })
  }

  const roleLabel = role?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? ''

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 xl:hidden"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={onMobileClose}
        />
      )}

      <aside
        className={[
          'fixed xl:relative inset-y-0 left-0 z-50 xl:z-auto',
          'flex flex-col overflow-hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0',
        ].join(' ')}
        style={{
          width: collapsed ? 60 : 224,
          transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
          background: 'linear-gradient(180deg, #FFFFFF 0%, #F7F7F7 25%, #F0F0F0 60%, #E8E8E8 100%)',
          borderRight: '1px solid #DEDEDE',
          boxShadow: '2px 0 12px rgba(0,0,0,0.06)',
        }}
      >

        {/* ── Brand header ─────────────────────────────────────── */}
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: collapsed ? '0 13px' : '0 14px',
            gap: 10,
            borderBottom: '1px solid #EBEBEB',
            flexShrink: 0,
          }}
        >
          <div style={{
            width: collapsed ? 32 : 36,
            height: collapsed ? 32 : 36,
            borderRadius: 9,
            flexShrink: 0,
            overflow: 'hidden',
            background: '#FFFFFF',
            boxShadow: '0 1px 6px rgba(26,58,14,0.14), 0 0 0 1px rgba(26,58,14,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'width 220ms, height 220ms',
          }}>
            <Image
              src="/logo.png"
              alt="Cape Natural"
              width={collapsed ? 28 : 32}
              height={collapsed ? 28 : 32}
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>

          {!collapsed && (
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: '#111827',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}>
                Cape Natural
              </div>
              <div style={{
                fontSize: 10.5,
                color: '#9CA3AF',
                whiteSpace: 'nowrap',
                marginTop: 1,
                fontWeight: 400,
                letterSpacing: '0.01em',
              }}>
                Operations Platform
              </div>
            </div>
          )}
        </div>

        {/* Search moved to the Topbar, centered — see components/layout/Topbar.tsx */}

        {/* ── Navigation ───────────────────────────────────────── */}
        <nav
          style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}
        >
          {/* Standalone Home — the landing page, sits above all groups */}
          <Link
            href="/home"
            onClick={onMobileClose}
            title={collapsed ? 'Home' : undefined}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', gap: 9,
              margin: '6px 8px 2px', padding: collapsed ? '8px 0' : '6.5px 10px',
              justifyContent: collapsed ? 'center' : undefined, borderRadius: 7,
              textDecoration: 'none',
              background: pathname === '/home' ? '#DCFCE7' : 'transparent',
              color: pathname === '/home' ? '#166534' : '#4B5563',
              fontWeight: pathname === '/home' ? 500 : 400,
            }}
          >
            {pathname === '/home' && !collapsed && (
              <div style={{ position: 'absolute', left: 0, top: '18%', bottom: '18%', width: 3, borderRadius: '0 3px 3px 0', background: '#16A34A' }} />
            )}
            <Home size={15} style={{ flexShrink: 0, opacity: pathname === '/home' ? 1 : 0.6 }} />
            {!collapsed && <span style={{ fontSize: 13, whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>Home</span>}
          </Link>
          {groups.map(({ label, items }) => (
            <div key={label}>
              {!collapsed ? (
                <div style={{ padding: '14px 16px 4px' }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    color: '#9CA3AF',
                  }}>
                    {label}
                  </span>
                </div>
              ) : (
                <div style={{ margin: '10px 12px 4px', height: 1, background: '#E5E7EB' }} />
              )}

              {items.map(({ href, label: itemLabel, icon: Icon }) => {
                const isActive =
                  pathname === href ||
                  (href === '/axis' && pathname.startsWith('/axis/projects')) ||
                  (href !== '/management' && href !== '/sales' && href !== '/dashboard' && href !== '/axis' && href !== '/intelligence' && href !== '/production' && href !== '/maintenance' && href !== '/notebooks' && pathname.startsWith(href + '/')) ||
                  (href === '/production/live' && pathname.startsWith('/production/live')) ||
                  (href === '/production/capture' && pathname.startsWith('/production/capture')) ||
                  (href === '/management'   && pathname === '/management') ||
                  (href === '/sales'        && pathname === '/sales') ||
                  (href === '/intelligence' && pathname === '/intelligence') ||
                  (href === '/maintenance'  && pathname === '/maintenance')

                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onMobileClose}
                    title={collapsed ? itemLabel : undefined}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      margin: '1px 8px',
                      padding: collapsed ? '8px 0' : '6.5px 10px',
                      justifyContent: collapsed ? 'center' : undefined,
                      borderRadius: 7,
                      textDecoration: 'none',
                      background: isActive ? '#DCFCE7' : 'transparent',
                      color: isActive ? '#166534' : '#4B5563',
                      fontWeight: isActive ? 500 : 400,
                      transition: 'background 120ms, color 120ms',
                    }}
                    onMouseEnter={e => {
                      if (isActive) return
                      const el = e.currentTarget as HTMLElement
                      el.style.background = 'rgba(0,0,0,0.05)'
                      el.style.color = '#111827'
                    }}
                    onMouseLeave={e => {
                      if (isActive) return
                      const el = e.currentTarget as HTMLElement
                      el.style.background = 'transparent'
                      el.style.color = '#4B5563'
                    }}
                  >
                    {/* Active indicator */}
                    {isActive && !collapsed && (
                      <div style={{
                        position: 'absolute',
                        left: 0, top: '18%', bottom: '18%',
                        width: 3,
                        borderRadius: '0 3px 3px 0',
                        background: '#16A34A',
                      }} />
                    )}

                    <Icon
                      size={15}
                      style={{ flexShrink: 0, opacity: isActive ? 1 : 0.6 }}
                    />

                    {!collapsed && (
                      <span style={{
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                        letterSpacing: '-0.01em',
                      }}>
                        {itemLabel}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          padding: 8,
          borderTop: '1px solid #E5E7EB',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {/* User card */}
          {!collapsed ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.7)',
              border: '1px solid #E5E7EB',
              marginBottom: 2,
            }}>
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #166534 0%, #15803D 100%)',
              }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>
                  {initials}
                </span>
              </div>
              <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: '#111827',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  letterSpacing: '-0.01em',
                }}>
                  {displayName}
                </div>
                {department && (
                  <div style={{ fontSize: 10, color: '#16A34A', fontWeight: 500, marginTop: 1 }}>
                    {department}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 6px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #166534 0%, #15803D 100%)',
              }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff' }}>{initials}</span>
              </div>
            </div>
          )}

          {/* Sign out */}
          <FooterBtn onClick={() => signOut()} collapsed={collapsed} icon={<LogOut size={13} />} label="Sign out" />

          {/* Collapse toggle */}
          <FooterBtn
            className="hidden xl:flex"
            onClick={() => setCollapsed(c => !c)}
            collapsed={collapsed}
            icon={collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            label="Collapse"
          />
        </div>
      </aside>
    </>
  )
}

function FooterBtn({
  onClick, collapsed, icon, label, className,
}: {
  onClick: () => void
  collapsed: boolean
  icon: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={className}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        justifyContent: collapsed ? 'center' : undefined,
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: '#9CA3AF',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = 'rgba(0,0,0,0.05)'
        el.style.color = '#374151'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = 'transparent'
        el.style.color = '#9CA3AF'
      }}
    >
      {icon}
      {!collapsed && (
        <span style={{ fontSize: 12, letterSpacing: '-0.01em' }}>{label}</span>
      )}
    </button>
  )
}
