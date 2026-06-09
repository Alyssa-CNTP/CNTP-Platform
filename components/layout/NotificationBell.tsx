'use client'

import { useEffect, useRef, useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Bell, X, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Announcement {
  id:                 string
  title:              string
  from_name:          string
  target_departments: string[]
  created_at:         string
}

export default function NotificationBell() {
  const db = getDb()
  const { userId, department, isManagement, isIT } = useAuth()

  const [anns,      setAnns]      = useState<Announcement[]>([])
  const [readIds,   setReadIds]   = useState<Set<string>>(new Set())
  const [open,      setOpen]      = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { if (userId) load() }, [userId])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  async function load() {
    const [{ data: annData }, { data: readData }] = await Promise.all([
      db.from('management_announcements')
        .select('id,title,from_name,target_departments,created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('announcement_reads').select('announcement_id').eq('user_id', userId),
    ])

    const all = (annData ?? []) as Announcement[]
    const visible = all.filter(a =>
      isManagement || isIT || !a.target_departments.length || (department && a.target_departments.includes(department))
    )
    setAnns(visible)
    setReadIds(new Set((readData ?? []).map((r: any) => r.announcement_id)))
  }

  const unread = anns.filter(a => !readIds.has(a.id))

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 32, height: 32, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'rgba(26,58,14,0.08)' : 'transparent',
          border: '1px solid ' + (open ? 'rgba(26,58,14,0.15)' : 'transparent'),
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 120ms, border 120ms',
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)' }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        aria-label="Notifications"
      >
        <Bell size={15} style={{ color: unread.length > 0 ? '#1A3A0E' : '#9CA3AF' }} />
        {unread.length > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            width: 8, height: 8, borderRadius: '50%',
            background: '#1A3A0E',
            border: '1.5px solid white',
          }} />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0,
          width: 320, maxHeight: 420,
          background: '#fff',
          border: '1px solid #E4E7EC',
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          zIndex: 100,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 10px', borderBottom: '1px solid #E4E7EC', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#1A2415' }}>Announcements</span>
              {unread.length > 0 && (
                <span style={{
                  background: '#1A3A0E', color: '#fff',
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 10,
                }}>
                  {unread.length} new
                </span>
              )}
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}>
              <X size={13} style={{ color: '#9CA3AF' }} />
            </button>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {anns.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9CA3AF' }}>
                No announcements
              </div>
            ) : anns.map(a => {
              const read = readIds.has(a.id)
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 16px',
                  borderBottom: '1px solid #F3F4F6',
                  background: read ? 'transparent' : 'rgba(26,58,14,0.025)',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: read ? '#E4E7EC' : '#1A3A0E', flexShrink: 0, marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontWeight: read ? 400 : 600, fontSize: 12, color: '#1A2415', margin: 0 }}>
                      {a.title}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                      {a.from_name} · {formatDistanceToNow(parseISO(a.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <Link
            href="/management"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 16px',
              borderTop: '1px solid #E4E7EC',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
              color: '#1A3A0E', textDecoration: 'none',
              background: 'rgba(26,58,14,0.03)',
              flexShrink: 0,
            }}
          >
            View all in Management <ChevronRight size={11} />
          </Link>
        </div>
      )}
    </div>
  )
}
