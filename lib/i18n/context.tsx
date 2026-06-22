'use client'
// lib/i18n/context.tsx
// Language context — persists to shared.user_preferences in Supabase.
// Default is 'en'; switches without page reload.
// Safe outside provider: returns identity function for t().

import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Language, LANGUAGES, translate } from './translations'
import { getDb } from '@/lib/supabase/db'

interface LanguageContextType {
  lang:    Language
  setLang: (l: Language) => void
  t:       (key: string) => string
}

export const LanguageContext = createContext<LanguageContextType>({
  lang:    'en',
  setLang: () => {},
  t:       (k) => k,   // Safe fallback outside provider
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')

  useEffect(() => {
    async function load() {
      try {
        const db = getDb()
        const { data: { user } } = await db.auth.getUser()
        if (!user) return
        const { data } = await db
          .schema('shared' as any)
          .from('user_preferences')
          .select('language')
          .eq('user_id', user.id)
          .maybeSingle()
        const saved = (data as any)?.language as Language | null
        if (saved && (LANGUAGES as readonly string[]).includes(saved)) setLangState(saved)
      } catch {}
    }
    load()
  }, [])

  async function setLang(l: Language) {
    setLangState(l)
    try {
      const db = getDb()
      const { data: { user } } = await db.auth.getUser()
      if (!user) return
      await db
        .schema('shared' as any)
        .from('user_preferences')
        .upsert({ user_id: user.id, language: l, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    } catch {}
  }

  const t = (key: string) => translate(lang, key)

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext)
}
