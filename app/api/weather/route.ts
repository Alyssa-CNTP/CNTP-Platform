// app/api/weather/route.ts
// Factory weather for the production dashboard. Uses Open-Meteo (free, no API
// key, no signup) for the Blackheath, Western Cape site. Returns the current
// conditions plus a short forecast, already converted to a small WMO-code label.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const revalidate = 1800 // 30 min — weather doesn't change minute-to-minute

// Cape Natural Tea Products — Blackheath, Western Cape (Cape Town metro).
const LAT = -33.93
const LON = 18.65

// WMO weather codes → short label + Tabler-ish icon hint the client maps.
function describe(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: 'sun' }
  if (code <= 2) return { label: 'Mostly sunny', icon: 'sun' }
  if (code === 3) return { label: 'Overcast', icon: 'cloud' }
  if (code <= 48) return { label: 'Fog', icon: 'fog' }
  if (code <= 57) return { label: 'Drizzle', icon: 'rain' }
  if (code <= 67) return { label: 'Rain', icon: 'rain' }
  if (code <= 77) return { label: 'Snow', icon: 'snow' }
  if (code <= 82) return { label: 'Showers', icon: 'rain' }
  if (code <= 86) return { label: 'Snow showers', icon: 'snow' }
  if (code <= 99) return { label: 'Thunderstorm', icon: 'storm' }
  return { label: 'Unknown', icon: 'cloud' }
}

export async function GET() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=Africa%2FJohannesburg&forecast_days=3`

    const res = await fetch(url, { next: { revalidate } })
    if (!res.ok) return NextResponse.json({ error: 'Weather service unavailable' }, { status: 502 })
    const j = await res.json()

    const c = j.current ?? {}
    const d = j.daily ?? {}
    const cur = describe(Number(c.weather_code))

    const forecast = Array.isArray(d.time)
      ? d.time.map((t: string, i: number) => ({
          date: t,
          max: Math.round(d.temperature_2m_max?.[i]),
          min: Math.round(d.temperature_2m_min?.[i]),
          rainPct: Math.round(d.precipitation_probability_max?.[i] ?? 0),
          ...describe(Number(d.weather_code?.[i])),
        }))
      : []

    return NextResponse.json({
      location: 'Blackheath, Western Cape',
      current: {
        temp: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        humidity: Math.round(c.relative_humidity_2m),
        wind: Math.round(c.wind_speed_10m),
        precip: Number(c.precipitation ?? 0),
        label: cur.label,
        icon: cur.icon,
      },
      forecast,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Weather error' }, { status: 500 })
  }
}
