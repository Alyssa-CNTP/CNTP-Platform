import { NextRequest, NextResponse } from 'next/server'

export interface ParsedTag {
  lot_number:    string | null
  serial_number: string | null
  product_type:  string | null
  variant:       string | null
  weight_kg:     string | null
  tag_date:      string | null
  leaf_shade:    string | null
}

// ── Prompt tuned to all four real tag types seen in the factory ───────────────
// Tag types observed:
//   1. "Raw Material Dry" — printed label with fields: Lot No, Bag No, Date of Receipt,
//      Grade (A/B/C/3rd Party checkboxes), Leaf Shade, Bulk Density, PA (Low/High),
//      CON/ORG/RA checkboxes, Weight. Fully handwritten values.
//   2. "Stick Items" — printed label with fields: Type (RS/IS checkboxes),
//      1st Cut/Clean Block/Mixed Block checkboxes, Serial No, Weight,
//      CON/ORG/RA checkboxes, Operator, QC, PA (High handwritten on side).
//   3. "Dust Item: Pasteuriser" — printed label with fields: Type (Brown/Sieving/Powder
//      checkboxes), Serial No, Weight, CON/ORG/RA checkboxes, Operator, QC.
//   4. Plain handwritten tag — no printed fields, just freehand lines like:
//      "S.Tower / I.S / 09-05-25 / 106 kg / EXP / ORG / Low PA"
const PROMPT = `You are reading a bag tag from a South African rooibos factory. There are four tag types:

TYPE 1 — "Raw Material Dry" (printed label, handwritten values):
Fields: Lot No, Bag No, Date of Receipt, Grade checkbox (A/B/C/3rd Party — read which is ticked),
Leaf Shade, Bulk Density, PA (Low/High), CON/ORG/RA checkbox, Weight at bottom.

TYPE 2 — "Stick Items" (printed label, handwritten values):
Fields: Type checkbox (RS=Rolsiev Sticks, IS=Indent Sticks — read which is ticked),
1st Cut / Clean Block / Mixed Block checkboxes, Serial No (is the date e.g. 21-11-040),
Weight, CON/ORG/RA checkbox, Operator, PA written on side.
Map: serial_number=Serial No, product_type="IS" or "RS" based on checkbox, tag_date=Serial No date.

TYPE 3 — "Dust Item: Pasteuriser" (printed label, handwritten values):
Fields: Type checkbox (Brown/Sieving/Powder — read which is ticked),
Serial No (is a date e.g. 20-04-26), Weight, CON/ORG/RA checkbox, Operator.
Map: serial_number=Serial No, product_type="Dust - " + type ticked, tag_date=Serial No.

TYPE 4 — Plain handwritten tag (no printed fields, just lines of text):
Read each line. Lines contain: section name (e.g. S.Tower), product type (e.g. I.S, Fine Leaf),
date (dd-mm-yy format), weight (number + kg), Local/Export (EXP or LOCAL),
variant (CON/ORG/RA), PA level (Low/High).
Map: lot_number=null, serial_number=null, product_type=product type line,
tag_date=date line, weight_kg=weight number, variant=CON/ORG/RA line.

READING RULES:
- For checkboxes: look for X or tick mark. The ticked/crossed box = the selected value.
- CON/ORG/RA: the box with X = variant. CON=Conventional, ORG=Organic, RA=Rainforest Alliance.
- Weight: read the number carefully. Common weights: 100-400 kg. Ignore "kg" unit, return just number.
- Dates: convert dd-mm-yy to yyyy-MM-dd. E.g. 09-05-25 = 2025-05-09, 1-7-24 = 2024-07-01.
- Lot numbers often start with GS, RSGA, or are alphanumeric like GS.2d0-180.
- Bag numbers often start with N., M., G- followed by digits.
- If a field is blank or illegible, return null. Never guess or invent values.

Return ONLY this JSON, no markdown:
{"lot_number":null,"serial_number":null,"product_type":null,"variant":null,"weight_kg":null,"tag_date":null,"leaf_shade":null}`

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
]

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function assessConfidence(fields: ParsedTag): 'high' | 'medium' | 'low' {
  const coreFields = [fields.weight_kg, fields.variant, fields.tag_date]
  const filled = Object.values(fields).filter(v => v !== null && v !== '').length
  if (coreFields.every(f => f !== null) && filled >= 4) return 'high'
  if (coreFields.filter(f => f !== null).length >= 2)   return 'medium'
  return 'low'
}

