'use client'

import { useMemo } from 'react'
import { resolveLabel, type LabelBinding, type LabelTemplate } from '@/lib/core/labels'
import { buildLabelDocument, type RenderMode } from '../render-html'

/**
 * The label, rendered exactly as it will print.
 *
 * Deliberately an <iframe srcDoc> rather than React nodes. The label document
 * carries its own stylesheet in mm units with a @page rule, and it must be the
 * SAME document that goes to the printer and into the PDF proof. Re-expressing
 * it as JSX would create a second layout that looks right on screen and drifts
 * from the printed one — which is the exact failure this workflow exists to
 * stop. An iframe is a real document boundary: the app's CSS cannot reach in
 * and the label's cannot leak out.
 */
export function LabelPreview({
  template,
  binding = {},
  mode = 'preview',
  scale = 1,
  issuedTo,
  className = '',
}: {
  template: LabelTemplate
  binding?: LabelBinding
  mode?: RenderMode
  /** CSS scale applied to the whole label; the document stays in mm. */
  scale?: number
  issuedTo?: string
  className?: string
}) {
  const resolved = useMemo(() => resolveLabel(template, binding), [template, binding])
  const html = useMemo(
    () => buildLabelDocument(resolved, { mode, issuedTo }),
    [resolved, mode, issuedTo],
  )

  // 1mm ≈ 3.7795px at 96dpi. The iframe is sized in px from the label's own mm
  // so it never scrolls — a scrollbar inside the preview would misrepresent how
  // much fits on the stock, which is the one thing the preview is for.
  const PX_PER_MM = 3.7795
  const widthPx = resolved.size.widthMm * PX_PER_MM
  const heightPx = resolved.size.heightMm * PX_PER_MM + (mode === 'proof' ? 90 : 0)

  return (
    <div
      className={className}
      style={{ width: widthPx * scale, height: heightPx * scale, overflow: 'hidden' }}
    >
      <iframe
        title={`${template.name} preview`}
        srcDoc={html}
        sandbox=""
        scrolling="no"
        style={{
          width: widthPx,
          height: heightPx,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          display: 'block',
          colorScheme: 'light',
        }}
      />
    </div>
  )
}
