// app/api/leaf-shade/predict/route.ts
//
// Leaf Shade Classifier proxy.
// Ports server/leafShade.js from the CNTPquality Express app into Next.js.
//
// Flow:
//   1. Receive a Canon CR3 RAW file via multipart FormData (field: "cr3")
//   2. Forward it to the Python Flask micro-service on 127.0.0.1:5001/predict
//      (the model: leaf_shade_mlp_28feat_balanced_2026v1, scikit-learn 1.7.2)
//   3. Optionally save the prediction + the lab's physical observation to
//      qms.quality_records (workcenter='rawMaterial', workflow='leaf_shade')
//
// The Python service is run separately by pm2 (ml/leafshade/run.sh). It is NOT
// exposed to the internet — only this server-side route talks to it.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { cookies }                   from 'next/headers'
import { createServerClient }        from '@supabase/ssr'

export const runtime = 'nodejs'

const LEAF_SHADE_PORT = process.env.LEAF_SHADE_PORT || '5001'
const PY_URL          = `http://127.0.0.1:${LEAF_SHADE_PORT}`

// ─── Supabase admin client (service role — bypasses RLS for inserts) ──────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getCallerEmail(): Promise<string> {
  try {
    const cookieStore = await cookies()
    const db = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await db.auth.getUser()
    return user?.email?.split('@')[0] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function POST(req: NextRequest) {
  // Parse multipart form data
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const cr3 = formData.get('cr3') as File | null
  if (!cr3) return NextResponse.json({ error: "No CR3 file uploaded (field name: 'cr3')" }, { status: 400 })
  if (!(cr3.name || '').toLowerCase().endsWith('.cr3')) {
    return NextResponse.json({ error: `Only Canon CR3 files are accepted. Got: ${cr3.name}` }, { status: 415 })
  }

  const batchNumber   = String(formData.get('batch_number')  || '').trim() || 'UNKNOWN'
  const location      = String(formData.get('location')      || '').trim() || 'Unknown'
  const physicalShade = String(formData.get('physical_shade')|| '').trim() || null   // observed shade (1–11)
  const observation   = String(formData.get('observation')   || '').trim() || null   // free-text note
  const saveRecord    = String(formData.get('save_record')   || '') === 'true'

  // 1. Health check — give a clear error if the Python service isn't running
  try {
    const h = await fetch(`${PY_URL}/health`, { signal: AbortSignal.timeout(5000) })
    if (!h.ok) throw new Error('unhealthy')
  } catch {
    return NextResponse.json({
      error: 'Leaf shade service is not running. On the VPS: cd ml/leafshade && docker compose up -d --build && docker compose logs --tail=40',
    }, { status: 503 })
  }

  // 2. Forward the CR3 to the Python micro-service
  let result: any
  try {
    const fwd = new FormData()
    fwd.append('cr3', cr3, cr3.name)
    const pyRes = await fetch(`${PY_URL}/predict`, {
      method: 'POST', body: fwd,
      signal: AbortSignal.timeout(90_000),
    })
    result = await pyRes.json()
    if (!pyRes.ok) return NextResponse.json(result, { status: pyRes.status })
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return NextResponse.json(
      { error: isTimeout ? 'Leaf shade service timed out — CR3 file may be too large' : (err?.message || 'Prediction failed') },
      { status: isTimeout ? 504 : 500 },
    )
  }

  // 3. Optionally persist to qms.quality_records (same shape as the old app)
  if (saveRecord) {
    try {
      const uploaderName = await getCallerEmail()
      const db = getServiceClient()
      const { error } = await db.schema('qms').from('quality_records').insert({
        workcenter:   'rawMaterial',
        workflow:     'leaf_shade',
        batch_number: batchNumber,
        data_json: {
          predicted_shade: result.predicted_shade,
          confidence_pct:  result.confidence_pct,
          top5:            result.top5,
          model_version:   result.model_version,
          analysed_at:     new Date().toISOString(),
          location,
          physical_shade:  physicalShade,
          observation,
          features:        result.features,
          camera:          result.camera,
          _source_file:    cr3.name,
        },
        file_name:   cr3.name,
        uploaded_by: uploaderName,
      })
      if (error) {
        return NextResponse.json({ ...result, saved: false, save_error: error.message }, { status: 200 })
      }
    } catch (err: any) {
      return NextResponse.json({ ...result, saved: false, save_error: err?.message || 'save failed' }, { status: 200 })
    }
  }

  return NextResponse.json({
    ...result,
    saved:          saveRecord,
    batch_number:   saveRecord ? batchNumber : undefined,
    location,
    physical_shade: physicalShade,
    observation,
  })
}
