import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Lang } from '@/lib/data/translations'
import type { UserRole } from '@/lib/supabase/database.types'
import { palletKg } from '@/lib/data/sections'

// ── TYPES ────────────────────────────────────────────────────────────────────

export interface BagEntry {
  batch: string
  kg:    string
}

export interface PalletEntry {
  batch: string
  boxes: string
  bags:  string
  paper: string
}

export interface ItemState {
  variant:  string
  ns:       boolean      // nothing-here / no-stock
  bags:     BagEntry[]
  pallets:  PalletEntry[]
}

export type CountState = Record<string, ItemState>  // key = `${sectionId}__${itemUid}`

// ── HELPERS ──────────────────────────────────────────────────────────────────

export function itemKey(sectionId: string, itemUid: string): string {
  return `${sectionId}__${itemUid}`
}

export function defaultItemState(firstVariant?: string): ItemState {
  return {
    variant: firstVariant ?? '',
    ns:      false,
    bags:    [{ batch: '', kg: '' }],
    pallets: [{ batch: '', boxes: '', bags: '', paper: '' }],
  }
}

export function bagTotal(bags: BagEntry[]): number {
  return bags.reduce((sum, b) => sum + (parseFloat(b.kg) || 0), 0)
}

export function palletTotal(pallets: PalletEntry[]): number {
  return pallets.reduce((sum, p) =>
    sum + palletKg(parseInt(p.boxes)||0, parseInt(p.bags)||0, parseInt(p.paper)||0), 0)
}

export function itemTotal(state: ItemState, isPallet: boolean): number {
  if (state.ns) return 0
  return isPallet ? palletTotal(state.pallets) : bagTotal(state.bags)
}

export function groupByBatch(bags: BagEntry[]): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {}
  for (const b of bags) {
    const kg = parseFloat(b.kg) || 0
    if (!kg) continue
    const key = b.batch.trim().toUpperCase() || '(no batch)'
    if (!out[key]) out[key] = { count: 0, total: 0 }
    out[key].count++
    out[key].total = parseFloat((out[key].total + kg).toFixed(3))
  }
  return out
}

// ── DEBOUNCED LOCALSTORAGE STORAGE ───────────────────────────────────────────
// Replaces idb-keyval (IndexedDB) with localStorage + a write debounce.
// IndexedDB causes "Another write batch is already active" when Zustand fires
// multiple rapid set() calls (every keystroke). localStorage is synchronous so
// there is no write-lock issue. The debounce prevents thrashing on rapid typing.

let _writeTimer: ReturnType<typeof setTimeout> | null = null

const debouncedLocalStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name: string, value: string) => {
    // Debounce writes — only persist after 800ms of no further changes
    if (_writeTimer) clearTimeout(_writeTimer)
    _writeTimer = setTimeout(() => {
      try { localStorage.setItem(name, value) } catch (e) {
        console.warn('countStore persist failed:', e)
      }
    }, 800)
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
}))

// ── STORE ────────────────────────────────────────────────────────────────────

interface CountStore {
  // Session
  role:         UserRole
  lang:         Lang
  date:         string
  sessionId:    string | null
  submitted:    boolean
  product:      'r' | 'h'
  notes:        string

  // Data
  items:        CountState
  customItems:  Record<string, Array<{ base: string; name: string }>>

  // Actions
  setRole:      (role: UserRole) => void
  setLang:      (lang: Lang) => void
  setDate:      (date: string) => void
  setSessionId: (id: string) => void
  setSubmitted: (v: boolean) => void
  setProduct:   (p: 'r' | 'h') => void
  setNotes:     (n: string) => void
  resetForDate: (date: string, role: UserRole) => void

  // Item mutations
  getItem:      (key: string, firstVariant?: string) => ItemState
  setVariant:   (key: string, variant: string) => void
  setNS:        (key: string, ns: boolean) => void
  addBag:       (key: string) => void
  removeBag:    (key: string, index: number) => void
  updateBag:    (key: string, index: number, field: 'batch' | 'kg', value: string) => void
  addPallet:    (key: string) => void
  removePallet: (key: string, index: number) => void
  updatePallet: (key: string, index: number, field: 'batch'|'boxes'|'bags'|'paper', value: string) => void
  addCustomItem:(sectionId: string, base: string, name: string) => void
}

