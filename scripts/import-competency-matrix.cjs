/**
 * One-off import: reads employees.xlsx + sop-matrix.xlsx
 * and upserts employees, SOPs, and competency records into staging DB.
 *
 * Place source files at:
 *   scripts/data/employees.xlsx   (Copy of CNTP Employees.xlsx)
 *   scripts/data/sop-matrix.xlsx  (SOP_Matrix_Final.xlsx)
 *
 * Run: node scripts/import-competency-matrix.cjs
 */

'use strict';
const fs      = require('fs');
const path    = require('path');
const ExcelJS = require(path.join(__dirname, '..', 'node_modules', 'exceljs'));
const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js'));

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)(?:\s*#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase env vars');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = () => supabase.schema('production');

const DATA_DIR = path.join(__dirname, 'data');
const EMP_FILE = path.join(DATA_DIR, 'employees.xlsx');
const MAT_FILE = path.join(DATA_DIR, 'sop-matrix.xlsx');

for (const f of [EMP_FILE, MAT_FILE]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing: ${f}`);
    console.error('Copy the spreadsheets to scripts/data/ as employees.xlsx and sop-matrix.xlsx');
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function norm(s) {
  return (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}
function cellVal(c) {
  if (!c || c.value === null || c.value === undefined) return null;
  if (typeof c.value === 'object' && 'result' in c.value) return c.value.result;
  if (typeof c.value === 'object' && 'formula' in c.value) return null;
  if (c.value instanceof Date) return c.value;
  return c.value;
}
function cellStr(c) {
  const v = cellVal(c);
  return v !== null && v !== undefined ? String(v).trim() : null;
}

const RAW_CODE_MAP = {
  ct: 'competent', comp: 'competent', competent: 'competent',
  nc: 'not_competent',
  tba: 'tba',
  'not trained': 'not_started',
};
function rawToStatus(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().trim();
  if (k in RAW_CODE_MAP) return RAW_CODE_MAP[k];
  const n = parseFloat(k);
  if (!isNaN(n) && n >= 0.75) return 'assessed';
  if (!isNaN(n) && n > 0) return 'training_done';
  return null;
}

const DEPT_MAP = {
  PRD: 'production', PRG: 'production', PRS: 'production', GENWRK: 'production',
  QUA: 'qc', LAB: 'laboratory', STR: 'stores', MAIN: 'maintenance',
  HYG: 'hygiene', ADM: 'admin',
};
function deptEnum(code) {
  if (!code) return 'production';
  return DEPT_MAP[code.toUpperCase()] || 'production';
}

// ── Read employee name list ──────────────────────────────────────────────────
async function readEmployeeNames() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EMP_FILE);
  const ws = wb.getWorksheet(1);
  const names = [];
  ws.eachRow((row, ri) => {
    if (ri === 1) return;
    const v = cellStr(row.getCell(1));
    if (v) names.push(v);
  });
  return names;
}

// ── Read Training Information sheet ─────────────────────────────────────────
async function readTrainingInfo() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MAT_FILE);
  const ws = wb.getWorksheet('Training Information');
  if (!ws) throw new Error('Sheet "Training Information" not found');

  // Find Competence Level columns in row 11
  const compLevelCols = [];
  ws.getRow(11).eachCell({ includeEmpty: true }, (c, i) => {
    if (String(c.value || '').toLowerCase().includes('competence level')) compLevelCols.push(i);
  });

  // Find SOP start columns in row 9
  const sopStarts = new Map();
  let lastRaw = null;
  ws.getRow(9).eachCell({ includeEmpty: true }, (c, i) => {
    const v = c.value ? String(c.value).trim() : null;
    if (v && v !== lastRaw) {
      const m = String(v).match(/([A-Z]{2,6}(?:-[A-Z]{2,6})*-\d{2,4})/i);
      if (m) sopStarts.set(i, m[1].toUpperCase().trim());
      lastRaw = v;
    }
  });

  // Map each Competence Level column to its doc_no
  const clToDocNo = new Map();
  const sopStartEntries = [...sopStarts.entries()].sort((a, b) => a[0] - b[0]);
  for (const cl of compLevelCols) {
    let best = null;
    for (const [sc, dn] of sopStartEntries) {
      if (sc <= cl) best = dn;
      else break;
    }
    if (best) clToDocNo.set(cl, best);
  }

  const uniqueDocNos = [...new Set(clToDocNo.values())];

  // Read employee rows
  const matrixPeople = [];
  ws.eachRow((row, ri) => {
    if (ri < 12) return;
    const firstName = cellStr(row.getCell(2));
    const surname   = cellStr(row.getCell(3));
    if (!firstName || !surname) return;

    const position = cellStr(row.getCell(4));
    const deptRaw  = cellStr(row.getCell(5));
    const yos      = cellVal(row.getCell(6));

    let positionCode = null, positionTitle = null;
    if (position) {
      const pm = position.match(/^([A-Z]+)\s*-\s*(.+)$/);
      if (pm) { positionCode = pm[1]; positionTitle = pm[2].trim(); }
      else positionTitle = position;
    }
    let deptCode = null;
    if (deptRaw) { const dm = deptRaw.match(/^([A-Z]+)\s*[-–]/); if (dm) deptCode = dm[1]; }

    const fullName = `${firstName.trim()} ${surname.trim()}`.replace(/\s+/g, ' ');
    const competencies = {};

    for (const [cl, docNo] of clToDocNo.entries()) {
      const rawCode = cellStr(row.getCell(cl));
      const status = rawToStatus(rawCode);
      if (!status || status === 'not_started') continue;

      const scoreRaw = cellVal(row.getCell(cl - 1));
      const dateRaw  = cellVal(row.getCell(cl - 2));
      const trainStr = cellStr(row.getCell(cl - 3));

      let dateCompleted = null;
      if (dateRaw instanceof Date && !isNaN(dateRaw)) {
        dateCompleted = dateRaw.toISOString().slice(0, 10);
      } else if (typeof dateRaw === 'string' && dateRaw !== '-') {
        const parsed = new Date(dateRaw);
        if (!isNaN(parsed)) dateCompleted = parsed.toISOString().slice(0, 10);
      }

      competencies[docNo] = {
        status,
        raw_code: rawCode,
        score: typeof scoreRaw === 'number' ? Math.min(1, Math.max(0, scoreRaw)) : null,
        training_completed: trainStr && trainStr.toLowerCase() === 'yes' ? true
          : trainStr && trainStr.toLowerCase() === 'no' ? false : null,
        date_completed: dateCompleted,
      };
    }

    matrixPeople.push({ fullName, positionCode, positionTitle, deptCode, yos, competencies });
  });

  return { matrixPeople, uniqueDocNos };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══ CNTP Competency Matrix Import ═══\n');

  console.log('Reading spreadsheets…');
  const [empNames, { matrixPeople, uniqueDocNos }] = await Promise.all([
    readEmployeeNames(),
    readTrainingInfo(),
  ]);
  console.log(`  → ${empNames.length} names in employee list`);
  console.log(`  → ${matrixPeople.length} people in training matrix`);
  console.log(`  → ${uniqueDocNos.length} unique SOPs in matrix`);

  // Load existing employees
  const { data: existingEmps, error: empErr } = await db().from('employees').select('id,name,employee_code');
  if (empErr) throw empErr;
  console.log(`\nExisting employees in DB: ${existingEmps.length}`);

  const empByNorm = new Map(existingEmps.map(e => [norm(e.name), e.id]));

  // Upsert 382 names
  let empInserted = 0, empAlreadyExists = 0;
  for (const fullName of empNames) {
    const key = norm(fullName);
    if (empByNorm.has(key)) { empAlreadyExists++; continue; }
    const { data: ins, error: iErr } = await db()
      .from('employees')
      .insert({ name: fullName, department: 'production', active: true })
      .select('id').single();
    if (iErr) { console.warn(`  WARN insert "${fullName}": ${iErr.message}`); continue; }
    empByNorm.set(key, ins.id);
    empInserted++;
  }
  console.log(`Employee list: ${empInserted} inserted, ${empAlreadyExists} already existed.`);

  // Enrich from matrix data
  let enriched = 0, matrixNoMatch = 0;
  for (const mp of matrixPeople) {
    const id = empByNorm.get(norm(mp.fullName));
    if (!id) { matrixNoMatch++; continue; }
    const upd = {};
    if (mp.positionTitle) upd.position = mp.positionTitle;
    if (mp.positionCode) upd.position_code = mp.positionCode;
    if (mp.deptCode) { upd.department = deptEnum(mp.deptCode); upd.department_code = mp.deptCode; }
    if (typeof mp.yos === 'number') upd.years_of_service = mp.yos;
    if (Object.keys(upd).length > 0) { await db().from('employees').update(upd).eq('id', id); enriched++; }
  }
  console.log(`Enriched ${enriched} employees from matrix. (${matrixNoMatch} matrix names unmatched)`);

  if (matrixNoMatch > 0) {
    console.log('\nUnmatched matrix names:');
    for (const mp of matrixPeople) {
      if (!empByNorm.has(norm(mp.fullName))) console.log(`  - "${mp.fullName}"`);
    }
  }

  // Load SOPs
  const { data: existingSops } = await db().from('sops').select('id,doc_no');
  const sopIdByDocNo = new Map((existingSops || []).map(s => [s.doc_no.toLowerCase(), s.id]));
  let sopInserted = 0;
  for (const docNo of uniqueDocNos) {
    if (sopIdByDocNo.has(docNo.toLowerCase())) continue;
    let area = 'other';
    const u = docNo.toUpperCase();
    if (u.startsWith('PROD') || u.startsWith('PWI')) area = 'production';
    else if (u.startsWith('MAIN')) area = 'maintenance';
    else if (u.startsWith('LAB')) area = 'laboratory';
    else if (u.startsWith('QM') || u.startsWith('QC')) area = 'quality';
    else if (u.startsWith('HSE') || u.startsWith('HYG')) area = 'hygiene';
    const { data: s, error: sErr } = await db()
      .from('sops')
      .insert({ doc_no: docNo, title: docNo, area, doc_type: 'wi', status: 'active', sort_order: 999 })
      .select('id').single();
    if (sErr) { console.warn(`  WARN insert SOP "${docNo}": ${sErr.message}`); continue; }
    sopIdByDocNo.set(docNo.toLowerCase(), s.id);
    sopInserted++;
  }
  console.log(`\nSOPs: ${sopInserted} new, ${(existingSops || []).length} pre-existing.`);

  // Upsert competencies
  let compUpserted = 0, compSkipped = 0, compNoEmp = 0, compNoSop = 0;
  const IMPORT_BY = `Spreadsheet import ${new Date().toISOString().slice(0, 10)}`;

  for (const mp of matrixPeople) {
    const empId = empByNorm.get(norm(mp.fullName));
    if (!empId) { compNoEmp += Object.keys(mp.competencies).length; continue; }

    for (const [docNo, comp] of Object.entries(mp.competencies)) {
      const sopId = sopIdByDocNo.get(docNo.toLowerCase());
      if (!sopId) { compNoSop++; continue; }

      const { data: ex } = await db()
        .from('employee_competencies')
        .select('id,status,score')
        .eq('employee_id', empId).eq('sop_id', sopId)
        .maybeSingle();

      if (ex && ex.status === comp.status) { compSkipped++; continue; }

      const { data: up, error: uErr } = await db()
        .from('employee_competencies')
        .upsert({
          employee_id: empId, sop_id: sopId,
          status: comp.status, raw_code: comp.raw_code, score: comp.score,
          training_completed: comp.training_completed, date_completed: comp.date_completed,
        }, { onConflict: 'employee_id,sop_id' })
        .select('id').single();

      if (uErr) { console.warn(`  WARN comp ${mp.fullName}/${docNo}: ${uErr.message}`); continue; }

      await db().from('competency_history').insert({
        competency_id: up.id, employee_id: empId, sop_id: sopId,
        action: ex ? 'status_change' : 'imported',
        from_status: ex ? ex.status : null, to_status: comp.status,
        from_score: ex ? ex.score : null, to_score: comp.score,
        changed_by: null, changed_by_name: IMPORT_BY,
      });
      compUpserted++;
    }
  }

  console.log('\n═══ Import Complete ═══');
  console.log(`Competencies: ${compUpserted} upserted, ${compSkipped} unchanged, ${compNoEmp} skipped (no emp), ${compNoSop} skipped (no SOP)`);
  console.log('\nRun again to confirm 0 new rows (idempotency check).');
}

main().catch(e => { console.error(e); process.exit(1); });
