'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Bell, X, Check, Trash2, CheckCheck, Dot } from 'lucide-react'

// One unified notification shape — everything now lives in shared.notifications.
interface Note {
  id:         string
  source:     string
  kind:       string | null
  title:      string
  body:       string | null
  url:        string | null
  urgent:     boolean
  from_name:  string | null
  read_at:    string | null
  created_at: string
}

const SOURCE_LABEL: Record<string, string> = {
  maintenance: 'Maintenance', axis: 'AXIS', roster: 'Roster',
  production: 'Production', announcement: 'Announcement', system: '',
}

export default function NotificationBell() {
  const db = getDb()
  const router = useRouter()
  const { userId } = useAuth()

  const [items, setItems] = useState<Note[]>([])
  const [open, setOpen]   = useState(false)
  const [toast, setToast] = useState<Note | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    const { data, error } = await db.schema('shared').from('notifications')
      .select('id,source,kind,title,body,url,urgent,from_name,read_at,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)
    if (!error) setItems((data ?? []) as Note[])
  }, [db, userId])

  useEffect(() => { load() }, [load])

  // Manual nudge from elsewhere in the app (kept for backwards-compat).
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('notifications:refresh', handler)
    return () => window.removeEventListener('notifications:refresh', handler)
  }, [load])

  // Realtime: new rows for this user arrive the instant they're written.
  useEffect(() => {
    if (!userId) return
    const channel = db
      .channel(`notifications:${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'shared', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const n = payload.new as Note
          setItems(prev => (prev.some(p => p.id === n.id) ? prev : [n, ...prev]))
          setToast(n)
          if (toastTimer.current) clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => setToast(null), 6000)
        })
      .subscribe()
    return () => { db.removeChannel(channel) }
  }, [db, userId])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const unreadCount = useMemo(() => items.filter(n => !n.read_at).length, [items])

  async function setRead(id: string, read: boolean) {
    const read_at = read ? new Date().toISOString() : null
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read_at } : n)))
    await db.schema('shared').from('notifications').update({ read_at }).eq('id', id)
  }

  async function markAllRead() {
    const now = new Date().toISOString()
    const unread = items.filter(n => !n.read_at).map(n => n.id)
    if (!unread.length) return
    setItems(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: now })))
    await db.schema('shared').from('notifications').update({ read_at: now }).in('id', unread)
  }

  async function remove(id: string) {
    setItems(prev => prev.filter(n => n.id !== id))
    await db.schema('shared').from('notifications').delete().eq('id', id)
  }

  function openNote(n: Note) {
    if (!n.read_at) setRead(n.id, true)
    setOpen(false)
    setToast(null)
    if (n.url) router.push(n.url)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 32, height: 32, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'rgba(26,58,14,0.08)' : 'transparent',
          border: '1px solid ' + (open ? 'rgba(26,58,14,0.15)' : 'transparent'),
          cursor: 'pointer', position: 'relative', transition: 'background 120ms, border 120ms',
        }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)' }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={15} style={{ color: unreadCount > 0 ? '#1A3A0E' : '#9CA3AF' }} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 1, right: 1, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 8, background: '#1A3A0E', color: '#fff', border: '1.5px solid white',
            fontSize: 9, fontWeight: 700, lineHeight: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Toast — pops the moment a notification arrives */}
      {toast && !open && (
        <button
          onClick={() => openNote(toast)}
          style={{
            position: 'fixed', top: 60, right: 20, width: 300, textAlign: 'left',
            background: '#fff', border: '1px solid #E4E7EC', borderLeft: `3px solid ${toast.urgent ? '#B81C1C' : '#1A3A0E'}`,
            borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.16)', padding: '12px 14px',
            zIndex: 10000, cursor: 'pointer',
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 12, color: toast.urgent ? '#B81C1C' : '#1A2415', margin: 0 }}>{toast.title}</p>
          {toast.body && <p style={{ fontSize: 11, color: '#637056', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.body}</p>}
        </button>
      )}

      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0, width: 340, maxHeight: 460,
          background: '#fff', border: '1px solid #E4E7EC', borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden', zIndex: 9999, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 10px', borderBottom: '1px solid #E4E7EC', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#1A2415' }}>Notifications</span>
              {unreadCount > 0 && (
                <span style={{ background: '#1A3A0E', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} title="Mark all read"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 6, fontSize: 10, color: '#637056', fontFamily: 'var(--font-mono)' }}>
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}>
                <X size={13} style={{ color: '#9CA3AF' }} />
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9CA3AF' }}>
                You&apos;re all caught up
              </div>
            ) : items.map(n => {
              const label = SOURCE_LABEL[n.source] ?? ''
              const dot = n.read_at ? '#E4E7EC' : (n.urgent ? '#B81C1C' : '#1A3A0E')
              return (
                <div key={n.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px 10px 14px',
                    borderBottom: '1px solid #F3F4F6',
                    background: n.read_at ? 'transparent' : (n.urgent ? 'rgba(184,28,28,0.05)' : 'rgba(26,58,14,0.03)'),
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 6 }} />
                  <button onClick={() => openNote(n)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: n.url ? 'pointer' : 'default' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontWeight: n.read_at ? 400 : 600, fontSize: 12, color: n.urgent ? '#B81C1C' : '#1A2415', margin: 0 }}>{n.title}</p>
                    {n.body && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#637056', margin: '2px 0 0' }}>{n.body}</p>}
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                      {label ? `${label} · ` : ''}{formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
                    </p>
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => setRead(n.id, !n.read_at)} title={n.read_at ? 'Mark unread' : 'Mark read'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, borderRadius: 5, display: 'flex' }}>
                      {n.read_at ? <Dot size={16} /> : <Check size={13} />}
                    </button>
                    <button onClick={() => remove(n.id)} title="Delete"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, borderRadius: 5, display: 'flex' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
