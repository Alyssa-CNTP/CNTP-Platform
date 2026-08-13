'use client'

// components/notebooks/NotePaper.tsx
// One page of a GRN / Delivery Note book, laid out the way the physical book
// is: address block and note number across the top, the ruled QTY / WEIGHT /
// DESCRIPTION table down the middle, the certification stamp beside it, and
// the two acknowledgement panels along the bottom.
//
// The same component is what you see on screen and what comes out of the
// printer — there is no second "print template" to drift out of sync. It is
// deliberately styled with inline styles and plain hex colours rather than the
// app's design tokens: this is a document, not app chrome, and it has to look
// identical on paper, in a PDF and in whatever the recipient opens it with.

import {
  type NotebookDocWithLines, type DocType,
  COMPANY, DOC_TYPE_LABELS, DOC_TYPE_AF, PARTY_LABEL, CERT_ROWS,
  SIGN_BLOCK_LABELS, SIGN_BLOCK_DECLARATION, hasAnyCert, totalQty, totalWeightKg,
  type SignBlock,
} from '@/lib/notebooks/types'

export interface SignatureOnPaper {
  signerName: string
  signedAt:   string
  image:      string | null
}

interface Props {
  doc:        NotebookDocWithLines
  signatures?: Partial<Record<SignBlock, SignatureOnPaper | null>>
  /** Blank rows are what makes it read as a book page rather than a receipt. */
  minRows?:   number
}

const INK = '#111111'
const RULE = '#111111'
const MUTED = '#4a4a4a'

function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return ''
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtNum(n: number | null | undefined, suffix = '') {
  if (n == null) return ''
  const v = Number(n)
  if (Number.isNaN(v)) return ''
  return `${v.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}${suffix}`
}

