'use client'

// app/(app)/axis/standards/page.tsx
// Technical Standards & Development Protocol — CNTP Operations Platform
// Visible to all authenticated users. IT can always reference this with contributors.

import { useState } from 'react'
import { Shield, Database, GitBranch, Server, Code2, FileCheck, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

// ─── Standards Data ────────────────────────────────────────────────────────────

const STANDARDS = [
  {
    key: 'schemas',
    icon: Database,
    color: '#4f46e5',
    bg: '#eef2ff',
    title: 'Schema & Database Standards',
    badge: 'MANDATORY',
    badgeColor: '#dc2626',
    rules: [
      {
        rule: 'Every module has a named schema — agreed upfront, before any code is written.',
        detail: 'Schemas follow the department naming convention: qms, logistics, dispatch, axis, sales, agriculture, etc. No exceptions. If a schema does not exist yet, raise a request in AXIS before building.',
      },
      {
        rule: 'No new tables in the public schema.',
        detail: 'The public schema is legacy — read-only reference for historical data. All new tables go into the correct department schema. Writing to public will be rejected at review.',
      },
      {
        rule: 'Every schema change requires a migration SQL script.',
        detail: 'Before any table is created or altered in production, a clean, reversible SQL migration script must be written and attached to the AXIS request via OneDrive. This script is reviewed and approved before execution.',
      },
      {
        rule: 'Foreign keys must reference auth.users(id) for user-linked records.',
        detail: 'The public schema used text fields for created_by. All new schemas use uuid with FK to auth.users(id). This enables proper RLS and audit trails.',
      },
      {
        rule: 'Column naming follows snake_case throughout.',
        detail: 'No camelCase column names. No abbreviations that aren\'t obvious. Be explicit: created_by not cb, batch_number not batch_no (in new tables).',
      },
    ],
  },
  {
    key: 'environments',
    icon: Server,
    color: '#0891b2',
    bg: '#ecfeff',
    title: 'Environment & Deployment Standards',
    badge: 'MANDATORY',
    badgeColor: '#dc2626',
    rules: [
      {
        rule: 'Staging and production are always separate Supabase projects.',
        detail: 'Under no circumstances does the staging deployment share a database with production. Separate project, separate credentials, separate data. This is non-negotiable.',
      },
      {
        rule: 'All changes are tested on staging before production.',
        detail: 'No code goes to production without first being verified on the staging environment. Evidence of staging test (screenshot or confirmation note) is required in the AXIS change log before production approval.',
      },
      {
        rule: 'Environment variables are never hardcoded.',
        detail: 'API keys, service role keys, database URLs, and any secrets live in .env.local (staging) or PM2 ecosystem (production). They are never committed to code. Any submission containing hardcoded credentials is immediately rejected.',
      },
      {
        rule: 'Production deployments require a logged AXIS change record.',
        detail: 'Every deployment to production must have a corresponding entry in the AXIS Changelog with environment set to "production" and risk level assessed. High/critical risk requires reviewer sign-off before deployment.',
      },
    ],
  },
  {
    key: 'contributions',
    icon: GitBranch,
    color: '#d97706',
    bg: '#fffbeb',
    title: 'Code Contribution Protocol',
    badge: 'READ CAREFULLY',
    badgeColor: '#d97706',
    rules: [
      {
        rule: 'All code contributions — including AI-generated code — must go through AXIS before integration.',
        detail: 'If you have written code (with Claude, Cursor, Copilot, or otherwise) that you want added to this platform, you do not send it directly to anyone. You submit a Code Contribution request in AXIS. IT reviews it. Integration only happens after formal approval.',
      },
      {
        rule: 'AI-generated code must be declared.',
        detail: 'If any part of the submitted code was generated or significantly assisted by an AI tool, this must be declared in the submission — which tool was used and what it generated. This is not to discourage AI use; it is to ensure the reviewing IT specialist understands the code fully before integrating it.',
      },
      {
        rule: 'Code is submitted via OneDrive — not zip files, not WhatsApp, not email attachments.',
        detail: 'All code files go into the designated CNTP IT OneDrive folder. A link to that folder is attached to your AXIS submission. Anything sent outside this process will be returned with a request to go through AXIS.',
      },
      {
        rule: 'Code contributions are not a guarantee of integration.',
        detail: 'Submitting code does not mean it will be integrated. IT reserves the right to rewrite, refactor, or reject any contribution that does not meet the technical standards defined here. The business need may be valid even if the implementation is not.',
      },
      {
        rule: 'The submitter completes the pre-flight checklist — IT completes the audit checklist.',
        detail: 'The AXIS Code Contribution form contains a mandatory pre-flight checklist that must be completed by the submitter before submission. IT completes a separate audit checklist before approval. Neither checklist can be bypassed.',
      },
    ],
  },
  {
    key: 'code_quality',
    icon: Code2,
    color: '#059669',
    bg: '#f0fdf4',
    title: 'Code Quality & File Standards',
    badge: 'REQUIRED',
    badgeColor: '#059669',
    rules: [
      {
        rule: 'File encoding is UTF-8 without BOM.',
        detail: 'All source files must be saved as UTF-8 without Byte Order Mark. This is the default in VS Code (verify under File → Preferences → Settings → "files.encoding": "utf8"). PowerShell\'s Set-Content corrupts encoding — never use it on source files.',
      },
      {
        rule: 'No emoji or special characters in variable names, function names, or comments that will be programmatically processed.',
        detail: 'Emoji in JSX string literals (UI labels) is acceptable if the file encoding is correct. Emoji in code logic, variable names, or API responses is not.',
      },
      {
        rule: 'TypeScript — no use of `any` unless explicitly justified.',
        detail: 'The platform uses TypeScript. Using `any` to avoid typing is not acceptable in new code. If you are unsure of a type, define an interface. Existing legacy code with `any` is being progressively typed.',
      },
      {
        rule: 'No dead code, commented-out blocks, or console.log in submissions.',
        detail: 'Code submitted for integration must be clean. Remove debugging statements, commented-out experiments, and unused imports before submission.',
      },
    ],
  },
  {
    key: 'api',
    icon: FileCheck,
    color: '#7c3aed',
    bg: '#faf5ff',
    title: 'API & Integration Patterns',
    badge: 'REQUIRED',
    badgeColor: '#7c3aed',
    rules: [
      {
        rule: 'No external backend servers. All API logic lives in Next.js API routes.',
        detail: 'The platform is a unified Next.js application. There is no Express server, no separate Node backend. If you need a server-side operation, it is a Next.js API route under app/api/. References to NEXT_PUBLIC_API_URL pointing to a separate server are not accepted in new code.',
      },
      {
        rule: 'The Supabase service role key is server-side only.',
        detail: 'The service role key bypasses RLS. It must never appear in client-side code. It only lives in API routes (app/api/) using the admin client from lib/supabase/admin.ts. Browser-facing code uses the anon key via the standard client.',
      },
      {
        rule: 'RLS policies must be defined for every new table.',
        detail: 'A table without RLS is a security liability. Every new table must have appropriate RLS policies defined in the migration script. The default is deny-all — policies are explicitly granted, never assumed.',
      },
      {
        rule: 'Reads from the public schema for legacy data go through the /api/quality/legacy-public service-role route — not the browser client.',
        detail: 'The public schema tables have RLS. The browser anon/authenticated client cannot read them. Legacy data is served through the dedicated server-side API route that uses the service role key.',
      },
    ],
  },
  {
    key: 'axis_process',
    icon: Shield,
    color: '#be185d',
    bg: '#fdf2f8',
    title: 'The AXIS Process — Required for All Development Work',
    badge: 'ALWAYS',
    badgeColor: '#be185d',
    rules: [
      {
        rule: 'All development work — new features, changes, bug fixes, and integrations — is logged in AXIS before it starts.',
        detail: 'If it is not in AXIS, it does not officially exist. This applies to work done internally and work submitted by external contributors. AXIS is the single source of truth for what is being built, why, and by whom.',
      },
      {
        rule: 'IT is the integration authority. Nobody else integrates code into the platform.',
        detail: 'Other team members using AI tools to generate code is encouraged — but the integration of that code is an IT responsibility. Bypassing this process adds technical debt and risk to a production system that supports business operations.',
      },
      {
        rule: 'Every production change has a corresponding AXIS Changelog entry.',
        detail: 'The changelog is the audit trail. It records what changed, when, where (environment), why, the risk level, and who reviewed it. This is non-negotiable for production. Staging entries are encouraged but not always mandatory.',
      },
    ],
  },
]

// ─── Pre-flight Checklist (for submitter reference) ───────────────────────────

const PREFLIGHT_ITEMS = [
  'Code is placed on a named branch or isolated folder — not mixed with other changes',
  'Target schema name follows department naming convention (e.g. qms, logistics)',
  'All new tables are in the department schema — NOT in public',
  'File encoding is UTF-8 without BOM (verified in editor settings)',
  'No API keys, passwords, or secrets are hardcoded in the files',
  'OneDrive link has been added with all code files accessible',
  'The change is described in the AXIS Changelog',
]

// ─── IT Audit Checklist (reference) ──────────────────────────────────────────

const IT_AUDIT_ITEMS = [
  'Schema name verified — correct department schema, not public',
  'No writes to the public schema in any of the submitted code',
  'File encoding verified as UTF-8 without BOM',
  'No hardcoded credentials, API keys, or secrets found',
  'Database migration script is clean, reversible, and reviewed',
  'OneDrive files downloaded and code logic reviewed for correctness',
  'RLS policies defined for all new tables',
  'Staging test plan confirmed before production approval',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function StandardsPage() {
  const [open, setOpen] = useState<string | null>('contributions')

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="card overflow-hidden">
        <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <div className="font-mono text-[10px] text-indigo-300 uppercase tracking-widest">CNTP Operations Platform</div>
              <h1 className="font-display font-bold text-[20px] text-white">Technical Standards & Development Protocol</h1>
            </div>
          </div>
          <p className="text-[13px] text-indigo-200 leading-relaxed">
            This document defines the non-negotiable standards for all development work on the CNTP Operations Platform.
            All contributors — internal and external — are expected to read and adhere to these standards.
            Submissions that do not comply will be returned without integration.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-300" />
            <span className="text-[11px] text-amber-300 font-semibold">
              Ignorance of these standards is not an acceptable reason for non-compliance.
            </span>
          </div>
        </div>
      </div>

      {/* Standards sections */}
      {STANDARDS.map(s => {
        const Icon = s.icon
        const isOpen = open === s.key
        return (
          <div key={s.key} className="card overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : s.key)}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-raised transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: s.bg }}>
                <Icon size={17} style={{ color: s.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[14px] text-text">{s.title}</span>
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded-full font-bold text-white"
                    style={{ background: s.badgeColor }}>
                    {s.badge}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">{s.rules.length} rules</p>
              </div>
              <div className="text-text-faint flex-shrink-0">
                {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-surface-rule px-5 pb-5 pt-4 space-y-4">
                {s.rules.map((r, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-mono text-[11px] font-bold text-white"
                      style={{ background: s.color, minWidth: 24 }}>
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-semibold text-[13px] text-text">{r.rule}</p>
                      <p className="text-[12px] text-text-muted mt-1 leading-relaxed">{r.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Code Contribution Checklists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Pre-flight */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <FileCheck size={14} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-[13px] text-text">Submitter Pre-Flight Checklist</p>
              <p className="text-[10px] text-text-muted">For Code Contribution submissions</p>
            </div>
          </div>
          <div className="space-y-2">
            {PREFLIGHT_ITEMS.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="w-4 h-4 rounded border-2 border-amber-300 bg-amber-50 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-text leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-faint mt-3 italic">All boxes must be checked before submitting.</p>
        </div>

        {/* IT Audit */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
              <Shield size={14} className="text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-[13px] text-text">IT Audit Checklist</p>
              <p className="text-[10px] text-text-muted">Completed by IT before approving</p>
            </div>
          </div>
          <div className="space-y-2">
            {IT_AUDIT_ITEMS.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="w-4 h-4 rounded border-2 border-purple-300 bg-purple-50 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-text leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-faint mt-3 italic">All boxes must be confirmed before approval is granted.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="card px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-semibold text-[13px] text-text">Questions about these standards?</p>
          <p className="text-[11px] text-text-muted mt-0.5">Raise a request in AXIS or contact the IT department directly.</p>
        </div>
        <div className="flex gap-2">
          <a href="https://rooibostea-my.sharepoint.com/:f:/g/personal/alyssa_rooibostea_co_za/IgDLZGtgLpGeSpaNKueL9IU1AflyZKQ5hHZaMmFm0igaN7E?e=IJrIS1"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-surface-rule bg-surface text-[12px] text-text-muted font-semibold hover:bg-surface-card transition-colors">
            <ExternalLink size={12} /> CNTP IT OneDrive
          </a>
          <a href="/axis/request"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-[12px] font-semibold hover:bg-brand-hover transition-colors">
            <ExternalLink size={12} /> Submit a request
          </a>
        </div>
      </div>
    </div>
  )
}
