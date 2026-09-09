'use client'

/**
 * Reading the sales account book.
 *
 * Read-only against Acumatica by design: this module never writes to the ERP
 * and never will. `acumatica.sales_orders` is a mirror the sync fills; the
 * only thing written here is which account a rep owns and which Acumatica
 * customer an account is, both of which are ours.
 *
 * Cross-schema on purpose — an account is assembled from four places that no
 * single view joins today:
 *
 *   sales.customers        who owns the account, and its Acumatica id
 *   acumatica.sales_orders the order book
 *   public.label_templates the finished-product labels
 *   qms.customer_specs     the quality limits
 */

import { getDb } from '@/lib/supabase/db'
import type { OrderLine, SalesAccount } from '@/lib/core/sales/accounts'

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A row of sales.customers, with the rep's name resolved.
 *
 * `acumatica_customer_id` is selected SEPARATELY and best-effort. It arrives in
 * 20260909_001, and PostgREST 400s the whole query for one unknown column — so
 * selecting it inline would blank this page on any database the migration has
 * not reached yet, including production before promotion. Degrading to "no
 * account is linked" is the same shape the Production Orders list already uses
 * for its record-management columns.
 */
export async function fetchAccounts(): Promise<SalesAccount[]> {
  const { data, error } = await getDb()
    .schema('sales' as never)
    .from('customers')
    .select('name, sales_rep_employee_id')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)

  const acuById = new Map<string, string | null>()
  const linked = await getDb()
    .schema('sales' as never)
    .from('customers')
    .select('name, acumatica_customer_id')
  if (!linked.error) {
    for (const r of (linked.data ?? []) as { name: string | null; acumatica_customer_id: string | null }[]) {
      if (r.name) acuById.set(r.name, r.acumatica_customer_id)
    }
  }

  const rows = ((data ?? []) as { name: string | null; sales_rep_employee_id: string | null }[])
    .map(r => ({ ...r, acumatica_customer_id: r.name ? acuById.get(r.name) ?? null : null }))

  const ids = [...new Set(rows.map(r => r.sales_rep_employee_id).filter(Boolean) as string[])]
  const names = await fetchEmployeeNames(ids)

  return rows.filter(r => !!r.name).map(r => ({
    name: r.name as string,
    salesRepEmployeeId: r.sales_rep_employee_id,
    salesRepName: r.sales_rep_employee_id ? names.get(r.sales_rep_employee_id) ?? null : null,
    acumaticaCustomerId: r.acumatica_customer_id,
  }))
}

async function fetchEmployeeNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data } = await getDb()
    .schema('production' as never)
    .from('employees')
    .select('id, name, display_name')
    .in('id', ids as string[])
  const out = new Map<string, string>()
  for (const e of (data ?? []) as { id: string; name: string | null; display_name: string | null }[]) {
    out.set(e.id, e.display_name || e.name || 'Unknown')
  }
  return out
}

const ORDER_COLS =
  'order_type, order_nbr, line_nbr, status, customer_id, customer_name, customer_order, ' +
  'inventory_id, line_desc, order_qty, uom, requested_on, order_date'

/** Every synced order line. The whole table is ~150 rows, so the list page
 *  summarises it client-side rather than issuing one query per account. */
export async function fetchAllOrderLines(): Promise<OrderLine[]> {
  const { data, error } = await getDb()
    .schema('acumatica' as never)
    .from('sales_orders')
    .select(ORDER_COLS)
    .limit(5000)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as OrderLine[]
}

/** One account's order lines, newest order first. */
export async function fetchOrderLinesFor(acumaticaCustomerId: string): Promise<OrderLine[]> {
  const { data, error } = await getDb()
    .schema('acumatica' as never)
    .from('sales_orders')
    .select(ORDER_COLS)
    .eq('customer_id', acumaticaCustomerId)
    .order('order_nbr', { ascending: false })
    .order('line_nbr')
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as OrderLine[]
}

// ── Who can be given an account ──────────────────────────────────────────────

export interface SalesPerson {
  employeeId: string | null   // null = has a login but no Staff Directory link
  name: string
  role: string | null
}