export default function NotePaper({ doc, signatures, minRows = 8 }: Props) {
  const type = doc.doc_type as DocType
  const rows = [...doc.lines]
  while (rows.length < minRows) rows.push(null as any)

  return (
    <div
      className="notebook-paper"
      style={{
        background: '#fff', color: INK, border: `1.5px solid ${RULE}`,
        padding: '14px 16px 16px', fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 11, lineHeight: 1.35, position: 'relative',
      }}
    >
      {doc.status === 'void' && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 2,
          }}
        >
          <span style={{
            transform: 'rotate(-22deg)', fontSize: 76, fontWeight: 800, letterSpacing: 8,
            color: 'rgba(184,28,28,0.16)', border: '5px solid rgba(184,28,28,0.16)',
            padding: '4px 26px', borderRadius: 8,
          }}>VOID</span>
        </div>
      )}

      {/* ── Letterhead ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: '30%', fontSize: 8.5, lineHeight: 1.45, color: MUTED }}>
          <div>{COMPANY.poBox}</div>
          <div>{COMPANY.line1}</div>
          <div>{COMPANY.line2}</div>
          <div>{COMPANY.line3}</div>
          <div>{COMPANY.tel}</div>
          <div>{COMPANY.fax}</div>
        </div>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Cape Natural Tea Products" style={{ height: 62, width: 'auto', objectFit: 'contain' }} />
        </div>

        <div style={{ width: '34%', textAlign: 'right' }}>
          {/* The number in the top-right corner in red, exactly where the
              pre-printed number sits on the paper book. No "GRN"/"DN" label
              in front of it — the number already carries both the site and
              the book it came out of. */}
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: '#d0021b', letterSpacing: 0.5, fontFamily: 'monospace' }}>
              {doc.doc_no}
            </span>
          </div>
          <div style={{ fontSize: 8.5, lineHeight: 1.45, color: MUTED }}>
            <div>{COMPANY.vat}</div>
            <div>{COMPANY.reg}</div>
            <div>{COMPANY.email}</div>
            <div>{COMPANY.website}</div>
          </div>
        </div>
      </div>

      {/* ── Title ── */}
      <div style={{ textAlign: 'center', margin: '10px 0 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {DOC_TYPE_LABELS[type]}
        </div>
        <div style={{ fontSize: 9, color: MUTED, fontStyle: 'italic', marginTop: 1 }}>
          {DOC_TYPE_AF[type]}
        </div>
      </div>

      {/* ── Header fields ── */}
      <div style={{ marginBottom: 10 }}>
        <Field label={PARTY_LABEL[type]} value={doc.party_name} />
        <Field label="Name of store goods delivered at" value={doc.delivered_at_store} />
        <Field label="Our purchase order no." value={doc.purchase_order_no} />
        <Field label="Weighbridge no." value={doc.weighbridge_no} />
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}><Field label="Date" value={fmtDate(doc.doc_date)} /></div>
          <div style={{ flex: 1 }}><Field label="Vehicle reg." value={doc.vehicle_reg} /></div>
        </div>
        {(doc.lot_no || doc.batch_no || doc.producer_lot_no || doc.farmer_name || doc.season_year) && (
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}><Field label="Lot no." value={doc.lot_no} /></div>
            <div style={{ flex: 1 }}><Field label="Batch no." value={doc.batch_no} /></div>
            <div style={{ flex: 1 }}><Field label="Producer lot" value={doc.producer_lot_no} /></div>
          </div>
        )}
        {(doc.farmer_name || doc.season_year) && (
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}><Field label="Farmer / tea court" value={doc.farmer_name} /></div>
            <div style={{ flex: 1 }}><Field label="Season" value={doc.season_year ? String(doc.season_year) : null} /></div>
          </div>
        )}
      </div>

      {/* ── Ruled table + certification stamp ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <table style={{ flex: 1, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <Th style={{ width: '16%' }}>QTY</Th>
              <Th style={{ width: '24%' }}>WEIGHT</Th>
              <Th>DESCRIPTION</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l?.id ?? `blank-${i}`}>
                <Td align="center">{l ? fmtNum(l.qty) : ''}</Td>
                <Td align="center">{l ? fmtNum(l.weight_kg, ' kg') : ''}</Td>
                <Td>
                  {l?.description ?? ''}
                  {l?.lot_no && <span style={{ color: MUTED }}>{'  ·  Lot '}{l.lot_no}</span>}
                  {l?.batch_no && <span style={{ color: MUTED }}>{'  ·  Batch '}{l.batch_no}</span>}
                </Td>
              </tr>
            ))}
            {doc.lines.length > 0 && (
              <tr>
                <Td align="center" bold>{fmtNum(totalQty(doc.lines))}</Td>
                <Td align="center" bold>{fmtNum(totalWeightKg(doc.lines), ' kg')}</Td>
                <Td bold>TOTAL</Td>
              </tr>
            )}
          </tbody>
        </table>

        {hasAnyCert(doc) && <CertificationStamp doc={doc} />}
      </div>

      {doc.notes && (
        <div style={{ marginTop: 8, fontSize: 9.5 }}>
          <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 8.5, letterSpacing: 0.4 }}>Notes: </span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{doc.notes}</span>
        </div>
      )}

      {/* ── Acknowledgement panels ── */}
      <div style={{ display: 'flex', marginTop: 12, border: `1.5px solid ${RULE}` }}>
        <AckPanel
          title={SIGN_BLOCK_LABELS[type].received}
          declaration={SIGN_BLOCK_DECLARATION[type].received}
          name={doc.received_by_name}
          at={doc.received_at}
          signature={signatures?.received ?? null}
        />
        <div style={{ width: 1.5, background: RULE }} />
        <AckPanel
          title={SIGN_BLOCK_LABELS[type].transporter}
          declaration={SIGN_BLOCK_DECLARATION[type].transporter}
          name={doc.transporter_name ?? doc.driver_name}
          at={doc.transporter_at}
          signature={signatures?.transporter ?? null}
        />
      </div>

      <div style={{ marginTop: 6, fontSize: 7.5, color: MUTED, display: 'flex', justifyContent: 'space-between' }}>
        <span>{COMPANY.name}</span>
        <span>
          {doc.status === 'draft' ? 'DRAFT — not yet issued' : doc.status === 'void' ? `VOID${doc.void_reason ? ` — ${doc.void_reason}` : ''}` : `Issued ${fmtDateTime(doc.issued_at)}`}
          {doc.created_by_name ? ` · Captured by ${doc.created_by_name}` : ''}
        </span>
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
        {label}:
      </span>
      <span style={{ flex: 1, borderBottom: `1px dotted ${INK}`, minHeight: 13, fontSize: 11 }}>
        {value || ''}
      </span>
    </div>
  )
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{
      border: `1px solid ${RULE}`, padding: '4px 6px', fontSize: 9, fontWeight: 700,
      letterSpacing: 0.6, textAlign: 'center', ...style,
    }}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left', bold = false }: { children: React.ReactNode; align?: 'left' | 'center'; bold?: boolean }) {
  return (
    <td style={{
      border: `1px solid ${RULE}`, padding: '4px 6px', height: 20, fontSize: 10.5,
      textAlign: align, fontWeight: bold ? 700 : 400, verticalAlign: 'middle',
    }}>
      {children}
    </td>
  )
}

