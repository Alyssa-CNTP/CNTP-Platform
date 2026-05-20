// app/api/upload/route.ts
//
// Replaces the Express POST /api/upload endpoint entirely.
// Runs inside Next.js — no Express needed.
//
// Flow:
//   1. Receive PDF via multipart FormData
//   2. Extract text with pdf-parse
//   3. Call Gemini AI with workflow-specific prompt
//   4. Parse JSON response
//   5a. Raw material workflows → save to qms.quality_records, return success
//   5b. Pasteuriser lab workflows → return extract_only for client-side review
//   6. Duplicate detection with force_save / is_retest overrides
//
// Install required package:
//   npm install pdf-parse
//   npm install --save-dev @types/pdf-parse

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { cookies }                   from 'next/headers'
import { createServerClient }        from '@supabase/ssr'

// ─── Gemini config ────────────────────────────────────────────────────────────

const GEMINI_FLASH    = 'gemini-3.1-flash-lite-preview'
const GEMINI_FLASH_8B = 'gemini-2.5-flash'

const WORKFLOW_MAX_TOKENS: Record<string, number> = {
  pa_ta_analysis: 2000,
  residue:        2000,
  glyphosate:     1200,
  micro:          1500,
  heavy_metals:    800,
  eto:             600,
  aflatoxins:      600,
  mosh_moah:       600,
  pa_final:       2000,
  residue_fp:      800,
}

const WORKFLOW_TEXT_LIMIT: Record<string, number> = {
  pa_ta_analysis: 20000,
  residue:        12000,
  glyphosate:      6000,
  micro:           8000,
  default:         8000,
  residue_fp:      3000,
}

// ─── Rate limiter (simple in-process queue) ───────────────────────────────────
// Prevents Gemini 429s on the free tier (15 RPM)

const GEMINI_MIN_GAP_MS = 4500
let lastGeminiCall = 0
const geminiQueue: { fn: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }[] = []
let queueRunning = false

async function enqueueGemini<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    geminiQueue.push({ fn, resolve, reject })
    if (!queueRunning) drainQueue()
  })
}

