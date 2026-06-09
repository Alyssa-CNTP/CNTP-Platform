'use client'

import { useState } from 'react'
import { getDb } from '@/lib/supabase/db'
import { format } from 'date-fns'
import { Save, Send, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import SignaturePad from '@/components/ui/SignaturePad'

interface Form {
  customer: string; date_of_card: string; expected_commencement: string
  job_card_no: string; item_no: string; blend_description: string
  fine_leaf_export_a_kg: string; fine_leaf_export_a_pct: string
  fine_leaf_blend_b_kg: string; fine_leaf_blend_b_pct: string
  cut_block_kg: string; cut_block_pct: string
  clean_block_kg: string; clean_block_pct: string; total_blend_size: string
  fp_fine_leaf_export_a_pct: string; fp_fine_leaf_blend_b_pct: string
  fp_sg_granules_pct: string
  fp_cut_coarse_leaf_a_pct: string; fp_cut_coarse_leaf_b_pct: string; fp_cut_coarse_leaf_c_pct: string
  fp_fine_granule_pct: string
  product_name: string; total_mass: string; weight_per_bulk_bag: string
  no_of_bags: string; packaging: string; batch_number: string
  customer_po: string; bag_markings: string; local_or_export: string; palletised: string
  debagging_hopper_inverter: string; debagging_hopper_manual: string
  steriliser_inverter: string; post_sieve_plate_size: string; product_temp_at_pasteuriser: string
  special_instructions: string; rework_material: string
  sig_production_coordinator: string | null; sig_production_supervisor: string | null
  sig_quality_officer: string | null; sig_production_manager: string | null
  submitted_at: string | null
}

function empty(): Form {
  return {
    customer: '', date_of_card: format(new Date(), 'yyyy-MM-dd'), expected_commencement: '', job_card_no: '', item_no: '',
    blend_description: '', fine_leaf_export_a_kg: '', fine_leaf_export_a_pct: '', fine_leaf_blend_b_kg: '', fine_leaf_blend_b_pct: '',
    cut_block_kg: '', cut_block_pct: '', clean_block_kg: '', clean_block_pct: '', total_blend_size: '',
    fp_fine_leaf_export_a_pct: '', fp_fine_leaf_blend_b_pct: '', fp_sg_granules_pct: '',
    fp_cut_coarse_leaf_a_pct: '', fp_cut_coarse_leaf_b_pct: '', fp_cut_coarse_leaf_c_pct: '',
    fp_fine_granule_pct: '', product_name: '', total_mass: '', weight_per_bulk_bag: '',
    no_of_bags: '', packaging: '', batch_number: '', customer_po: '', bag_markings: '',
    local_or_export: 'Export', palletised: 'No',
    debagging_hopper_inverter: 'Auto', debagging_hopper_manual: '',
    steriliser_inverter: '', post_sieve_plate_size: '', product_temp_at_pasteuriser: '>85°C',
    special_instructions: '', rework_material: '',
    sig_production_coordinator: null, sig_production_supervisor: null,
    sig_quality_officer: null, sig_production_manager: null, submitted_at: null,
  }
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{label}</label>{children}</div>
}

export default function PasteuriserJobCard() {
  const db = getDb()
  const [form, setForm] = useState<Form>(empty())
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const submitted = !!form.submitted_at
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save(submit = false) {
    setSaving(true)
    const payload = { ...form, submitted_at: submit ? new Date().toISOString() : form.submitted_at }
    if (savedId) { await db.from('job_cards_pasteuriser').update(payload).eq('id', savedId) }
    else { const { data } = await db.from('job_cards_pasteuriser').insert(payload).select('id').single(); if (data) setSavedId((data as any).id) }
    setSaving(false)
    if (submit) setForm(f => ({ ...f, submitted_at: new Date().toISOString() }))
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-5 pb-24">
      <div className="card p-4 bg-brand text-white">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/50 mb-1">PR-FM-013/1 · Cape Natural Tea Products</p>
        <h1 className="font-display font-extrabold text-2xl">Pasteuriser Line Job Card</h1>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Job details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Customer"><input className="input" value={form.customer} onChange={set('customer')} disabled={submitted} /></F>
          <F label="Date of job card"><input type="date" className="input" value={form.date_of_card} onChange={set('date_of_card')} disabled={submitted} /></F>
          <F label="Expected commencement"><input type="date" className="input" value={form.expected_commencement} onChange={set('expected_commencement')} disabled={submitted} /></F>
          <F label="Job card no."><input className="input font-mono" value={form.job_card_no} onChange={set('job_card_no')} disabled={submitted} /></F>
        </div>
        <F label="Item no."><input className="input font-mono" value={form.item_no} onChange={set('item_no')} disabled={submitted} /></F>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Diamond blender ratio — before adding granules</p>
        <F label="Blend description"><input className="input" value={form.blend_description} onChange={set('blend_description')} disabled={submitted} /></F>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-rule">
              <th className="text-left py-2 font-mono text-[10px] text-text-muted uppercase">Component</th>
              <th className="text-right py-2 font-mono text-[10px] text-text-muted uppercase w-24">kg</th>
              <th className="text-right py-2 font-mono text-[10px] text-text-muted uppercase w-24">%</th>
            </tr></thead>
            <tbody className="divide-y divide-surface-rule">
              {[
                { label: 'Fine leaf: Export — A grade', kg: 'fine_leaf_export_a_kg', pct: 'fine_leaf_export_a_pct' },
                { label: 'Fine leaf: Export Blend — B grade', kg: 'fine_leaf_blend_b_kg', pct: 'fine_leaf_blend_b_pct' },
                { label: 'Cut block', kg: 'cut_block_kg', pct: 'cut_block_pct' },
                { label: 'Clean block', kg: 'clean_block_kg', pct: 'clean_block_pct' },
              ].map(row => (
                <tr key={row.kg}>
                  <td className="py-2 text-[13px] text-text">{row.label}</td>
                  <td className="py-1.5 pl-2"><input className="input text-right w-full" value={(form as any)[row.kg]} onChange={set(row.kg as any)} disabled={submitted} placeholder="0.0" /></td>
                  <td className="py-1.5 pl-2"><input className="input text-right w-full" value={(form as any)[row.pct]} onChange={set(row.pct as any)} disabled={submitted} placeholder="0%" /></td>
                </tr>
              ))}
              <tr className="bg-surface">
                <td className="py-2 font-bold text-[13px]">Total blend size</td>
                <td className="py-1.5 pl-2"><input className="input text-right w-full font-bold" value={form.total_blend_size} onChange={set('total_blend_size')} disabled={submitted} /></td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="font-mono text-[10px] text-text-muted mt-2">** 3 blends required for a 3 ton batch</p>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Final product ratio — Rooibos Tea</p>
        {[
          { label: 'Fine leaf: Export — A grade %', key: 'fp_fine_leaf_export_a_pct' },
          { label: 'Fine leaf: Export Blend — B grade %', key: 'fp_fine_leaf_blend_b_pct' },
          { label: 'SG granules %', key: 'fp_sg_granules_pct' },
          { label: 'Cut coarse leaf: Export A grade %', key: 'fp_cut_coarse_leaf_a_pct' },
          { label: 'Cut coarse leaf: Export Blend B grade %', key: 'fp_cut_coarse_leaf_b_pct' },
          { label: 'Cut coarse leaf: Domestic C grade %', key: 'fp_cut_coarse_leaf_c_pct' },
          { label: 'Fine granule %', key: 'fp_fine_granule_pct' },
        ].map(row => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-text flex-1">{row.label}</span>
            <input className="input w-24 text-right" value={(form as any)[row.key]} onChange={set(row.key as any)} disabled={submitted} placeholder="0%" />
          </div>
        ))}
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Batch details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Product name"><input className="input" value={form.product_name} onChange={set('product_name')} disabled={submitted} /></F>
          <F label="Batch number"><input className="input font-mono" value={form.batch_number} onChange={set('batch_number')} disabled={submitted} /></F>
          <F label="Total mass (kg)"><input className="input" value={form.total_mass} onChange={set('total_mass')} disabled={submitted} /></F>
          <F label="Weight per bulk bag (kg)"><input className="input" value={form.weight_per_bulk_bag} onChange={set('weight_per_bulk_bag')} disabled={submitted} /></F>
          <F label="No. of bags"><input className="input" value={form.no_of_bags} onChange={set('no_of_bags')} disabled={submitted} /></F>
          <F label="Packaging"><input className="input" value={form.packaging} onChange={set('packaging')} disabled={submitted} /></F>
          <F label="Customer PO"><input className="input" value={form.customer_po} onChange={set('customer_po')} disabled={submitted} /></F>
          <F label="Bag markings"><input className="input" value={form.bag_markings} onChange={set('bag_markings')} disabled={submitted} /></F>
          <F label="Local or export"><select className="input" value={form.local_or_export} onChange={set('local_or_export')} disabled={submitted}><option>Export</option><option>Local</option></select></F>
          <F label="Palletised"><select className="input" value={form.palletised} onChange={set('palletised')} disabled={submitted}><option>No</option><option>Yes</option></select></F>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Plant settings</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Debagging hopper speed inverter setting"><input className="input" value={form.debagging_hopper_inverter} onChange={set('debagging_hopper_inverter')} disabled={submitted} /></F>
          <F label="Debagging hopper manual setting"><input className="input" value={form.debagging_hopper_manual} onChange={set('debagging_hopper_manual')} disabled={submitted} /></F>
          <F label="Steriliser inverter setting (%)"><input className="input" value={form.steriliser_inverter} onChange={set('steriliser_inverter')} disabled={submitted} /></F>
          <F label="Post-sieve plate size (mm)"><input className="input" value={form.post_sieve_plate_size} onChange={set('post_sieve_plate_size')} disabled={submitted} /></F>
        </div>
        <F label="Product temperature at pasteuriser (°C)"><input className="input" value={form.product_temp_at_pasteuriser} onChange={set('product_temp_at_pasteuriser')} disabled={submitted} /></F>
      </div>

      <div className="card p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Special instructions</p>
        <F label="Instructions"><textarea className="input resize-none" rows={3} value={form.special_instructions} onChange={set('special_instructions')} disabled={submitted} placeholder="Over runs must be blended according to lab recommendation…" /></F>
        <F label="Re-work material for this batch"><textarea className="input resize-none" rows={2} value={form.rework_material} onChange={set('rework_material')} disabled={submitted} /></F>
      </div>

      <div className="card p-4 space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted font-semibold">Sign-offs</p>
        {[
          { label: 'Production Coordinator', key: 'sig_production_coordinator' },
          { label: 'Production Supervisor',  key: 'sig_production_supervisor' },
          { label: 'Quality Officer / Controller', key: 'sig_quality_officer' },
          { label: 'Production Manager',     key: 'sig_production_manager' },
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