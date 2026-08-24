// app/api/quality/gemini-key-check/route.ts
//
// Diagnostic only — answers "which Google account/project is the deployed
// GEMINI_API_KEY actually on?" without ever exposing the secret itself.
//
// There is no Google API that returns account/project identity from a bare
// API key (that's deliberate on Google's part — a key alone must not reveal
// who owns it). The only place that mapping exists is Google AI Studio's own
// UI (https://aistudio.google.com/apikey), which lists each key truncated —
// e.g. "AIzaSy...w7Qx" — under whichever Google account is signed in. So the
// actual way to answer "which account" is: sign into AI Studio with each
// candidate Google account and visually match the truncated key shown there
// against what this endpoint reports for the key actually deployed on the
// VPS. This never returns enough of the key to reconstruct it.

import { NextResponse } from 'next/server'
import { getCallerPermissions } from '@/lib/auth/server-helpers'

export async function GET() {
  const caller = await getCallerPermissions()
  // Same gate as the Lab Results page's own admin-only actions
  // (can_delete_lab_results) — this reveals partial key material, so it's
  // deliberately not open to every QC login.
  if (!caller.userId || (!caller.can('can_delete_lab_results') && caller.role !== 'senior_developer'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ configured: false })

  return NextResponse.json({
    configured: true,
    length: key.length,
    // Enough to visually match against AI Studio's own truncated display
    // (which shows the leading "AIzaSy" prefix and a handful of trailing
    // characters) — nowhere near enough to reconstruct the real key.
    prefix: key.slice(0, 6),
    suffix: key.slice(-6),
    masked: `${key.slice(0, 6)}…${key.slice(-6)}`,
  })
}

// A LIVE test call, made right now, with the real deployed key — as opposed
// to the masked-key check above, which only proves what key is deployed, not
// whether it can currently make a successful request. Needed because Google's
// own usage dashboard visibly lags (it showed zero requests for "today" while
// an upload from minutes earlier had already failed), and the error banner in
// the UI can be a stale, already-dismissed-but-still-shown queue row rather
// than a fresh result — neither tells you whether the account can serve a
// request *right now*. This makes exactly one cheap, tiny request and reports
// Google's real, current, full response — not a hint, not a cached message.
export async function POST() {
  const caller = await getCallerPermissions()
  if (!caller.userId || (!caller.can('can_delete_lab_results') && caller.role !== 'senior_developer'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ configured: false })

  const model = 'gemini-2.5-flash'
  const startedAt = new Date().toISOString()
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 5 },
      }),
    })
    const bodyText = await res.text()
    let body: any = bodyText
    try { body = JSON.parse(bodyText) } catch { /* keep as text */ }
    return NextResponse.json({
      configured: true, model, startedAt, status: res.status, ok: res.ok,
      // Full body, not truncated — this is the one place we deliberately want
      // everything Google sent, since the whole point is not to guess again.
      body,
    })
  } catch (e: any) {
    return NextResponse.json({ configured: true, model, startedAt, status: null, ok: false, error: e?.message || String(e) })
  }
}
