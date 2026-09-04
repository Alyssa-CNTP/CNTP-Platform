/**
 * Label templates — core.
 *
 * The template model, placeholder resolution and market compliance. Pure: no
 * React, no I/O, no HTML. Rendering to HTML / PPLB / PDF lives in
 * features/pasteuriser-labels, which imports this. Core never imports it back
 * (ARCHITECTURE.md §2).
 */

export * from './types'
export * from './resolve'
export * from './compliance'