export const useCountStore = create<CountStore>()(
  persist(
    (set, get) => ({
      role: 'admin',
      lang: 'en',
      date: new Date().toISOString().slice(0, 10),
      sessionId: null,
      submitted: false,
      product: 'r',
      notes: '',
      items: {},
      customItems: {},

      setRole:      (role)      => set({ role }),
      setLang:      (lang)      => set({ lang }),
      setDate:      (date)      => set({ date }),
      setSessionId: (id)        => set({ sessionId: id }),
      setSubmitted: (submitted) => set({ submitted }),
      setProduct:   (product)   => set({ product }),
      setNotes:     (notes)     => set({ notes }),

      resetForDate: (date, role) => set({
        date, role,
        sessionId: null,
        submitted: false,
        items: {},
        notes: '',
      }),

      getItem: (key, firstVariant) => {
        const items = get().items
        if (!items[key]) {
          const def = defaultItemState(firstVariant)
          set(s => ({ items: { ...s.items, [key]: def } }))
          return def
        }
        return items[key]
      },

      setVariant: (key, variant) =>
        set(s => ({ items: { ...s.items, [key]: { ...s.items[key], variant } } })),

      setNS: (key, ns) =>
        set(s => ({ items: { ...s.items, [key]: { ...s.items[key], ns } } })),

      addBag: (key) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const last = item.bags[item.bags.length - 1]
        if (!last?.batch.trim()) return s
        return {
          items: {
            ...s.items,
            [key]: {
              ...item,
              bags: [...item.bags, { batch: last.batch, kg: '' }],
            },
          },
        }
      }),

      removeBag: (key, index) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const bags = item.bags.length === 1
          ? [{ batch: '', kg: '' }]
          : item.bags.filter((_, i) => i !== index)
        return { items: { ...s.items, [key]: { ...item, bags } } }
      }),

      updateBag: (key, index, field, value) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const bags = [...item.bags]
        bags[index] = {
          ...bags[index],
          [field]: field === 'batch' ? value.toUpperCase() : value,
        }
        return { items: { ...s.items, [key]: { ...item, bags } } }
      }),

      addPallet: (key) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const last = item.pallets[item.pallets.length - 1]
        return {
          items: {
            ...s.items,
            [key]: {
              ...item,
              pallets: [...item.pallets, { batch: last?.batch ?? '', boxes: '', bags: '', paper: '' }],
            },
          },
        }
      }),

      removePallet: (key, index) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const pallets = item.pallets.length === 1
          ? [{ batch: '', boxes: '', bags: '', paper: '' }]
          : item.pallets.filter((_, i) => i !== index)
        return { items: { ...s.items, [key]: { ...item, pallets } } }
      }),

      updatePallet: (key, index, field, value) => set(s => {
        const item = s.items[key] ?? defaultItemState()
        const pallets = [...item.pallets]
        pallets[index] = {
          ...pallets[index],
          [field]: field === 'batch' ? value.toUpperCase() : value,
        }
        return { items: { ...s.items, [key]: { ...item, pallets } } }
      }),

      addCustomItem: (sectionId, base, name) => set(s => {
        const existing = s.customItems[sectionId] ?? []
        if (existing.some(i => i.base === base)) return s
        return {
          customItems: {
            ...s.customItems,
            [sectionId]: [...existing, { base, name }],
          },
        }
      }),
    }),
    {
      name: 'cntp-count',
      storage: debouncedLocalStorage,
      // Only persist draft data — session IDs are transient
      partialize: (s) => ({
        role:        s.role,
        lang:        s.lang,
        date:        s.date,
        product:     s.product,
        notes:       s.notes,
        items:       s.submitted ? {} : s.items,
        customItems: s.customItems,
      }),
    }
  )
)