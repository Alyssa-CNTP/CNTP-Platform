'use client'

/**
 * useInventorySearch
 * ─────────────────────────────────────────────────────────────────────────────
 * Searches production.inventory_items for the add-item modal in the morning
 * count. Falls back gracefully to the hardcoded sections list if the DB table
 * doesn't exist yet (i.e. before the migration has been run).
 *
 * Search matches on:
 *   • inventory_id  (prefix match)
 *   • description   (substring match)
 *   • item_class    (exact match)
 */

import { useState, useCallback, useRef } from 'react'
import { getDb } from '@/lib/supabase/db'
import { ALL_SECTIONS } from '@/lib/data/sections'

export interface SearchResult {
  inventory_id: string
  description:  string
  item_class:   string | null
  source:       'db' | 'local'
}

export function useInventorySearch() {
  const db = getDb()
  const [results,  setResults]  = useState<SearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Fallback: extract all items from sections.ts and filter locally.
   * Useful during development or before the inventory table is populated.
   */
  function searchLocal(query: string): SearchResult[] {
    const q = query.toLowerCase().trim()
    const seen = new Set<string>()
    const out: SearchResult[] = []

    for (const sec of ALL_SECTIONS) {
      for (const item of sec.items) {
        const key = item.base
        if (seen.has(key)) continue
        const match =
          item.base.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.g.toLowerCase().includes(q)
        if (match) {
          seen.add(key)
          out.push({
            inventory_id: item.base,
            description:  item.name,
            item_class:   item.g,
            source:       'local',
          })
        }
      }
    }
    return out.slice(0, 30)
  }

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim()) {
      setResults([])
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const q = query.trim()

        // Try Supabase first
        const { data, error } = await db
          .from('inventory_items')
          .select('inventory_id, description, item_class')
          .eq('active', true)
          .or(
            `inventory_id.ilike.${q}%,` +
            `description.ilike.%${q}%,` +
            `item_class.ilike.%${q}%`
          )
          .order('inventory_id')
          .limit(40)

        if (error || !data || data.length === 0) {
          // Fall back to local search if DB table empty or missing
          setResults(searchLocal(q))
        } else {
          setResults((data as any[]).map(row => ({
            inventory_id: row.inventory_id as string,
            description:  row.description  as string,
            item_class:   row.item_class   as string | null,
            source:       'db' as const,
          })))
        }
      } catch {
        setResults(searchLocal(query))
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [db])

  function clear() {
    setResults([])
    setLoading(false)
  }

  return { results, loading, search, clear }
}
