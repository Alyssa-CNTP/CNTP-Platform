/**
 * One-off repair: rebuild production.prod_debagging from prod_sessions.draft_data.
 *
 * Why this is needed
 * ------------------
 * persist() in app/(app)/production/capture/[section]/page.tsx wrote the input
 * rows as one multi-row insert whose result was never checked, so any single
 * unacceptable value dropped every input row for that session while draft_data
 * and the mass balance (computed from draft_data, not from these rows) saved
 * normally. The production order then read "No inputs recorded" under a correct
 * total. Three causes were found in live data:
 *
 *   22008  a DD-MM-YY delivery date into a `date` column   (Refining)
 *   23503  bag_serial_no not present in bag_tags           (Blender)
 *   PGRST204  batch_id sent before the column existed      (all sections,
 *             for the window between the batch-spine code and its migration)
 *
 * The capture fix stops all three going forward, but records already saved have
 * no rows to show. draft_data still holds every input, so they can be rebuilt.
 *
 * Usage (dry run first — prints what it WOULD write, touches nothing):
 *   node scripts/backfill-debag-rows.cjs
 *   node scripts/backfill-debag-rows.cjs --apply
 *
 * Only sessions with ZERO existing prod_debagging rows are touched, so this is
 * safe to re-run and can never overwrite rows a real save produced. Point it at
 * another database by exporting NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * before running (it defaults to whatever .env.local holds — staging).
 *
 * The row-building below deliberately mirrors buildDebag() in the capture page.
 * If a section's capture shape changes, that function is the source of truth.
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));

const APPLY = process.argv.includes('--apply');

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)(?:\s*#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase env vars');

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'production' },
});

// ── Helpers mirroring the capture page ───────────────────────────────────────
const n = v => parseFloat(String(v == null ? '' : v).replace(',', '.')) || 0;
const upperCode = v => (v == null ? null : (String(v).trim() ? String(v).trim().toUpperCase() : null));

/** Same rules as lib/production/db-date.ts — keep the two in step. */
function dbDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const isoOf = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return isoOf(+m1[1], +m1[2], +m1[3]);
  const m2 = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m2) { const y = +m2[3]; return isoOf(y < 100 ? 2000 + y : y, +m2[2], +m2[1]); }
  return null;
}

const DUST_PRODUCT_TYPE = {
  brown: 'Brown Dust', white: 'White Dust', indent: 'Indent Dust', leaf: 'Leaf Dust',
  alt: 'ALT Dust', sg: 'SG Dust', extraction: 'Dust Extraction', other: 'Other',
};
const dustProductType = k => DUST_PRODUCT_TYPE[k] || k;
const isBlender     = id => id === 'blender' || id === 'smallblender';
const isPasteuriser = id => id === 'pasteuriser';

