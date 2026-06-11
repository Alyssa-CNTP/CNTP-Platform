// Auto-generated types for the production schema
// Regenerate with: npx supabase gen types typescript --project-id <id> >> lib/supabase/database.types.ts
// Last updated: 2026-06-11 — clean schema migration 001

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// ── Shared domain types ───────────────────────────────────────
export type Shift          = 'morning' | 'afternoon' | 'night'
export type SessionStatus  = 'draft' | 'submitted' | 'approved'
export type OutputGroup    = 'B' | 'C' | 'D'
export type BagStatus      = 'in_stock' | 'in_process' | 'consumed' | 'dispatched' | 'on_hold' | 'rejected'
export type SignerRole     = 'operator' | 'supervisor' | 'qc'
export type ScanAction     = 'debagging_in' | 'bagging_out' | 'stock_count' | 'dispatch' | 'reprint'
export type LocalExport    = 'Export' | 'Export Blend' | 'Domestic/Local'
export type OrgConv        = 'CON' | 'ORG'
export type SectionId      = 'sieving' | 'refining1' | 'refining2' | 'granule' | 'blender' | 'pasteuriser'
export type Variant        = 'Conventional' | 'Organic' | 'RA-Conventional' | 'RA-Organic' | 'FT-ORG'

export interface Database {
  production: {
    Tables: {

      // ── prod_sessions ───────────────────────────────────────
      prod_sessions: {
        Row: {
          id:                 string
          section_id:         SectionId
          date:               string
          shift:              Shift
          status:             SessionStatus
          operator_names:     string[] | null
          supervisor_name:    string | null
          lot_number:         string | null
          variant:            Variant | null
          production_orders:  string[] | null
          section_config:     Json
          scale_std_kg:       number | null
          scale_actual_kg:    number | null
          op_signed:          boolean
          op_name_signoff:    string | null
          op_signed_at:       string | null
          sup_signed:         boolean
          sup_name_signoff:   string | null
          sup_signed_at:      string | null
          comments:           string | null
          submitted_at:       string | null
          draft_data:         Json
          created_by:         string | null
          created_at:         string
          updated_at:         string
        }
        Insert: Omit<
          Database['production']['Tables']['prod_sessions']['Row'],
          'id' | 'created_at' | 'updated_at'
        > & { id?: string }
        Update: Partial<Database['production']['Tables']['prod_sessions']['Insert']>
      }

      // ── bag_tags ────────────────────────────────────────────
      bag_tags: {
        Row: {
          serial_number:        string
          product_type:         string
          acumatica_id:         string | null
          variant:              Variant | null
          weight_kg:            number
          lot_number:           string | null
          section_id:           string
          session_id:           string | null
          status:               BagStatus
          location:             string | null
          location_updated_at:  string | null
          destination:          string | null
          qc_initials:          string | null
          qc_signed_at:         string | null
          printed_at:           string | null
          consumed:             boolean
          consumed_at:          string | null
          consumed_at_session:  string | null
          consumed_at_section:  string | null
          consumed_weight_kg:   number | null
          created_by:           string | null
          created_at:           string
        }
        Insert: Omit<Database['production']['Tables']['bag_tags']['Row'], 'created_at'>
        Update: Partial<Database['production']['Tables']['bag_tags']['Insert']>
      }

      // ── prod_debagging ──────────────────────────────────────
      prod_debagging: {
        Row: {
          id:               string
          session_id:       string
          bag_no:           number
          bag_serial_no:    string | null
          lot_number:       string | null
          product_type:     string | null
          acumatica_id:     string | null
          variant:          Variant | null
          kg_gross:         number | null
          kg_nett:          number
          delivery_date:    string | null
          local_or_export:  LocalExport | null
          org_or_conv:      OrgConv | null
          is_spillage:      boolean
          notes:            string | null
          created_at:       string
        }
        Insert: Omit<Database['production']['Tables']['prod_debagging']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['prod_debagging']['Insert']>
      }

      // ── prod_bagging ────────────────────────────────────────
      prod_bagging: {
        Row: {
          id:             string
          session_id:     string
          bag_no:         number
          output_group:   OutputGroup | null
          bag_serial_no:  string | null
          lot_number:     string | null
          product_type:   string | null
          acumatica_id:   string | null
          variant:        Variant | null
          kg:             number
          bagging_time:   string | null
          created_at:     string
        }
        Insert: Omit<Database['production']['Tables']['prod_bagging']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['prod_bagging']['Insert']>
      }

      // ── prod_mass_balance ───────────────────────────────────
      prod_mass_balance: {
        Row: {
          id:                   string
          session_id:           string
          total_input_kg:       number
          total_output_b_kg:    number
          total_output_c_kg:    number
          total_output_d_kg:    number
          balance_kg:           number    // computed: A - B - C - D
          tolerance_kg:         number
          water_kg:             number
          dust_extraction_kg:   number
          floor_waste_kg:       number
          calculated_at:        string
        }
        Insert: Omit<
          Database['production']['Tables']['prod_mass_balance']['Row'],
          'id' | 'balance_kg' | 'calculated_at'
        >
        Update: Partial<Database['production']['Tables']['prod_mass_balance']['Insert']>
      }

      // ── session_signatures ──────────────────────────────────
      session_signatures: {
        Row: {
          id:               string
          session_id:       string
          signer_role:      SignerRole
          signer_name:      string
          signer_user_id:   string | null
          signature_b64:    string
          signed_at:        string
        }
        Insert: Omit<Database['production']['Tables']['session_signatures']['Row'], 'id' | 'signed_at'>
        Update: never  // signatures are immutable once written
      }

      // ── scan_events ─────────────────────────────────────────
      scan_events: {
        Row: {
          id:             string
          serial_number:  string
          action:         ScanAction
          section_id:     string | null
          session_id:     string | null
          operator_id:    string | null
          weight_kg:      number | null
          notes:          string | null
          scanned_at:     string
        }
        Insert: Omit<Database['production']['Tables']['scan_events']['Row'], 'id' | 'scanned_at'>
        Update: never  // scan events are immutable
      }

      // ── shift_assignments ───────────────────────────────────
      shift_assignments: {
        Row: {
          id:                 string
          date:               string
          shift:              Shift
          section_id:         SectionId
          operator_ids:       string[]
          lot_number:         string | null
          variant:            Variant | null
          production_orders:  string[] | null
          notes:              string | null
          assigned_by:        string | null
          created_at:         string
          updated_at:         string
        }
        Insert: Omit<
          Database['production']['Tables']['shift_assignments']['Row'],
          'id' | 'created_at' | 'updated_at'
        > & { id?: string }
        Update: Partial<Database['production']['Tables']['shift_assignments']['Insert']>
      }

      // ── cleaning_stations (QR-tagged equipment/rooms) ───────
      cleaning_stations: {
        Row: {
          id: string; section_id: string; area: string; qr_code: string
          label: string; active: boolean; created_at: string
        }
        Insert: Omit<Database['production']['Tables']['cleaning_stations']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['production']['Tables']['cleaning_stations']['Insert']>
      }

      // ── cleaning_records (one cleaning event per section/shift) ─
      cleaning_records: {
        Row: {
          id: string; session_id: string | null; section_id: string; date: string
          shift: Shift; status: 'in_progress' | 'operator_signed' | 'supervisor_verified'
          operator_id: string | null; operator_name: string | null; operator_signed_at: string | null
          supervisor_name: string | null; supervisor_verified_at: string | null
          exceptions_count: number; created_at: string; updated_at: string
        }
        Insert: Omit<Database['production']['Tables']['cleaning_records']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Database['production']['Tables']['cleaning_records']['Insert']>
      }

      // ── cleaning_logs (immutable audit trail) ────────────────
      cleaning_logs: {
        Row: {
          id: string; record_id: string
          action: 'area_confirmed' | 'task_exception' | 'station_scan' | 'photo' | 'operator_sign' | 'supervisor_verify'
          area: string | null; task_key: string | null; detail: Json
          actor_id: string | null; actor_name: string | null; at: string
        }
        Insert: Omit<Database['production']['Tables']['cleaning_logs']['Row'], 'id' | 'at'> & { id?: string }
        Update: never  // append-only — immutable audit trail
      }

      // ── inventory_items (master Acumatica list) ──────────────
      inventory_items: {
        Row: {
          inventory_id: string; description: string | null; item_class: string | null
          category_code: string | null; product_group: string | null; grade: string | null
          qc_grade: string | null; variant: string | null; base_unit: string | null
          item_status: string | null; active: boolean; created_at: string
        }
        Insert: Omit<Database['production']['Tables']['inventory_items']['Row'], 'created_at'> & { created_at?: string }
        Update: Partial<Database['production']['Tables']['inventory_items']['Insert']>
      }

      // ── operators (PIN-verified floor operators) ─────────────
      operators: {
        Row: {
          id:            string
          name:          string
          display_name:  string | null
          operator_code: string | null
          role:          'floor_operator' | 'production_supervisor'
          section_ids:   string[]
          pin:           string
          active:        boolean
          user_id:       string | null
          auth_email:    string | null
          created_at:    string
        }
        Insert: Omit<Database['production']['Tables']['operators']['Row'], 'id' | 'created_at'> & { id?: string }
        Update: Partial<Database['production']['Tables']['operators']['Insert']>
      }

      // ── Stock count (unchanged) ─────────────────────────────
      sc_sessions: {
        Row: {
          id:                 string
          count_date:         string
          warehouse_id:       string
          sup_confirmed_at:   string | null
          sup_name:           string | null
          sup_total_kg:       number | null
          sup_total_bags:     number | null
          sup_notes:          string | null
          adm_confirmed_at:   string | null
          adm_name:           string | null
          adm_total_kg:       number | null
          adm_total_bags:     number | null
          adm_notes:          string | null
          match_rate_pct:     number | null
          created_at:         string
        }
        Insert: Omit<Database['production']['Tables']['sc_sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['sc_sessions']['Insert']>
      }
      sc_entries: {
        Row: {
          id:             string
          session_id:     string
          warehouse_id:   string
          role:           'admin' | 'supervisor'
          inventory_id:   string
          inventory_code: string
          item_name:      string
          section_id:     string
          section_name:   string
          entry_type:     'bag' | 'pallet' | 'no_stock'
          is_no_stock:    boolean
          batch_number:   string | null
          kg:             number
          entry_index:    number
          boxes:          number
          bags_qty:       number
          paper_bags:     number
          pallet_index:   number
          created_at:     string
        }
        Insert: Omit<Database['production']['Tables']['sc_entries']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['sc_entries']['Insert']>
      }
      app_roles: {
        Row: {
          id:         string
          user_id:    string
          role:       'admin' | 'supervisor' | 'management' | 'operator'
          created_at: string
        }
        Insert: Omit<Database['production']['Tables']['app_roles']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['production']['Tables']['app_roles']['Insert']>
      }
      dev_reports: {
        Row: {
          id:                 string
          week_start:         string
          phase_focus:        string
          work_completed:     string
          next_steps:         string | null
          blockers:           string | null
          management_notes:   string | null
          created_by:         string
          created_at:         string
          updated_at:         string
        }
        Insert: Omit<Database['production']['Tables']['dev_reports']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['production']['Tables']['dev_reports']['Insert']>
      }
    }

    Views: {
      v_discrepancy_trends: {
        Row: {
          count_date:       string
          section_id:       string
          item_name:        string
          sup_kg:           number
          adm_kg:           number
          abs_variance_kg:  number
        }
      }
    }
  }
}

// ── Convenience row types ─────────────────────────────────────
export type ProdSession       = Database['production']['Tables']['prod_sessions']['Row']
export type ProdDebagging     = Database['production']['Tables']['prod_debagging']['Row']
export type ProdBagging       = Database['production']['Tables']['prod_bagging']['Row']
export type ProdMassBalance   = Database['production']['Tables']['prod_mass_balance']['Row']
export type BagTag            = Database['production']['Tables']['bag_tags']['Row']
export type SessionSignature  = Database['production']['Tables']['session_signatures']['Row']
export type ScanEvent         = Database['production']['Tables']['scan_events']['Row']
export type ScSession         = Database['production']['Tables']['sc_sessions']['Row']
export type ScEntry           = Database['production']['Tables']['sc_entries']['Row']
export type AppRole           = Database['production']['Tables']['app_roles']['Row']
export type DevReport         = Database['production']['Tables']['dev_reports']['Row']
export type ShiftAssignment   = Database['production']['Tables']['shift_assignments']['Row']
export type Operator          = Database['production']['Tables']['operators']['Row']
export type CleaningStation   = Database['production']['Tables']['cleaning_stations']['Row']
export type CleaningRecord    = Database['production']['Tables']['cleaning_records']['Row']
export type CleaningLog       = Database['production']['Tables']['cleaning_logs']['Row']
export type InventoryItem     = Database['production']['Tables']['inventory_items']['Row']
export type UserRole          = 'admin' | 'supervisor' | 'management' | 'operator'
