'use client'

/**
 * ADMIN — Inventory Import
 * ─────────────────────────────────────────────────────────────────────────────
 * Lets an admin upload the two Acumatica Excel exports and sync them into
 * production.inventory_items. Safe to re-run — uses upsert on inventory_id.
 *
 * HOW IT WORKS
 * 1. Admin drops the Stock_Item.xlsx file here.
 * 2. The page parses it client-side with the `xlsx` library (already in deps).
 * 3. It normalises each row into { inventory_id, description, item_class }.
 * 4. Calls Supabase upsert — existing rows update, new rows insert.
 * 5. Shows a result summary.
 */

import { useState, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import { useAuth } from '@/lib/auth/context'
import * as XLSX from 'xlsx'
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

// ── TYPES ──────────────────────────────────────────────────────────────────────
interface ParsedItem {
  inventory_id:  string
  description:   string
  item_class:    string
  item_class_id: string
  uom:           string
}

interface ImportResult {
  inserted: number
  updated:  number
  skipped:  number
  errors:   string[]
}

// ── HELPERS ────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw Excel row from the Stock_Item export.
 * Acumatica exports vary — we try multiple column name spellings.
 */
function normaliseRow(row: Record<string, unknown>): ParsedItem | null {
  // Column-name spellings seen in Acumatica exports
  const id = (
    row['Inventory ID'] ?? row['InventoryID'] ?? row['inventory_id'] ?? row['Item ID'] ?? ''
  ) as string

  const desc = (
    row['Description'] ?? row['Item Description'] ?? row['description'] ?? ''
  ) as string

  const cls = (
    row['Item Class'] ?? row['ItemClass'] ?? row['Class'] ?? ''
  ) as string

  const clsId = (
    row['Item Class ID'] ?? row['ItemClassID'] ?? row['Class ID'] ?? cls
  ) as string

  const uom = (
    row['Base Unit'] ?? row['UOM'] ?? row['Base UOM'] ?? 'KG'
  ) as string

  const trimId = String(id).trim().toUpperCase()
  if (!trimId || !desc) return null

  return {
    inventory_id:  trimId,
    description:   String(desc).trim(),
    item_class:    String(cls).trim(),
    item_class_id: String(clsId).trim(),
    uom:           String(uom).trim() || 'KG',
  }
}

/** Parse an XLSX file buffer into an array of row objects */
function parseExcel(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  // Use the first sheet
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { defval: '' })
}

// ── COMPONENT ──────────────────────────────────────────────────────────────────