/** Mirror of buildDebag() in app/(app)/production/capture/[section]/page.tsx. */
function buildDebag(sectionId, prods, sid) {
  const rows = [];
  let bagNo = 1;
  for (const prod of prods || []) {
    const data = prod.data || {};
    if (sectionId.startsWith('refining')) {
      for (const r of data.inputs || []) {
        if (n(r.weight) === 0) continue;
        rows.push({
          session_id: sid, bag_no: bagNo++,
          bag_serial_no: r.inputMode !== 'manual' ? (r.serial || null) : null,
          notes: r.inputMode === 'manual' ? (r.serial || null) : null,
          lot_number: r.lot || prod.lot || null,
          product_type: r.productType || null, variant: r.variant || prod.variant || null,
          kg_nett: n(r.weight),
          delivery_date: r.deliveryDate || null, is_spillage: false,
        });
      }
    } else if (sectionId === 'granule') {
      for (const bl of data.blends || []) {
        for (const r of bl.rows || []) {
          if (n(r.weight) === 0) continue;
          rows.push({
            session_id: sid, bag_no: bagNo++,
            bag_serial_no: r.inputMode !== 'manual' ? (r.serial || null) : null,
            notes: [`blend ${bl.blendNo}`, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
            lot_number: r.lot || prod.lot || null,
            product_type: dustProductType(r.dustKey), variant: r.variant || prod.variant || null,
            kg_nett: n(r.weight), is_spillage: false,
          });
        }
      }
    } else if (isBlender(sectionId)) {
      for (const r of data.inputs || []) {
        if (n(r.weight) === 0) continue;
        rows.push({
          session_id: sid, bag_no: bagNo++,
          bag_serial_no: r.inputMode !== 'manual' ? (r.serial || null) : null,
          grade: r.destination || null,
          notes: r.inputMode === 'manual' ? (r.serial || null) : null,
          lot_number: r.lot || prod.lot || null,
          product_type: r.productType || null, variant: r.variant || prod.variant || null,
          kg_nett: n(r.weight), is_spillage: false,
        });
      }
    } else if (isPasteuriser(sectionId)) {
      for (const r of data.debag || []) {
        if (n(r.weight) === 0) continue;
        rows.push({
          session_id: sid, bag_no: bagNo++,
          bag_serial_no: r.inputMode !== 'manual' ? (r.serial || null) : null,
          notes: [r.stream === 'postsieve' ? 'post-sieve' : null, r.inputMode === 'manual' ? r.serial : null].filter(Boolean).join(' · ') || null,
          lot_number: r.lot || data.batchNo || prod.lot || null,
          product_type: r.productType || null, variant: r.variant || prod.variant || null,
          kg_nett: n(r.weight), is_spillage: false,
        });
      }
    } else {
      for (const [idx, r] of (data.spillage || []).entries()) {
        if (n(r.kg) === 0) continue;
        rows.push({
          session_id: sid, bag_no: bagNo++,
          product_type: idx === 0 ? 'Bucket Elevator' : 'Machine Spillage',
          variant: prod.variant || null, kg_nett: n(r.kg), is_spillage: true,
        });
      }
      for (const r of data.debag || []) {
        if (n(r.nett) === 0) continue;
        rows.push({
          session_id: sid, bag_no: bagNo++,
          bag_serial_no: null, notes: r.bag_no || null,
          lot_number: r.lot || prod.lot || null,
          product_type: '500kg Farm Bag', variant: prod.variant || null,
          kg_gross: n(r.gross) || null, kg_nett: n(r.nett),
          delivery_date: r.delivery_date || null, grade: r.local_export || null,
          is_spillage: false,
        });
      }
    }
  }
  for (const r of rows) {
    r.lot_number = upperCode(r.lot_number);
    r.delivery_date = dbDate(r.delivery_date);
  }
  return rows;
}

// ── Run ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`DB: ${SUPABASE_URL}`);
  console.log(APPLY ? 'MODE: apply (writing rows)\n' : 'MODE: dry run (no writes — pass --apply to write)\n');

  const { data: sessions, error: sErr } = await db
    .from('prod_sessions').select('id,section_id,date,shift,status,record_no,draft_data')
    .order('date', { ascending: true });
  if (sErr) throw sErr;

  const { data: existing, error: eErr } = await db.from('prod_debagging').select('session_id');
  if (eErr) throw eErr;
  const hasRows = new Set((existing || []).map(r => r.session_id));

  // Every serial that actually exists in bag_tags — anything else can't go in
  // the FK column (that's cause #2 above) and is kept in notes instead.
  const { data: tags, error: tErr } = await db.from('bag_tags').select('serial_number');
  if (tErr) throw tErr;
  const tagged = new Set((tags || []).map(t => t.serial_number));

  let repaired = 0, rowsWritten = 0, skippedHasRows = 0, noInputs = 0, failed = 0;
  const bySection = {};

  for (const s of sessions || []) {
    const prods = (s.draft_data && s.draft_data.productions) || [];
    const rows = buildDebag(s.section_id, prods, s.id);
    if (!rows.length) { noInputs++; continue; }
    if (hasRows.has(s.id)) { skippedHasRows++; continue; }

    for (const r of rows) {
      if (r.bag_serial_no && !tagged.has(r.bag_serial_no)) {
        r.notes = [r.notes, r.bag_serial_no].filter(Boolean).join(' · ') || null;
        r.bag_serial_no = null;
      }
    }

    const kg = rows.reduce((t, r) => t + (r.kg_nett || 0), 0);
    console.log(`  ${s.date} ${String(s.section_id).padEnd(12)} ${String(s.shift).padEnd(10)} ${String(s.record_no || '—').padEnd(14)} ${String(rows.length).padStart(3)} rows  ${kg.toFixed(1)} kg`);

    bySection[s.section_id] = (bySection[s.section_id] || 0) + rows.length;
    if (APPLY) {
      const { error } = await db.from('prod_debagging').insert(rows);
      if (error) { failed++; console.log(`      FAILED: ${error.code} ${error.message}`); continue; }
    }
    repaired++; rowsWritten += rows.length;
  }

  console.log('\n── Summary ──');
  console.log(`  sessions repaired      : ${repaired}`);
  console.log(`  input rows ${APPLY ? 'written    ' : 'to write   '}: ${rowsWritten}`);
  console.log(`  rows by section        : ${JSON.stringify(bySection)}`);
  console.log(`  skipped (already have) : ${skippedHasRows}`);
  console.log(`  skipped (no inputs)    : ${noInputs}`);
  if (failed) console.log(`  FAILED                 : ${failed}`);
  if (!APPLY) console.log('\nNothing was written. Re-run with --apply once the list above looks right.');
})().catch(e => { console.error(e); process.exit(1); });