async function drainQueue() {
  queueRunning = true
  while (geminiQueue.length > 0) {
    const { fn, resolve, reject } = geminiQueue.shift()!
    const wait = Math.max(0, lastGeminiCall + GEMINI_MIN_GAP_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastGeminiCall = Date.now()
    try { resolve(await fn()) } catch (e) { reject(e) }
  }
  queueRunning = false
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Gemini call with model fallback ─────────────────────────────────────────

async function callGemini(systemPrompt: string, text: string, workflow: string) {
  const maxTokens = WORKFLOW_MAX_TOKENS[workflow] ?? 1500
  const textLimit = WORKFLOW_TEXT_LIMIT[workflow] ?? WORKFLOW_TEXT_LIMIT.default
  const fullPrompt = `${systemPrompt}\n\nExtract all data from this report:\n\n${text.slice(0, textLimit)}`

  const tryModel = async (model: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: 'text/plain' },
      }),
    })
    if (res.status === 429 || res.status === 503) throw new Error(`RATE_LIMIT:${model}`)
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API error (${res.status}) on ${model}: ${err.slice(0, 200)}`)
    }
    const data    = await res.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) throw new Error(`Gemini ${model} returned empty response`)
    return { content, model_used: model }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(4000)
    for (const model of [GEMINI_FLASH, GEMINI_FLASH_8B]) {
      try {
        return await tryModel(model)
      } catch (err: any) {
        if (err.message.startsWith('RATE_LIMIT:')) continue
        throw err
      }
    }
  }
  throw new Error('Gemini is temporarily overloaded. Please wait 30 seconds and try again.')
}

// ─── Gemini vision — for scanned PDFs ────────────────────────────────────────
// Uses Gemini's native PDF understanding (no pdftoppm needed)

async function callGeminiWithPdf(systemPrompt: string, pdfBase64: string, workflow: string) {
  const maxTokens = WORKFLOW_MAX_TOKENS[workflow] ?? 1500
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH}:generateContent`

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body:    JSON.stringify({
      contents: [{
        parts: [
          { text: systemPrompt + '\n\nExtract all data from this document. Return ONLY valid JSON.' },
          { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini vision error (${res.status}): ${err.slice(0, 200)}`)
  }
  const data    = await res.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('Gemini vision returned empty response')
  return { content, model_used: GEMINI_FLASH + ' (vision)' }
}

// ─── JSON parser ──────────────────────────────────────────────────────────────

function parseJSON(raw: string): any {
  if (!raw || typeof raw !== 'string') throw new Error('Empty response from AI model')
  let clean = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()

  const objStart = clean.indexOf('{'),  objEnd   = clean.lastIndexOf('}')
  const arrStart = clean.indexOf('['),  arrEnd   = clean.lastIndexOf(']')

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    if (arrEnd > arrStart) {
      const arr = JSON.parse(clean.slice(arrStart, arrEnd + 1))
      return Array.isArray(arr) && arr.length > 0 ? arr[0] : arr
    }
  }
  if (objStart !== -1 && objEnd > objStart) return JSON.parse(clean.slice(objStart, objEnd + 1))
  return JSON.parse(clean)
}

// ─── PA grade computation ─────────────────────────────────────────────────────

function computePaGrade(sample: any): any {
  const paUg = parseFloat(
    sample.final_summed_total_pa ?? sample.total_pa ?? sample.total_pa_ug_kg
  ) || 0

  let pa_level: string, pa_status: string
  if (!paUg || paUg === 0)  { pa_level = 'P0'; pa_status = 'PASS' }
  else if (paUg <= 50)      { pa_level = 'P1'; pa_status = 'PASS' }
  else if (paUg <= 200)     { pa_level = 'P2'; pa_status = 'PASS' }
  else if (paUg <= 400)     { pa_level = 'P3'; pa_status = 'PASS' }
  else                      { pa_level = 'P4'; pa_status = 'FAIL' }

  const ta_status = (sample.ta_status?.toUpperCase() === 'FAIL') ? 'FAIL' : 'PASS'

  return {
    ...sample,
    total_pa_ug_kg: paUg || null,
    total_pa_mg_kg: paUg ? (paUg / 1000).toFixed(4) : null,
    pa_level, pa_status, ta_status,
  }
}

// ─── Prompts — exact copy from Express server ─────────────────────────────────

const PROMPTS: Record<string, string> = {
  pa_ta_analysis: `You are a precision quality data extraction agent for herbal tea manufacturing. 
Your goal is to extract Pyrrolizidine Alkaloid (PA) and Tropane Alkaloid (TA) data from Stellenbosch University CAF reports.

### CRITICAL SUMMATION LOGIC:
1. One report contains multiple tables. The first table contains primary PAs. Subsequent tables contain "Additional PAs."
2. You MUST check all tables for the same Batch Number (e.g., MAT-0224).
3. The "true_total_pa" is the sum of the "Total" column from EVERY table where that batch number appears. 
   - Example: If Table 1 shows 350 and Table 2 shows 7, the result is 357.
4. If a value is "ND", treat it as 0 for calculation purposes, but store it as null in the individual_alkaloids map.

### EXTRACTION RULES:
- Return ONLY valid JSON. No preamble, no markdown.
- Units are µg/kg.
- Extract every unique batch number as its own object in the "samples" array.
- "p_level" must be calculated based on the FINAL SUMMED total_pa.

### P-LEVEL RULES (Total PA µg/kg):
- P0: 0  P1: 1–50  P2: 51–200  P3: 201–400  FAIL: >400

### OUTPUT STRUCTURE:
{"report_name":"","lab":"Stellenbosch University CAF","samples":[{"batch_no":"","sample_date":"","total_pa_primary_table":null,"total_pa_additional_table":null,"final_summed_total_pa":null,"total_ta":null,"p_level":""}]}`,

  residue: `You are a precision quality data extraction agent for herbal tea manufacturing.
Extract pesticide residue data from HKAL/laboratory residue reports.
Return ONLY valid JSON. No preamble, no markdown.
Return this exact structure:
{"report_reference":"","batch_no":"","sample_date":"","lab":"","methods_used":[],"total_compounds_screened":null,"total_detections":0,"total_exceedances":0,"overall_status":"PASS","compounds_detected":[{"compound_name":"","detected_value_mg_kg":null,"detected_value_prefix":"","mrl_eu_mg_kg":null,"mrl_eu_not_set":false,"eu_mrl_exceeded":false}]}`,

  residue_fp: `INSTRUCTIONS: Extract pesticide residue data from a Microchem (by AGQ Labs) Certificate of Analysis for a FINAL PRODUCT (Rooibos tea). Output ONLY a single raw JSON object. Start with { and end with }. No markdown, no preamble.

IMPORTANT: This report has multiple pages. Pages 2 onward contain ONLY a list of compounds that were NOT detected — DO NOT read or process those pages. Only extract data from PAGE 1.

EXTRACTION RULES:
1. "batch_no": From Sample Details — extract only the batch code like "26203-CON-SFC".
2. "lab_reference": "Our Lab Reference Number" value.
3. "date_received": "Date Received" field.
4. "date_validated": "Date Validated" field.
5. "methods_used": Array of method names.
6. "compounds_detected": ONLY from the "Pesticide(s) Detected" table on page 1. If "No residue(s) detected" → []
7. "overall_status": "PASS" unless a compound exceeds its MRL.

Output: {"batch_no":"","lab":"Microchem Lab Services (Pty) Ltd","lab_reference":"","date_received":"","date_validated":"","po_number":"","requested_by":"","commodity":"","methods_used":[],"total_detections":0,"overall_status":"PASS","compounds_detected":[]}`,

  glyphosate: `INSTRUCTIONS: Extract glyphosate data from this HKAL lab report. Output ONLY a single raw JSON object. Start with { and end with }. No markdown.

CRITICAL: Page 1 "Results Summary" — if "None detected" → analytes = [], overall_status = "Pass". Page 2 lists reporting limits NOT detections. Only add to analytes[] if actually detected in Page 1.

Fields: batch_no, report_reference, lab, sample_date, date_issued, analytes ([] if none detected), overall_status.

Example: {"batch_no":"26103-ORG-LC","report_reference":"345271","lab":"Hearshaw and Kinnes Analytical Laboratory (Pty) Ltd.","sample_date":"03/12/2025","date_issued":"03/03/2026","analytes":[],"overall_status":"Pass"}`,

  micro: `INSTRUCTIONS: Extract data from this microbiology COA. Output ONLY a single raw JSON object. Do NOT use markdown. Start with { end with }.

Extract: lab, lab_no, order_no, batch_no, sample_description, production_date, date_received, date_issued, ecoli, mould, staph, tpc, yeast, salmonella_25g, salmonella_125g, salmonella_375g, bacillus_cereus, clostridium_perfringens, ecoli_o157, listeria, coliforms, enterobacteriaceae, overall_status.

Keep values like "<10" as strings. null if not tested. overall_status: "Pass" unless limits exceeded.`,

  heavy_metals: `INSTRUCTIONS: Extract heavy metals data. Output ONLY raw JSON. No markdown.
Extract: batch_no, report_reference, lab, sample_date, date_issued, analytes (array with analyte, result, unit, spec, status), overall_status.
EU limits (mg/kg): Lead ≤3.0, Cadmium ≤1.0, Mercury ≤0.02, Arsenic ≤1.0`,

  eto: `INSTRUCTIONS: Extract Ethylene Oxide data. Output ONLY raw JSON. No markdown.
Extract: batch_no, report_reference, lab, sample_date, date_issued, analytes (array with analyte, result, unit, spec, status), overall_status.
EU limit for sum EtO+2-CE in herbal tea: 0.02 mg/kg.`,

  aflatoxins: `INSTRUCTIONS: Extract aflatoxin data. Output ONLY raw JSON. No markdown.
Extract: batch_no, report_reference, lab, sample_date, date_issued, analytes (array with analyte, result, unit, spec, status), overall_status.
EU limits (µg/kg): Aflatoxin B1 ≤5, Total Aflatoxins ≤10, Ochratoxin A ≤20.`,

  mosh_moah: `INSTRUCTIONS: Extract MOSH/MOAH data. Output ONLY raw JSON. No markdown.
Extract: batch_no, report_reference, lab, sample_date, date_issued, analytes (array with analyte, result, unit, spec, status), overall_status.`,

  pa_final: `INSTRUCTIONS: Extract PA/TA summary data from Eurofins report. Output ONLY raw JSON. No markdown.
Do NOT list individual alkaloids. Only extract the SUMMARY rows.
Fields: batch_no, report_reference, lab, sample_description, date_issued, date_received, total_pa_eu, total_pa_bfr28, scopolamine_total, total_ta, unit ("µg/kg"), eu_limit_pa (400), eu_limit_ta (1000), overall_status.
overall_status: "Pass" if total_pa_eu is null or below 400, "Fail" if above 400.`,
}


// ─── Residue grade computation (inlined — no external module needed) ──────────

function computeResidueGrades(extracted: any): any {
  if (!extracted?.compounds_detected) return extracted

  const enriched = { ...extracted }
  let overallRGrade = 'R-0'
  let hasExceedance = false
  let hasBanned = false

  const gradeNum = (g: string) => parseInt(g.replace('R-', '')) || 0

  enriched.compounds_detected = (extracted.compounds_detected || []).map((c: any) => {
    const detectedVal = parseFloat(
      String(c.detected_value_mg_kg ?? c.result_mg_kg ?? '0').replace(/[<>]/g, '')
    ) || 0

    let r_grade = detectedVal === 0 ? 'R-0' : 'R-1'

    // EU MRL check
    const mrl = parseFloat(String(c.mrl_eu_mg_kg ?? ''))
    if (!isNaN(mrl) && mrl > 0) {
      if (detectedVal === 0)           r_grade = 'R-0'
      else if (detectedVal <= mrl / 2) r_grade = 'R-1'
      else if (detectedVal <= mrl)     r_grade = 'R-2'
      else                             r_grade = 'R-3'
    }
    if (c.eu_mrl_exceeded) r_grade = 'R-3'

    const is_banned = c.is_banned ?? false
    if (r_grade === 'R-3') hasExceedance = true
    if (is_banned)         hasBanned     = true
    if (gradeNum(r_grade) > gradeNum(overallRGrade)) overallRGrade = r_grade

    return { ...c, r_grade, is_banned }
  })

  enriched.overall_r_grade        = overallRGrade
  enriched.overall_status         = hasExceedance || hasBanned ? 'FAIL' : 'PASS'
  enriched.banned_compounds_count = enriched.compounds_detected.filter((c: any) => c.is_banned).length
  return enriched
}

// ─── Supabase admin client (service role — bypasses RLS for inserts) ──────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getCallerEmail(): Promise<string> {
  try {
    const cookieStore = await cookies()
    const db = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
      }
    )
    const { data: { user } } = await db.auth.getUser()
    return user?.email?.split('@')[0] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
  }

  // Parse multipart form data
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const pdfFile   = formData.get('pdf')   as File | null
  const workcenter = formData.get('workcenter') as string | null
  const workflow   = formData.get('workflow')   as string | null
  const forceSave  = formData.get('force_save') === 'true'
  const isRetest   = formData.get('is_retest')  === 'true'

  if (!pdfFile)    return NextResponse.json({ error: 'No PDF file uploaded' }, { status: 400 })
  if (!workcenter) return NextResponse.json({ error: 'workcenter is required' }, { status: 400 })
  if (!workflow)   return NextResponse.json({ error: 'workflow is required' }, { status: 400 })

  // Resolve prompt key
  const promptKey =
    workflow === 'glyphosate' && workcenter === 'rawMaterial' ? 'glyphosate' :
    workflow === 'residue'    && workcenter === 'pasteuriser'  ? 'residue_fp' :
    workflow

  const systemPrompt = PROMPTS[promptKey]
  if (!systemPrompt) {
    return NextResponse.json({ error: `Unknown workflow: ${workflow}` }, { status: 400 })
  }

  const uploaderName = await getCallerEmail()
  const fileName     = pdfFile.name

  try {
    // 1. Read PDF bytes
    const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer())
    const pdfBase64 = pdfBuffer.toString('base64')

    // 2. Extract text
    let text = ''
    let isScanned = false
    try {
      // Dynamic import — pdf-parse must be installed: npm install pdf-parse
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const parsed   = await pdfParse(pdfBuffer)
      text      = parsed.text ?? ''
      isScanned = !text || text.trim().length < 100
    } catch {
      // pdf-parse failed or not installed — fall back to vision
      isScanned = true
    }

    // 3. Call Gemini
    let raw: string, modelUsed: string

    if (isScanned) {
      // Send PDF directly to Gemini vision — no pdftoppm needed
      const result = await enqueueGemini(() => callGeminiWithPdf(systemPrompt, pdfBase64, workflow))
      raw       = result.content
      modelUsed = result.model_used
    } else {
      const result = await enqueueGemini(() => callGemini(systemPrompt, text, workflow))
      raw       = result.content
      modelUsed = result.model_used
    }

    // 4. Parse JSON
    let extracted: any
    try {
      extracted = parseJSON(raw)
    } catch (parseErr: any) {
      return NextResponse.json({
        error: `AI returned invalid JSON — ${parseErr.message}. Raw start: ${raw?.slice(0, 120)}`,
        hint:  'Try uploading again. If it keeps failing the PDF may need manual entry.',
        model_used: modelUsed,
      }, { status: 422 })
    }

    // 5. Pasteuriser lab workflows — return extract_only for client-side review panel
    const EXTRACT_ONLY = ['micro', 'heavy_metals', 'eto', 'aflatoxins', 'mosh_moah', 'pa_final', 'residue_fp']
    const EXTRACT_ONLY_IF_PASTEURISER = ['glyphosate', 'residue']
    const isExtractOnly =
      EXTRACT_ONLY.includes(workflow) ||
      (EXTRACT_ONLY_IF_PASTEURISER.includes(workflow) && workcenter === 'pasteuriser')

    if (isExtractOnly) {
      return NextResponse.json({
        success:      true,
        extract_only: true,
        data:         { ...extracted, _doc: fileName },
        model_used:   modelUsed,
      })
    }

    // 6. Build records to save
    const recordsToSave: { batch_number: string; data: any }[] = []

    if (workflow === 'pa_ta_analysis' && extracted.samples) {
      for (const sample of extracted.samples) {
        recordsToSave.push({
          batch_number: sample.batch_no || 'UNKNOWN',
          data:         computePaGrade({ ...extracted, ...sample, samples: undefined }),
        })
      }
    } else {
      const enriched = workflow === 'residue' ? computeResidueGrades(extracted) : extracted
      recordsToSave.push({
        batch_number: enriched.batch_no || enriched.report_reference || 'UNKNOWN',
        data:         enriched,
      })
    }

    const db = getServiceClient()

    // 7. Duplicate check
    const checkDupes = workcenter === 'rawMaterial' && ['pa_ta_analysis', 'residue'].includes(workflow)
    if (checkDupes && !forceSave && !isRetest) {
      const duplicates: any[] = []
      for (const rec of recordsToSave) {
        const { data: existing } = await db
          .schema('qms')
          .from('quality_records')
          .select('id, batch_number, file_name, created_at')
          .eq('workcenter', workcenter)
          .eq('workflow', workflow)
          .eq('batch_number', rec.batch_number)
          .order('created_at', { ascending: false })
          .limit(1)

        if (existing && existing.length > 0) {
          duplicates.push({ ...existing[0], batch_number: rec.batch_number })
        }
      }

      if (duplicates.length > 0) {
        return NextResponse.json({
          success:           false,
          duplicate_warning: true,
          message:           `${duplicates.length} batch number(s) already have a ${workflow === 'pa_ta_analysis' ? 'PA/TA' : 'Residue'} record.`,
          duplicate_batches: duplicates.map(d => ({
            batch_number:  d.batch_number,
            existing_file: d.file_name,
            existing_date: d.created_at,
          })),
          all_batch_numbers: recordsToSave.map(r => r.batch_number),
        })
      }
    }

    // 8. Save to qms.quality_records
    const savedIds: number[] = []
    for (const rec of recordsToSave) {
      const dataToSave = isRetest
        ? { ...rec.data, is_retest: true, retest_date: new Date().toISOString() }
        : rec.data

      const { data: saved, error: saveErr } = await db
        .schema('qms')
        .from('quality_records')
        .insert({
          workcenter,
          workflow,
          batch_number: rec.batch_number,
          data_json:    dataToSave,
          file_name:    fileName,
          uploaded_by:  uploaderName,
        })
        .select('id')
        .single()

      if (saveErr) {
        console.error('Upload save error:', saveErr)
        return NextResponse.json({ error: 'Failed to save record: ' + saveErr.message }, { status: 500 })
      }
      savedIds.push((saved as any).id)
    }

    return NextResponse.json({
      success:        true,
      records_saved:  savedIds.length,
      batch_numbers:  recordsToSave.map(r => r.batch_number),
      data:           recordsToSave.map(r => r.data),
      is_retest:      isRetest,
      model_used:     modelUsed,
    })

  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message || 'Extraction failed' }, { status: 500 })
  }
}

// Increase body size limit for PDF uploads (default is 1MB — PDFs can be larger)
export const config = {
  api: { bodyParser: false },
}