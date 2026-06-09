// app/api/axis/projects/[id]/brief/route.ts
// Generates a Word (.docx) Project Brief for any AXIS project.
// Called by n8n after project approval to upload to OneDrive.
// Also callable directly from the project detail page for manual download.

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/auth/server-helpers'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, HeadingLevel, LevelFormat, ExternalHyperlink,
} from 'docx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const BORDER_LINE = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' }
const BORDER_ACCENT = { style: BorderStyle.SINGLE, size: 12, color: '1B3A6B' }

const cellBorders = {
  top: BORDER_LINE, bottom: BORDER_LINE, left: BORDER_NONE, right: BORDER_NONE,
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}
function today() {
  return new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'
}

// ─── Document components ───────────────────────────────────────────────────────

function spacer(pt = 200) {
  return new Paragraph({ spacing: { before: pt, after: 0 }, children: [] })
}

function sectionHeading(text: string) {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1B3A6B', space: 4 } },
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: '1B3A6B' })],
  })
}

function labelValue(label: string, value: string, colWidths: [number, number] = [2800, 6200]) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: colWidths,
    borders: { top: BORDER_NONE, bottom: BORDER_LINE, left: BORDER_NONE, right: BORDER_NONE, insideH: BORDER_NONE, insideV: BORDER_NONE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: colWidths[0], type: WidthType.DXA },
            borders: { ...cellBorders, bottom: BORDER_LINE },
            margins: { top: 80, bottom: 80, left: 0, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: '64748B' })] })],
          }),
          new TableCell({
            width: { size: colWidths[1], type: WidthType.DXA },
            borders: { ...cellBorders, bottom: BORDER_LINE },
            margins: { top: 80, bottom: 80, left: 120, right: 0 },
            children: [new Paragraph({ children: [new TextRun({ text: value || '—', font: 'Arial', size: 20, color: '1E293B' })] })],
          }),
        ],
      }),
    ],
  })
}

function bodyText(text: string, italic = false) {
  return new Paragraph({
    spacing: { before: 80, after: 80, line: 360 },
    children: [new TextRun({ text: text || '—', font: 'Arial', size: 20, color: '334155', italics: italic })],
  })
}

function badgeRow(items: { label: string; value: string; color: string }[]) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: items.map(() => Math.floor(9000 / items.length)),
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideH: BORDER_NONE, insideV: BORDER_NONE },
    rows: [
      new TableRow({
        children: items.map(item =>
          new TableCell({
            width: { size: Math.floor(9000 / items.length), type: WidthType.DXA },
            shading: { fill: item.color, type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.label, font: 'Arial', size: 16, bold: true, color: '64748B' })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.value, font: 'Arial', size: 22, bold: true, color: '1E293B' })] }),
            ],
          })
        ),
      }),
    ],
  })
}