/**
 * People in the SALES department, from shared.app_roles — the app's own idea of
 * a department, not production.employees.department, which holds factory
 * departments (production, qc, store, cleaning …) and has no sales value at
 * all.
 *
 * Someone with no `employee_id` is returned anyway, with a null id. They cannot
 * hold an account — sales.customers.sales_rep_employee_id points at
 * production.employees — but omitting them makes a real, fixable situation
 * invisible: the person is in Sales, they just have no Staff Directory link
 * yet. The picker shows them greyed with the reason.
 */
export async function fetchSalesPeople(): Promise<SalesPerson[]> {
  const { data, error } = await getDb()
    .schema('shared' as never)
    .from('app_roles')
    .select('full_name, role, employee_id, department')
    .eq('department', 'Sales')
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as {
    full_name: string | null; role: string | null; employee_id: string | null
  }[]
  const ids = rows.map(r => r.employee_id).filter(Boolean) as string[]
  const names = await fetchEmployeeNames(ids)

  return rows
    .map(r => ({
      employeeId: r.employee_id,
      name: (r.employee_id ? names.get(r.employee_id) : null) || r.full_name || 'Unknown',
      role: r.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Give an account to a rep, or take it back with null. Upserts on the name so
 *  a customer the master has not caught up with can still be assigned. */
export async function setAccountRep(customerName: string, employeeId: string | null): Promise<void> {
  const name = customerName.trim()
  if (!name) throw new Error('A customer name is required.')
  const { error } = await getDb()
    .schema('sales' as never)
    .from('customers')
    .upsert({ name, sales_rep_employee_id: employeeId, updated_at: new Date().toISOString() },
      { onConflict: 'name' })
  if (error) throw new Error(error.message)
}

/** Link an account to its Acumatica customer, or clear the link. */
export async function setAcumaticaCustomerId(customerName: string, id: string | null): Promise<void> {
  const name = customerName.trim()
  if (!name) throw new Error('A customer name is required.')
  const { error } = await getDb()
    .schema('sales' as never)
    .from('customers')
    .upsert({ name, acumatica_customer_id: id?.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'name' })
  // PGRST204 is "column not found" — the migration has not been applied here.
  // Say that, rather than surfacing PostgREST's wording to a salesperson.
  if (error) {
    throw new Error(/acumatica_customer_id/.test(error.message)
      ? 'The Acumatica link column is not in this database yet — migration 20260909_001 has not been run.'
      : error.message)
  }
}

/** Acumatica customers seen in the order book, for the link picker. Built from
 *  the orders themselves, so it can only ever offer a real customer. */
export function acumaticaCustomerOptions(
  lines: readonly OrderLine[],
): { id: string; name: string; lines: number }[] {
  const m = new Map<string, { id: string; name: string; lines: number }>()
  for (const l of lines) {
    const id = (l.customer_id ?? '').trim()
    if (!id) continue
    const cur = m.get(id)
    if (cur) { cur.lines++; if (!cur.name && l.customer_name) cur.name = l.customer_name }
    else m.set(id, { id, name: l.customer_name ?? id, lines: 1 })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ── The rest of an account ───────────────────────────────────────────────────

export interface AccountLabel {
  id: string; code: string; name: string; version: number; status: string
}

export async function fetchAccountLabels(customerName: string): Promise<AccountLabel[]> {
  const { data, error } = await getDb()
    .schema('public')
    .from('label_templates')
    .select('id, code, name, version, status, customer')
    .ilike('customer', customerName)
    .order('code').order('version', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as AccountLabel[]
}

export interface AccountSpec {
  id: string | number; product: string | null; doc_no: string | null; revision: string | null
}

export async function fetchAccountSpecs(customerName: string): Promise<AccountSpec[]> {
  const { data, error } = await getDb()
    .schema('qms' as never)
    .from('customer_specs')
    .select('id, product, doc_no, revision, customer')
    .ilike('customer', customerName)
    .limit(100)
  if (error) return []          // specs are context, never a reason to fail the page
  return (data ?? []) as AccountSpec[]
}
