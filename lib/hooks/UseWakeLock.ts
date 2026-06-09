'use client'

import { useEffect, useRef } from 'react'

/**
 * useWakeLock — prevents the device screen from sleeping while active.
 *
 * Uses the Screen Wake Lock API (supported on Chrome/Edge/Android Chrome).
 * Falls back silently on unsupported browsers (iOS Safari doesn't support it yet).
 *
 * Usage: call this hook at the top of any page where the screen must stay on.
 *   useWakeLock()
 *
 * The lock is automatically released when the component unmounts or the
 * page becomes hidden (tab switch), and re-acquired when the page is visible again.
 */
export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  async function acquire() {
    if (!('wakeLock' in navigator)) return
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
    } catch (e) {
      // Permission denied or not supported — fail silently
      console.debug('[CNTP] Wake lock not available:', e)
    }
  }

  async function release() {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release()
      wakeLockRef.current = null
    }
  }

  useEffect(() => {
    acquire()

    // Re-acquire after tab becomes visible again
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      release()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}