function checkItem(label: string, checked: boolean) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      new TextRun({ text: checked ? '☑  ' : '☐  ', font: 'Arial', size: 20, color: checked ? '16A34A' : 'DC2626' }),
      new TextRun({ text: label, font: 'Arial', size: 20, color: checked ? '1E293B' : '64748B' }),
    ],
  })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const axis = (getAdminClient() as any).schema('axis')

  // Load project + request
  const { data: project, error: projErr } = await axis
    .from('projects')
    .select('*, project_tracks(*)')
    .eq('id', id)
    .single()

  if (projErr || !project)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: request } = await axis
    .from('project_requests')
    .select('*')
    .eq('id', project.request_id)
    .single()

  const isCode = request?.submission_type === 'code_contribution'
  const tracks: string[] = (project.project_tracks || []).map((t: any) => cap(t.track_type))
  const code = project.project_code || 'PRJ-???'

  // ── Priority colours ────────────────────────────────────────────────────────
  const priorityColor = project.priority === 'high' ? 'FEE2E2' : project.priority === 'mid' ? 'FEF3C7' : 'F0FDF4'
  const riskColor     = isCode ? 'FEF3C7' : 'F0FDF4'

  // ── Build document ──────────────────────────────────────────────────────────
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'tracks',
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },

      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1B3A6B', space: 4 } },
              tabStops: [{ type: 'right' as any, position: 9000 }],
              children: [
                new TextRun({ text: 'CAPE NATURAL TEA PRODUCTS', font: 'Arial', size: 16, bold: true, color: '1B3A6B' }),
                new TextRun({ text: '\tIT DEPARTMENT — CONFIDENTIAL', font: 'Arial', size: 16, color: '94A3B8' }),
              ],
            }),
          ],
        }),
      },

      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 4 } },
              tabStops: [{ type: 'right' as any, position: 9000 }],
              children: [
                new TextRun({ text: `${code} — ${project.name}`, font: 'Arial', size: 16, color: '94A3B8' }),
                new TextRun({ text: '\tPage ', font: 'Arial', size: 16, color: '94A3B8' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: '94A3B8' }),
              ],
            }),
          ],
        }),
      },

      children: [

        // ── Cover block ──────────────────────────────────────────────────────
        spacer(400),

        new Paragraph({
          children: [new TextRun({ text: 'PROJECT BRIEF', font: 'Arial', size: 48, bold: true, color: '1B3A6B' })],
        }),

        new Paragraph({
          spacing: { before: 120, after: 0 },
          children: [new TextRun({ text: code, font: 'Arial Narrow', size: 52, bold: true, color: '94A3B8' })],
        }),

        new Paragraph({
          spacing: { before: 60, after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: '1B3A6B', space: 4 } },
          children: [new TextRun({ text: project.name, font: 'Arial', size: 40, bold: true, color: '1E293B' })],
        }),

        spacer(200),

        badgeRow([
          { label: 'STATUS',   value: cap(project.status),      color: 'EFF6FF' },
          { label: 'PRIORITY', value: cap(project.priority),    color: priorityColor },
          { label: 'TERM',     value: cap(project.term),        color: 'F8FAFC' },
          { label: 'EFFORT',   value: project.effort_size || '—', color: 'F8FAFC' },
          { label: 'TYPE',     value: isCode ? 'Code Contribution' : 'Feature Request', color: isCode ? 'FFFBEB' : 'F0FDF4' },
        ]),

        spacer(160),

        labelValue('Date Generated', today()),
        labelValue('Target Start',   fmt(project.target_start)),
        labelValue('Target End',     fmt(project.target_end)),
        labelValue('Hard Deadline',  project.hard_deadline ? 'Yes' + (project.deadline_reason ? ` — ${project.deadline_reason}` : '') : 'No'),
        labelValue('Approved',       fmt(project.approved_at)),

        spacer(80),

        // ── Project Description ──────────────────────────────────────────────
        sectionHeading('1. Project Description'),
        bodyText(project.description),

        // ── Business Justification ───────────────────────────────────────────
        sectionHeading('2. Business Justification'),
        bodyText(request?.business_justification || project.description),

        // ── Project Tracks ───────────────────────────────────────────────────
        sectionHeading('3. Project Tracks'),
        ...tracks.map(t => new Paragraph({
          numbering: { reference: 'tracks', level: 0 },
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: t, font: 'Arial', size: 20, color: '1E293B' })],
        })),

        // ── Code Contribution section ─────────────────────────────────────────
        ...(isCode ? [
          sectionHeading('4. Code Contribution Details'),

          labelValue('Submitted By',  request?.code_author || '—'),
          labelValue('AI Generated',  request?.code_source === 'ai_generated'
            ? `Yes — ${request?.ai_tool_used || 'AI tool not specified'}`
            : 'No — written manually'),
          labelValue('Target Schema', request?.schema_proposal?.schema_name || '—'),
          labelValue('Tables Affected', request?.schema_proposal?.tables_affected || '—'),

          ...(request?.onedrive_url ? [
            spacer(80),
            new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [
                new TextRun({ text: 'Code Files (OneDrive): ', font: 'Arial', size: 20, bold: true, color: '64748B' }),
                new ExternalHyperlink({
                  link: request.onedrive_url,
                  children: [new TextRun({ text: 'Open folder', font: 'Arial', size: 20, color: '1B3A6B', underline: {} })],
                }),
              ],
            }),
          ] : []),

          sectionHeading('5. IT Audit Sign-Off'),
          bodyText('The following items were confirmed by IT before this contribution was approved:', true),
          spacer(80),
          ...Object.entries(request?.it_audit_checklist || {}).map(([key, val]) =>
            checkItem(key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), !!val)
          ),
          ...(Object.keys(request?.it_audit_checklist || {}).length === 0 ? [
            bodyText('IT audit checklist not recorded.', true),
          ] : []),
        ] : []),

        // ── Signature block ───────────────────────────────────────────────────
        sectionHeading(isCode ? '6. Sign-Off' : '4. Sign-Off'),
        spacer(200),

        new Table({
          width: { size: 9000, type: WidthType.DXA },
          columnWidths: [4200, 600, 4200],
          borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideH: BORDER_NONE, insideV: BORDER_NONE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 4200, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_LINE, left: BORDER_NONE, right: BORDER_NONE },
                  margins: { top: 0, bottom: 80, left: 0, right: 0 },
                  children: [new Paragraph({ children: [] })],
                }),
                new TableCell({
                  width: { size: 600, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
                  children: [new Paragraph({ children: [] })],
                }),
                new TableCell({
                  width: { size: 4200, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_LINE, left: BORDER_NONE, right: BORDER_NONE },
                  margins: { top: 0, bottom: 80, left: 0, right: 0 },
                  children: [new Paragraph({ children: [] })],
                }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 4200, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
                  children: [new Paragraph({ children: [new TextRun({ text: 'IT Department — Alyssa Krishna', font: 'Arial', size: 18, color: '64748B' })] })],
                }),
                new TableCell({
                  width: { size: 600, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
                  children: [new Paragraph({ children: [] })],
                }),
                new TableCell({
                  width: { size: 4200, type: WidthType.DXA },
                  borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
                  children: [new Paragraph({ children: [new TextRun({ text: 'Date', font: 'Arial', size: 18, color: '64748B' })] })],
                }),
              ],
            }),
          ],
        }),

        spacer(400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 0 },
          children: [new TextRun({ text: 'Cape Natural Tea Products — IT Department — Confidential', font: 'Arial', size: 16, color: 'CBD5E1', italics: true })],
        }),
      ],
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `${code}_${project.name.replace(/[^a-zA-Z0-9]/g, '-')}_Brief.docx`

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