// The stamp that goes on the note when the load carries a certification —
// same rows, same tick column as the rubber stamp used on the paper GRNs.
function CertificationStamp({ doc }: { doc: NotebookDocWithLines }) {
  return (
    <div style={{ width: 176, border: `1.5px solid ${RULE}`, flexShrink: 0 }}>
      <div style={{
        textAlign: 'center', fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6,
        padding: '3px 0', borderBottom: `1px solid ${RULE}`,
      }}>
        CERTIFICATION STATUS
      </div>
      {CERT_ROWS.map(row => (
        <div key={row.key} style={{ display: 'flex', borderBottom: `1px solid ${RULE}`, minHeight: 22 }}>
          <div style={{ flex: 1, padding: '3px 5px' }}>
            <div style={{ fontSize: 9, fontWeight: 700 }}>{row.label}</div>
            {row.sub && <div style={{ fontSize: 6.5, color: MUTED, lineHeight: 1.2 }}>{row.sub}</div>}
          </div>
          <div style={{
            width: 26, borderLeft: `1px solid ${RULE}`, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
          }}>
            {doc[row.key] ? '✓' : ''}
          </div>
        </div>
      ))}
      {(doc.cert_control_union_no || doc.cert_eu_org_code) && (
        <div style={{ padding: '3px 5px', fontSize: 7 }}>
          {doc.cert_control_union_no && <div>CU: {doc.cert_control_union_no}</div>}
          {doc.cert_eu_org_code && <div>EU: {doc.cert_eu_org_code}</div>}
        </div>
      )}
    </div>
  )
}

function AckPanel({ title, declaration, name, at, signature }: {
  title: string
  declaration: string
  name: string | null | undefined
  at: string | null | undefined
  signature: SignatureOnPaper | null
}) {
  return (
    <div style={{ flex: 1, padding: '6px 8px 8px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}:</div>
      <div style={{ fontSize: 7, color: MUTED, marginBottom: 5 }}>{declaration}</div>

      <Field label="Name" value={signature?.signerName ?? name} />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Signature:</span>
        <span style={{ flex: 1, borderBottom: `1px dotted ${INK}`, minHeight: 26, display: 'flex', alignItems: 'flex-end' }}>
          {signature?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signature.image} alt={`${signature.signerName} signature`} style={{ height: 26, width: 'auto', objectFit: 'contain' }} />
          )}
        </span>
      </div>

      <Field label="Date & time" value={signature ? fmtDateTime(signature.signedAt) : fmtDateTime(at)} />

      {signature && (
        <div style={{ fontSize: 6.5, color: MUTED, marginTop: 2 }}>
          Signed electronically · verified against the signer&apos;s identity
        </div>
      )}
    </div>
  )
}
