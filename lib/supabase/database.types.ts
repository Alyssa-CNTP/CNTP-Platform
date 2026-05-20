// Auto-generated types for the production schema
// Run: npx supabase gen types typescript --project-id pyshmteoueucniwaxbwq > lib/supabase/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  production: {
    Tables: {
      sc_sessions: {
        Row: {
          id: string
          count_date: string
          warehouse_id: string
          sup_confirmed_at: string | null
          sup_name: string | null
          sup_total_kg: number | null
          sup_total_bags: number | null
          sup_notes: string | null
          adm_confirmed_at: string | null
          adm_name: string | null
          adm_total_kg: number | null
          adm_total_bags: number | null
          adm_notes: string | null
          match_rate_pct: number | null
          created_at: string
        }
        Insert: Omit<Database['production']['Tables']['sc_sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['sc_sessions']['Insert']>
      }
      sc_entries: {
        Row: {
          id: string
          session_id: string
          warehouse_id: string
          role: 'admin' | 'supervisor'
          inventory_id: string
          inventory_code: string
          item_name: string
          section_id: string
          section_name: string
          entry_type: 'bag' | 'pallet' | 'no_stock'
          is_no_stock: boolean
          batch_number: string | null
          kg: number
          entry_index: number
          boxes: number
          bags_qty: number
          paper_bags: number
          pallet_index: number
          created_at: string
        }
        Insert: Omit<Database['production']['Tables']['sc_entries']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['sc_entries']['Insert']>
      }
      app_roles: {
        Row: {
          id: string
          user_id: string
          role: 'admin' | 'supervisor' | 'management' | 'operator'
          created_at: string
        }
        Insert: Omit<Database['production']['Tables']['app_roles']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['app_roles']['Insert']>
      }
      dev_reports: {
        Row: {
          id: string
          week_start: string
          phase_focus: string
          work_completed: string
          next_steps: string | null
          blockers: string | null
          management_notes: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['production']['Tables']['dev_reports']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['production']['Tables']['dev_reports']['Insert']>
      }
    }
    Views: {
      v_discrepancy_trends: {
        Row: {
          count_date: string
          section_id: string
          item_name: string
          sup_kg: number
          adm_kg: number
          abs_variance_kg: number
        }
      }
    }
  }
}

// Convenience row types
export type ScSession  = Database['production']['Tables']['sc_sessions']['Row']
export type ScEntry    = Database['production']['Tables']['sc_entries']['Row']
export type AppRole    = Database['production']['Tables']['app_roles']['Row']
export type DevReport  = Database['production']['Tables']['dev_reports']['Row']
export type UserRole   = 'admin' | 'supervisor' | 'management' | 'operator'
