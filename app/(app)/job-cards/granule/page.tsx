'use client'

import { useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Send, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import SignaturePad from '@/components/ui/SignaturePad'

interface Form {
  customer: string; date_of_card: string; expected_commencement: string; job_card_no: string
  brown_dust: string; white_dust: string; alt: string; milled_material: string
  leaf_dust: string; oq_dust: string; powder_dust: string; is_dust: string
  ss_dust: string; brown_powder_dust: string; khoisan_dust: string
  product_name: string; total_mass: string; mass_per_bag_bin: string
  no_of_bags: string; packaging: string; batch_number: string
  bag_markings: string; local_or_export: string; palletised: string
  special_instructions: string
  sig_production_supervisor: string | null; sig_quality_officer: string | null; sig_production_manager: string | null
  submitted_at: string | null
}

const BLEND_FIELDS = [
  { label: 'Brown Dust',          key: 'brown_dust' },
  { label: 'White Dust',          key: 'white_dust' },
  { label: 'ALT',                 key: 'alt' },
  { label: 'Milled Material',     key: 'milled_material' },
  { label: 'Leaf dust',           key: 'leaf_dust' },
  { label: 'OQ dust',             key: 'oq_dust' },
  { label: 'Powder dust',         key: 'powder_dust' },
  { label: 'IS Dust',             key: 'is_dust' },
  { label: 'SS Dust',             key: 'ss_dust' },
  { label: 'Brown: Powder Dust',  key: 'brown_powder_dust' },
  { label: 'Khoisan Dust',        key: 'khoisan_dust' },
]

function empty(): Form {
  return {
    customer: '', date_of_card: format(new Date(), 'yyyy-MM-dd'), expected_commencement: 'NA', job_card_no: '',
    brown_dust: '', white_dust: '', alt: 'NA', milled_material: 'NA', leaf_dust: 'NA',
    oq_dust: 'NA', powder_dust: 'NA', is_dust: '', ss_dust: 'NA', brown_powder_dust: '', khoisan_dust: 'NA',
    product_name: '', total_mass: '', mass_per_bag_bin: '', no_of_bags: '', packaging: '',
    batch_number: '', bag_markings: 'serial number and date', local_or_export: 'Local', palletised: 'Bulk Bags',
    special_instructions: '',
    sig_production_supervisor: null, sig_quality_officer: null, sig_production_manager: null, submitted_at: null,
  }
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</label>{children}</div>
}

export default function GranuleJobCard() {
  const db = getDb()
  const [form, setForm] = useState<Form>(empty())
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const submitted = !!form.submitted_at
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save(submit = false) {
    setSaving(true)
    const payload = { ...form, submitted_at: submit ? new Date().toISOString() : form.submitted_at }
    if (savedId) { await db.from('job_cards_granule').update(payload).eq('id', savedId) }
    else { const { data } = await db.from('job_cards_granule').insert(payload).select('id').single(); if (data) setSavedId((data as any).id) }
    setSaving(false)
    if (submit) setForm(f => ({ ...f, submitted_at: new Date().toISOString() }))
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-24">
      <div className="card p-4 bg-brand text-white">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/50 mb-1">PR-FM-057/0 · Cape Natural Tea Products</p>
        <h1 className="font-display font-extrabold text-2xl">Granule Line Job Card</h1>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Job details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Customer"><input className="input" value={form.customer} onChange={set('customer')} disabled={submitted} /></F>
          <F label="Date of job card"><input type="date" className="input" value={form.date_of_card} onChange={set('date_of_card')} disabled={submitted} /></F>
          <F label="Expected commencement"><input className="input" value={form.expected_commencement} onChange={set('expected_commencement')} disabled={submitted} placeholder="NA" /></F>
          <F label="Job card no."><input className="input font-mono" value={form.job_card_no} onChange={set('job_card_no')} disabled={submitted} /></F>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Granule blend</p>
        <div className="divide-y divide-surface-rule">
          {BLEND_FIELDS.map(f => (
            <div key={f.key} className="flex items-center justify-between py-2.5 gap-4">
              <span className="text-[13px] text-text">{f.label}</span>
              <input className="input w-24 text-right font-mono" value={(form as any)[f.key]} onChange={set(f.key as any)} disabled={submitted} placeholder="NA" />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Batch details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Product name"><input className="input" value={form.product_name} onChange={set('product_name')} disabled={submitted} /></F>
          <F label="Batch number"><input className="input font-mono" value={form.batch_number} onChange={set('batch_number')} disabled={submitted} /></F>
          <F label="Total mass (kg)"><input className="input" value={form.total_mass} onChange={set('total_mass')} disabled={submitted} /></F>
          <F label="Mass per bag/bin"><input className="input" value={form.mass_per_bag_bin} onChange={set('mass_per_bag_bin')} disabled={submitted} /></F>
          <F label="No. of bags"><input className="input" value={form.no_of_bags} onChange={set('no_of_bags')} disabled={submitted} /></F>
          <F label="Packaging"><input className="input" value={form.packaging} onChange={set('packaging')} disabled={submitted} /></F>
          <F label="Bag markings"><input className="input" value={form.bag_markings} onChange={set('bag_markings')} disabled={submitted} /></F>
          <F label="Local or export"><select className="input" value={form.local_or_export} onChange={set('local_or_export')} disabled={submitted}><option>Local</option><option>Export</option></select></F>
          <F label="Palletised"><input className="input" value={form.palletised} onChange={set('palletised')} disabled={submitted} /></F>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Special instructions</p>
        <textarea className="input resize-none" rows={4} value={form.special_instructions} onChange={set('special_instructions')} disabled={submitted} placeholder="e.g. Moisture 9.2% · 12 Mesh and 40 Mesh…" />
      </div>

      <div className="card p-4 space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Sign-offs</p>
        {[
          { label: 'Production Supervisor',       key: 'sig_production_supervisor' },
          { label: 'Quality Officer / Controller', key: 'sig_quality_officer' },
          { label: 'Production Manager',           key: 'sig_production_manager' },
        ].map(s => (
          <SignaturePad key={s.key} label={s.label} name={s.label} value={(form as any)[s.key]}
            onChange={(val: string | null) => setForm(f => ({ ...f, [s.key]: val }))} disabled={submitted} />
        ))}
      </div>

      {submitted && (
        <div className="flex items-center gap-3 p-4 bg-ok-bg border border-ok/30 rounded-xl">
          <CheckCircle2 size={20} className="text-status-ok" />
          <p className="font-semibold text-text">Job card submitted ✓</p>
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface-card border-t border-surface-rule z-20">
        <div className="max-w-3xl mx-auto flex gap-3">
          <button onClick={() => save(false)} disabled={saving}
            className="flex items-center gap-2 px-4 py-3 border border-surface-rule rounded-xl font-semibold text-sm text-text-muted hover:bg-surface">
            <Save size={16} /> {saving ? 'Saving…' : 'Save draft'}
          </button>
          {!submitted && (
            <button onClick={() => save(true)} disabled={!form.sig_production_supervisor || saving}
              className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-base',
                form.sig_production_supervisor ? 'bg-brand text-white hover:opacity-90' : 'bg-surface-rule text-text-faint cursor-not-allowed')}>
              <Send size={16} /> {form.sig_production_supervisor ? 'Submit job card' : 'Supervisor signature required'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}