export default function InventoryImportPage() {
  const { role } = useAuth()
  const db = getDb()

  const [dragging,  setDragging]  = useState(false)
  const [fileName,  setFileName]  = useState<string | null>(null)
  const [preview,   setPreview]   = useState<ParsedItem[]>([])
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState<ImportResult | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  // ── Block non-admins ──────────────────────────────────────────────────────
  if (role !== 'admin') {
    return (
      <div className="p-8 text-center text-text-muted">
        <AlertCircle size={32} className="mx-auto mb-3 text-status-warn" />
        <p className="font-display font-bold text-lg text-text">Admin access required</p>
        <p className="text-sm mt-1">Only admins can manage the inventory master list.</p>
      </div>
    )
  }

  // ── File processing ───────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('Please upload an Excel file (.xlsx or .xls)')
      return
    }
    setError(null)
    setResult(null)
    setFileName(file.name)

    const buffer = await file.arrayBuffer()
    const rows   = parseExcel(buffer)
    const items  = rows.map(normaliseRow).filter(Boolean) as ParsedItem[]

    setPreview(items)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Import to Supabase ────────────────────────────────────────────────────
  async function runImport() {
    if (!preview.length) return
    setImporting(true)
    setError(null)

    const CHUNK = 200  // upsert in batches to stay under request size limits
    let inserted = 0, updated = 0, skipped = 0
    const errors: string[] = []

    for (let i = 0; i < preview.length; i += CHUNK) {
      const chunk = preview.slice(i, i + CHUNK).map(item => ({
        ...item,
        active:     true,
        updated_at: new Date().toISOString(),
      }))

      const { error: err, data } = await db
        .from('inventory_items')
        .upsert(chunk, { onConflict: 'inventory_id', ignoreDuplicates: false })
        .select('id')

      if (err) {
        errors.push(`Batch ${Math.floor(i / CHUNK) + 1}: ${err.message}`)
        skipped += chunk.length
      } else {
        // Supabase upsert doesn't distinguish insert vs update clearly,
        // so we count all successful rows as upserted
        inserted += data?.length ?? chunk.length
      }
    }

    setResult({ inserted, updated, skipped, errors })
    setImporting(false)
  }

  const pct = preview.length > 0
    ? Math.min(100, Math.round((preview.length / 500) * 100))
    : 0

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="font-display font-extrabold text-2xl text-text">Inventory import</h1>
        <p className="text-sm text-text-muted mt-1">
          Upload <code className="font-mono text-[12px] bg-surface-rule px-1.5 py-0.5 rounded">Stock_Item.xlsx</code> from
          Acumatica to sync the inventory master list. Safe to re-run — existing items update, new ones are added.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          'relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer',
          dragging
            ? 'border-accent bg-ok-bg'
            : 'border-surface-rule hover:border-accent/50 hover:bg-surface'
        )}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={onFileInput}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <FileSpreadsheet
          size={36}
          className={clsx('mx-auto mb-3', dragging ? 'text-accent' : 'text-text-muted')}
        />
        {fileName ? (
          <>
            <p className="font-display font-bold text-base text-text">{fileName}</p>
            <p className="text-sm text-text-muted mt-1">{preview.length} items parsed</p>
          </>
        ) : (
          <>
            <p className="font-display font-bold text-base text-text">Drop Stock_Item.xlsx here</p>
            <p className="text-sm text-text-muted mt-1">or click to browse</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-3 bg-err-bg border border-err/30 rounded-xl text-err text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && !result && (
        <div className="card overflow-hidden">
          <div className="card-head">
            <span className="card-title text-base">Preview — {preview.length} items</span>
            <span className="font-mono text-[10px] text-text-muted uppercase tracking-wide">
              First 10 rows shown
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th>Inventory ID</th>
                  <th>Description</th>
                  <th>Item Class</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 10).map((item, i) => (
                  <tr key={i}>
                    <td className="font-mono text-[12px] font-bold">{item.inventory_id}</td>
                    <td>{item.description}</td>
                    <td className="font-mono text-[11px]">{item.item_class}</td>
                    <td className="font-mono text-[11px]">{item.uom}</td>
                  </tr>
                ))}
                {preview.length > 10 && (
                  <tr>
                    <td colSpan={4} className="text-center text-text-muted py-2 text-xs">
                      …and {preview.length - 10} more items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button */}
      {preview.length > 0 && !result && (
        <button
          onClick={runImport}
          disabled={importing}
          className={clsx(
            'flex items-center gap-2 w-full py-3.5 rounded-xl font-display font-bold text-base transition-all',
            importing
              ? 'bg-surface-rule text-text-muted cursor-not-allowed'
              : 'bg-brand text-white hover:opacity-90'
          )}
        >
          {importing ? (
            <><RefreshCw size={18} className="animate-spin" /> Importing {preview.length} items…</>
          ) : (
            <><Upload size={18} /> Import {preview.length} items to Supabase</>
          )}
        </button>
      )}

      {/* Result */}
      {result && (
        <div className={clsx(
          'p-5 rounded-2xl border',
          result.errors.length === 0
            ? 'bg-ok-bg border-ok/30'
            : 'bg-warn-bg border-warn/30'
        )}>
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle size={20} className={result.errors.length ? 'text-status-warn' : 'text-status-ok'} />
            <span className="font-display font-bold text-lg text-text">
              Import {result.errors.length ? 'completed with warnings' : 'successful'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Upserted', value: result.inserted, color: 'text-status-ok' },
              { label: 'Skipped', value: result.skipped, color: 'text-status-warn' },
              { label: 'Errors', value: result.errors.length, color: 'text-status-error' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={clsx('font-display font-extrabold text-2xl', s.color)}>{s.value}</div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div className="space-y-1">
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-status-error font-mono">{e}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => { setPreview([]); setFileName(null); setResult(null) }}
            className="mt-3 text-sm text-text-muted underline hover:text-text"
          >
            Import another file
          </button>
        </div>
      )}

      {/* Instructions */}
      <div className="card p-5 text-sm space-y-2 text-text-muted">
        <p className="font-display font-bold text-base text-text">How to export from Acumatica</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Go to <strong>Inventory → Stock Items</strong></li>
          <li>Use the filter to show all active items</li>
          <li>Click the <strong>Export to Excel</strong> button (top toolbar)</li>
          <li>Upload the downloaded file here</li>
        </ol>
        <p className="text-xs text-text-faint mt-3">
          Required columns: <code className="font-mono">Inventory ID</code>, <code className="font-mono">Description</code>.
          Optional: <code className="font-mono">Item Class</code>, <code className="font-mono">Base Unit</code>.
          Column names are flexible — common Acumatica variants are handled automatically.
        </p>
      </div>
    </div>
  )
}