function normaliseFields(fields: ParsedTag): ParsedTag {
  if (fields.variant) {
    const v = fields.variant.toUpperCase()
    if      (v.includes('RA') && v.includes('ORG'))   fields.variant = 'RA-ORG'
    else if (v.includes('RA') && v.includes('CON'))   fields.variant = 'RA-CON'
    else if (v.includes('RA'))                         fields.variant = 'RA-CON'
    else if (v.includes('ORG'))                        fields.variant = 'ORG'
    else if (v.includes('CON') || v.includes('CONV'))  fields.variant = 'CON'
  }
  if (fields.lot_number)    fields.lot_number    = fields.lot_number.toUpperCase().trim()
  if (fields.serial_number) fields.serial_number = fields.serial_number.toUpperCase().trim()
  // Clean weight — remove any non-numeric except decimal point
  if (fields.weight_kg) {
    const cleaned = fields.weight_kg.replace(/[^\d.]/g, '')
    fields.weight_kg = cleaned || null
  }
  return fields
}

const emptyFields = (): ParsedTag => ({
  lot_number: null, serial_number: null, product_type: null,
  variant: null, weight_kg: null, tag_date: null, leaf_shade: null,
})

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ status: 'error', message: 'GEMINI_API_KEY not set' }, { status: 500 })
  return NextResponse.json({ status: 'ready', models: MODELS })
}

export async function POST(req: NextRequest) {
  try {
    const { image, mimeType = 'image/jpeg' } = await req.json()
    if (!image) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured in .env.local' }, { status: 500 })

    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    })

    let lastError = 'All Gemini models unavailable. Check billing at console.cloud.google.com.'
    let geminiRes: Response | null = null
    let usedModel = ''

    for (const model of MODELS) {
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), 25000)
      try {
        const res = await fetch(`${BASE}/${model}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, body,
        })
        clearTimeout(timeout)
        if (res.status === 429 || res.status === 404 || res.status === 503) {
          const e = await res.json().catch(() => ({}))
          lastError = (e as any)?.error?.message ?? lastError
          console.warn(`[OCR] ${model} unavailable (${res.status}), trying next…`)
          continue
        }
        geminiRes = res; usedModel = model; break
      } catch (err: any) {
        clearTimeout(timeout)
        if (err.name === 'AbortError') { lastError = `${model} timed out`; continue }
        throw err
      }
    }

    if (!geminiRes) return NextResponse.json({ error: lastError }, { status: 429 })
    if (!geminiRes.ok) {
      const e = await geminiRes.json().catch(() => ({}))
      console.error('Gemini error:', JSON.stringify(e, null, 2))
      return NextResponse.json({ error: (e as any)?.error?.message ?? 'Gemini error' }, { status: 502 })
    }

    const data       = await geminiRes.json()
    const finishReason = data?.candidates?.[0]?.finishReason
    const rawText    = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    console.log(`[OCR] ${usedModel} finish:${finishReason} tokens:${data?.usageMetadata?.candidatesTokenCount}`)

    if (!rawText) {
      const blockReason = data?.promptFeedback?.blockReason
      console.error('[OCR] No text returned. Block:', blockReason, 'Finish:', finishReason)
      return NextResponse.json({ error: `No response from Gemini (${finishReason ?? blockReason ?? 'unknown'})` }, { status: 502 })
    }

    if (finishReason === 'MAX_TOKENS') {
      console.error('[OCR] Response truncated — increase maxOutputTokens')
    }

    // Strip markdown fences
    const clean = rawText.replace(/```json\n?|```/g, '').trim()

    let fields: ParsedTag
    try {
      fields = JSON.parse(clean)
    } catch {
      // Try to extract JSON block from response
      const match = clean.match(/\{[\s\S]*\}/)
      if (match) {
        try { fields = JSON.parse(match[0]) }
        catch { console.error('[OCR] JSON extract failed:', match[0]); fields = emptyFields() }
      } else {
        console.error('[OCR] No JSON in response:', clean)
        fields = emptyFields()
      }
    }

    fields = normaliseFields(fields)
    const confidence = assessConfidence(fields)
    console.log(`[OCR] Success via ${usedModel} — confidence:${confidence}`, JSON.stringify(fields))

    return NextResponse.json(
      { fields, raw_text: rawText, confidence, model: usedModel },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )

  } catch (err: any) {
    if (err.name === 'AbortError') return NextResponse.json({ error: 'OCR timeout.' }, { status: 504 })
    console.error('OCR route error:', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}