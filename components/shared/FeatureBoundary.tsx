'use client'

// components/shared/FeatureBoundary.tsx
//
// Wraps an optional feature so that a crash inside it cannot take down the page
// around it. This matters most on the capture screens: an operator mid-shift
// with a half-captured session must not lose the screen because a side panel
// threw. The feature disappears, a small notice takes its place, and capture
// carries on.
//
// Before this existed there was no error boundary anywhere in the app, so any
// component that threw during render blanked the whole route.
//
// Every feature mounted per ARCHITECTURE.md §3 goes inside one of these.
//
// ── On wrapping core capture logic ──────────────────────────────────────────
//
// This comment used to say core capture logic must NOT be wrapped, because a
// broken mass balance should be loud rather than quietly swallowed. The intent
// was right; the conclusion was wrong, and it left the five section components
// mounted bare in a ternary chain, where ONE of them throwing during render
// blanked the entire route — tab strip, Checks, Overview, Sign-off and all.
//
// A boundary here is not a silent swallow. It logs to the console AND shows a
// red notice naming what failed. The operator keeps the rest of the screen, the
// autosaved draft, and something specific to tell a supervisor, instead of
// "This page couldn't load".
//
// What a section mount needs is a fallback that does not claim capture is fine
// — hence the `fallback` prop. Use `silent` only for genuinely decorative
// additions.

import React from 'react'

type Props = {
  /** Shown in the fallback and in the console line, e.g. "Supervisor adjustments". */
  name: string
  children: React.ReactNode
  /** Render nothing at all on failure instead of the notice. Use for purely
   *  decorative additions where a visible error box would be more disruptive
   *  than the missing feature. */
  silent?: boolean
  /** Replaces the default notice. Needed where the default's reassurance —
   *  "your capture is unaffected" — would be untrue, e.g. a section capture
   *  component that the operator cannot work without. */
  fallback?: React.ReactNode
}

type State = { error: Error | null }

export default class FeatureBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Deliberately console.error rather than a silent swallow: this is how a
    // broken feature gets noticed on staging before anyone on the floor sees it.
    console.error(`[FeatureBoundary] "${this.props.name}" crashed and was isolated:`, error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.silent) return null
    if (this.props.fallback) return <>{this.props.fallback}</>

    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
        padding: '8px 12px', margin: '8px 0', fontSize: 12,
      }}>
        <span style={{ fontWeight: 700, color: '#991b1b' }}>{this.props.name} unavailable</span>
        <span style={{ color: '#7f1d1d' }}>
          This section failed to load. Everything else on this page still works and your capture is unaffected.
        </span>
      </div>
    )
  }
}
