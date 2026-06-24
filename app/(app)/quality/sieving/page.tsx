'use client'

// app/(app)/quality/sieving/page.tsx
// Full parity with SievingDashboard in CNTPquality.
// Data: qms.sd_runs (product, date, lot_number, serial_number, grade, variant,
//        run_type, qc_name, time_of_run, needle_count, leaf_shade, bulk_density,
//        comment, pa_level, pass_status, violations[], gram_values{}, sieve_results{})

import React, { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { exportSievingRuns } from '@/lib/utils/exportExcel'

// ─── Constants ────────────────────────────────────────────────────────────────

const SIEVING_SPECS_DB: Record<string,any> = {
  'Rooibos Blocks': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust'],
    labels: ['>6','>10','>12','>18','>40','Dust'],
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)'],
    hasLeafShade: false, hasNeedleCount: true, needle_max: 12,
    volumetrics: '280-300', bulk_bags: '500kg', temp_range: '85-105',
    variants: {
      // IPS-SIEV-003.1 Export CON/RA-CON: >6:Max1, >12:>80, >18:10-20, >40:<5, Dust:Max1
      'Export|CON':          {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|RA-CON':       {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      // IPS-SIEV-003.2 Export ORG/RA-ORG: >6:Max1, >10:>70, >18:5-15, >40:<5, Dust:Max1
      'Export|ORG':          {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|RA-ORG':       {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|FT-CON':       {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|FT-ORG':       {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|CON':    {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|RA-CON': {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|ORG':    {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|RA-ORG': {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|FT-CON': {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|FT-ORG': {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      // IPS-SIEV-003 Domestic CON/RA-CON: same mesh as Export CON
      'Domestic|CON':        {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|RA-CON':     {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|ORG':        {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|RA-ORG':     {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|FT-CON':     {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|FT-ORG':     {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
    },
  },
  'Coarse Leaf': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust'],
    labels: ['>6','>10','>12','>18','>40','Dust'],
    // CON/RA-CON/FT-CON use >12 mesh; ORG/RA-ORG/FT-ORG use >10 mesh
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)'],
    hasLeafShade: true, hasNeedleCount: true, needle_max: 12,
    volumetrics: '280-340', leaf_shade: '1-3 (Domestic) / 4-11 (Export)', temp_range: '85-105',
    variants: {
      // IPS-SIEV-002.1 Export CON/RA-CON: >12:5-25, >18:60-85, >40:5-20, Dust:0-1, Shade:4-11
      'Export|CON':          {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|RA-CON':       {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // IPS-SIEV-002.2 Export ORG/RA-ORG: >10:25-100, >18:65-85, >40:10-20, Dust:0-1, Shade:4-11
      'Export|ORG':          {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|RA-ORG':       {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|FT-CON':       {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|FT-ORG':       {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // Export Blend: same mesh values as Export
      'Export Blend|CON':    {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|RA-CON': {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|ORG':    {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|RA-ORG': {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|FT-CON': {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|FT-ORG': {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // IPS-SIEV-002 Domestic CON/RA-CON: same mesh, Shade:1-3
      'Domestic|CON':        {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|RA-CON':     {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|ORG':        {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|RA-ORG':     {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|FT-CON':     {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|FT-ORG':     {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
    },
  },
  'Fine Leaf': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust'],
    labels: ['>6','>10','>12','>18','>40','Dust'],
    // CON/RA-CON/FT-CON use >12 mesh; ORG/RA-ORG/FT-ORG use >10 mesh (IPS-SIEV-001.2)
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)'],
    hasLeafShade: true, hasNeedleCount: true, needle_max: 12,
    volumetrics: '280-340', leaf_shade: '1-3 (Domestic) / 4-11 (Export)', temp_range: '85-105',
    variants: {
      // IPS-SIEV-001.1 Export CON/RA-CON: >12:0-1, >18:15-35, >40:50-85, Dust:0-2, Shade:4-11
      'Export|CON':          {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export|RA-CON':       {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      // IPS-SIEV-001.2 Export ORG/RA-ORG: >10:0-1, >18:15-35, >40:50-85, Dust:0-5, Shade:4-11
      'Export|ORG':          {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export|RA-ORG':       {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export|FT-CON':       {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export|FT-ORG':       {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      // Export Blend: same mesh values as Export
      'Export Blend|CON':    {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|RA-CON': {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|ORG':    {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export Blend|RA-ORG': {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export Blend|FT-CON': {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|FT-ORG': {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      // IPS-SIEV-001 Domestic CON/RA-CON: same mesh, Shade:1-3
      'Domestic|CON':        {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|RA-CON':     {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|ORG':        {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
      'Domestic|RA-ORG':     {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
      'Domestic|FT-CON':     {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|FT-ORG':     {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
    },
  },
  'Indent Sticks': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust','fine_leaf'],
    labels: ['>6','>10','>12','>18','>40','Dust','Fine Leaf <25%'],
    // CON/RA-CON/FT-CON use >12 mesh; ORG/RA-ORG/FT-ORG use >10 mesh (IPS-SIEV-005.2)
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)','Fine Leaf (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)','Fine Leaf (%)'],
    hasLeafShade: false, hasNeedleCount: false, noLotNumber: true, noBulkDensity: true, hasFineLeafPct: true,
    temp_range: '85-105',
    variants: {
      // IPS-SIEV-005.1 Export CON/RA-CON: >6:5-25, >12:40-65, >18:10-25, >40:<5, Dust:Max1, Fine Tea:<25
      'Export|CON':          {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|RA-CON':       {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      // IPS-SIEV-005.2 Export ORG/RA-ORG: >6:5-25, >10:40-65, >18:15-35, >40:<5, Dust:Max1, Fine Tea:<25
      'Export|ORG':          {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|RA-ORG':       {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|FT-CON':       {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|FT-ORG':       {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|CON':    {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|RA-CON': {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|ORG':    {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|RA-ORG': {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|FT-CON': {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|FT-ORG': {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      // IPS-SIEV-005 Domestic CON/RA-CON: >6:5-25, >12:40-65, >18:10-25, >40:<5, Dust:Max1, Fine Tea:<25
      'Domestic|CON':        {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|RA-CON':     {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|ORG':        {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|RA-ORG':     {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|FT-CON':     {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|FT-ORG':     {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
    },
  },
}

const SD_GRADES   = ['Export','Export Blend','Domestic']
const SD_VARIANTS = ['CON','ORG','RA-ORG','RA-CON','FT-CON','FT-ORG']
const SD_PRODUCTS = Object.keys(SIEVING_SPECS_DB)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sdIsOrg(v: string) { return v==='ORG' || v==='RA-ORG' || v==='FT-ORG' || v.toLowerCase().includes('organic') }
function sdGetMesh(product: string, variant: string): string[] {
  const s = SIEVING_SPECS_DB[product]; if (!s) return []
  return sdIsOrg(variant) ? s.meshForORG : s.meshForCON
}
function sdChk(value: any, range: [number,number]|null): 'pass'|'fail'|'neutral' {
  if (!range||value===''||value==null||value===undefined) return 'neutral'
  const n = parseFloat(value); if (isNaN(n)) return 'neutral'
  if (range[0]===0&&range[1]===0) return 'neutral'
  if (range[0]!==null&&n<range[0]) return 'fail'
  if (range[1]!==null&&n>range[1]) return 'fail'
  return 'pass'
}

function gradeStyle(g: string) {
  if (!g) return {bg:'#f3f4f6',color:'#374151'}
  if (g==='Export Blend') return {bg:'#fef3c7',color:'#92400e'}
  if (g==='Export')       return {bg:'#dbeafe',color:'#1e40af'}
  if (g==='Domestic')     return {bg:'#dcfce7',color:'#166534'}
  return {bg:'#f3f4f6',color:'#374151'}
}
function statusColors(s: string) {
  if (s==='Pass') return {bg:'#dcfce7',color:'#166534',border:'#86efac'}
  if (s==='Fail') return {bg:'#fee2e2',color:'#991b1b',border:'#fca5a5'}
  return {bg:'#f3f4f6',color:'#374151',border:'#e5e7eb'}
}

function mapDbRow(r: any) {
  return {
    id:           r.id,
    product:      r.product,
    date:         r.date ? String(r.date).slice(0,10) : '',
    lotNumber:    r.lot_number||'',
    serialNumber: r.serial_number||'',
    grade:        r.grade||'',
    variant:      r.variant||'',
    runType:      r.run_type||'',
    qcName:       r.qc_name||'',
    time:         r.time_of_run||'',
    needleCount:  r.needle_count||'',
    leafShade:    r.leaf_shade||'',
    bulkDensity:  r.bulk_density||'',
    comment:      r.comment||'',
    paLevel:      r.pa_level||'',
    passStatus:   r.pass_status||'Pass',
    violations:   Array.isArray(r.violations)?r.violations:(typeof r.violations==='string'?JSON.parse(r.violations||'[]'):[]),
    gramValues:   typeof r.gram_values==='object'&&r.gram_values!=null?r.gram_values:{},
    editHistory:  Array.isArray(r.edit_history)?r.edit_history:[],
    timestamp:    r.created_at,
    ...(typeof r.sieve_results==='object'&&r.sieve_results!=null?r.sieve_results:{}),
  }
}

// ─── Spec Editor ─────────────────────────────────────────────────────────────

function SievingSpecEditor({ product, specDef, customSpecs, onSave, onClose }: any) {
  const allMesh = [...new Set([...specDef.meshForORG,...specDef.meshForCON])].sort()
  const [draft, setDraft] = useState(JSON.parse(JSON.stringify(customSpecs)))
  const [newGrade, setNewGrade] = useState(SD_GRADES[0])
  const [newVariant, setNewVariant] = useState(SD_VARIANTS[0])
  // track renamed keys: originalKey -> newKey parts
  const [renames, setRenames] = useState<Record<string,{grade:string,variant:string}>>(
    () => Object.fromEntries(Object.keys(customSpecs).map(k => { const [g,v]=k.split('|'); return [k,{grade:g||'',variant:v||''}] }))
  )

  function applyRenames(d: any) {
    const out: any = {}
    Object.keys(d).forEach(k => {
      const r = renames[k]
      const newKey = r ? `${r.grade}|${r.variant}` : k
      out[newKey] = d[k]
    })
    return out
  }

  return (
    <div style={{background:'#f8fafc',border:'2px solid #7c3aed',borderRadius:10,padding:16,marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:'#7c3aed'}}>✏️ Edit Specifications — {product}</div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>onSave(applyRenames(draft))} style={{padding:'5px 16px',borderRadius:6,border:'none',background:'#7c3aed',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Save Specs</button>
          <button onClick={()=>{if(confirm('Reset to built-in defaults for '+product+'? This will overwrite any saved changes.'))onSave(JSON.parse(JSON.stringify(SIEVING_SPECS_DB[product].variants)))}} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #d97706',background:'#fffbeb',color:'#92400e',fontSize:11,cursor:'pointer'}}>Reset to Defaults</button>
          <button onClick={onClose} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #d1d5db',background:'#fff',fontSize:12,cursor:'pointer'}}>Cancel</button>
        </div>
      </div>
      <div style={{overflowX:'auto',borderRadius:8}}>
        <table style={{borderCollapse:'collapse',fontSize:11,width:'100%'}}>
          <thead><tr style={{background:'#7c3aed',color:'#fff'}}>
            <th style={{padding:'6px 10px',textAlign:'left',minWidth:160}}>Grade</th>
            <th style={{padding:'6px 10px',textAlign:'left',minWidth:100}}>Variant</th>
            {allMesh.map(m=><th key={m} style={{padding:'6px 6px',textAlign:'center'}}>{m.replace(' (%)','')}</th>)}
            {specDef.hasLeafShade&&<th style={{padding:'6px 6px',textAlign:'center'}}>Leaf Shade</th>}
            <th style={{padding:'6px 6px',textAlign:'center'}}>Del</th>
          </tr></thead>
          <tbody>
            {Object.entries(draft).map(([vk,s]: any,i)=>{
              const r = renames[vk] || { grade: vk.split('|')[0]||'', variant: vk.split('|')[1]||'' }
              return (
              <tr key={vk} style={{background:i%2===0?'#fff':'#faf5ff',borderBottom:'1px solid #ede9fe'}}>
                <td style={{padding:'4px 6px'}}>
                  <input value={r.grade} onChange={e=>setRenames(prev=>({...prev,[vk]:{...r,grade:e.target.value}}))}
                    style={{width:'100%',padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:4,fontSize:11,fontFamily:'monospace',color:'#7c3aed',fontWeight:700}}/>
                </td>
                <td style={{padding:'4px 6px'}}>
                  <select value={r.variant} onChange={e=>setRenames(prev=>({...prev,[vk]:{...r,variant:e.target.value}}))}
                    style={{width:'100%',padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:4,fontSize:11,background:'#fff'}}>
                    {SD_VARIANTS.map(v=><option key={v}>{v}</option>)}
                  </select>
                </td>
                {allMesh.map(m=>{
                  const val = s[m] ?? [0,0]
                  return (
                  <td key={m} style={{padding:'3px 4px',textAlign:'center'}}>
                    <div style={{display:'flex',gap:2,justifyContent:'center'}}>
                      {[0,1].map(j=>(
                        <input key={j} type="number" step="1" value={val[j]??0} onChange={e=>{
                          const v=e.target.value===''?0:parseFloat(e.target.value)
                          setDraft((d:any)=>{const nd=JSON.parse(JSON.stringify(d));if(!nd[vk][m])nd[vk][m]=[0,0];nd[vk][m][j]=v;return nd})
                        }} style={{width:36,padding:'2px 3px',border:'1px solid #d1d5db',borderRadius:3,fontSize:10,textAlign:'center'}}/>
                      ))}
                    </div>
                  </td>
                )})}
                {specDef.hasLeafShade&&(
                  <td style={{padding:'3px 4px',textAlign:'center'}}>
                    <div style={{display:'flex',gap:2,justifyContent:'center'}}>
                      {[0,1].map(j=>(
                        <input key={j} type="number" step="1" value={s['Leaf Shade']?.[j]??0} onChange={e=>{
                          const v=e.target.value===''?0:parseFloat(e.target.value)
                          setDraft((d:any)=>{const nd=JSON.parse(JSON.stringify(d));if(!nd[vk]['Leaf Shade'])nd[vk]['Leaf Shade']=[0,0];nd[vk]['Leaf Shade'][j]=v;return nd})
                        }} style={{width:36,padding:'2px 3px',border:'1px solid #d1d5db',borderRadius:3,fontSize:10,textAlign:'center'}}/>
                      ))}
                    </div>
                  </td>
                )}
                <td style={{padding:'3px 6px',textAlign:'center'}}>
                  <button onClick={()=>{ setDraft((d:any)=>{const nd={...d};delete nd[vk];return nd}); setRenames(prev=>{const np={...prev};delete np[vk];return np}) }}
                    style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:14,padding:'0 4px'}}>🗑</button>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      {/* Add new Grade+Variant combination */}
      <div style={{marginTop:12,padding:'10px 14px',background:'#faf5ff',borderRadius:8,border:'1px dashed #c4b5fd',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:700,color:'#7c3aed',whiteSpace:'nowrap'}}>+ Add combination:</span>
        <select value={newGrade} onChange={e=>setNewGrade(e.target.value)} style={{padding:'5px 8px',borderRadius:5,border:'1px solid #d1d5db',fontSize:11,background:'#fff'}}>
          {SD_GRADES.map(g=><option key={g}>{g}</option>)}
        </select>
        <select value={newVariant} onChange={e=>setNewVariant(e.target.value)} style={{padding:'5px 8px',borderRadius:5,border:'1px solid #d1d5db',fontSize:11,background:'#fff'}}>
          {SD_VARIANTS.map(v=><option key={v}>{v}</option>)}
        </select>
        <button onClick={()=>{
          const key=`${newGrade}|${newVariant}`
          if(draft[key]){alert('This combination already exists');return}
          const emptyRow:any={}
          allMesh.forEach((m:string)=>{emptyRow[m]=[0,0]})
          if(specDef.hasLeafShade) emptyRow['Leaf Shade']=[0,0]
          setDraft((d:any)=>({...d,[key]:emptyRow}))
          setRenames(prev=>({...prev,[key]:{grade:newGrade,variant:newVariant}}))
        }} style={{padding:'5px 16px',borderRadius:5,border:'none',background:'#7c3aed',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>
          Add Row
        </button>
      </div>
    </div>
  )
}

// ─── MESH_COLORS ─────────────────────────────────────────────────────────────

const MESH_COLORS: Record<string,string> = {
  '>6 (%)':'#ef4444', '>10 (%)':'#f97316', '>12 (%)':'#f59e0b',
  '>16 (%)':'#10b981', '>18 (%)':'#3b82f6', '>20 (%)':'#8b5cf6',
  '>40 (%)':'#ec4899', '>60 (%)':'#06b6d4', 'Dust (%)':'#6b7280',
  'Fine Leaf (%)':'#84cc16',
}

// ─── SievingChart ─────────────────────────────────────────────────────────────

function SievingChart({ runs, specDef, activeSpecs, activeProduct, onDotClick }: {
  runs: any[]; specDef: any; activeSpecs: Record<string,any>
  activeProduct: string; onDotClick?: (runId: any) => void
}) {
  const [selectedMesh, setSelectedMesh] = useState<string|null>(null)
  const [gradeFilter,  setGradeFilter]  = useState('all')
  const [chartTab,     setChartTab]     = useState<'sieve'|'density'|'shade'>('sieve')
  const [lotFilter,    setLotFilter]    = useState('')
  const [dateMode,     setDateMode]     = useState('all')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')

  if (!runs || runs.length === 0) return null

  const sortedRuns = [...runs].sort((a,b) => {
    const da = a.date||'', db2 = b.date||''
    if (da !== db2) return da < db2 ? -1 : 1
    const ta = a.timestamp||a.time||'', tb = b.timestamp||b.time||''
    return ta < tb ? -1 : 1
  })

  const allMesh     = [...new Set([...(specDef.meshForORG||[]),...(specDef.meshForCON||[])])].sort()
  const isOrgRun    = (r: any) => sdIsOrg(r.variant)
  const meshForRun  = (r: any) => isOrgRun(r) ? (specDef.meshForORG||[]) : (specDef.meshForCON||[])
  const grades      = [...new Set(sortedRuns.map(r => `${r.grade}|${r.variant}`))]
  const lotNumbers  = [...new Set(sortedRuns.map(r => r.lotNumber).filter(Boolean))].sort()

  const today   = new Date().toISOString().slice(0,10)
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
  const bounds  = dateMode==='week' ? {from:daysAgo(7),to:today}
                : dateMode==='2week'? {from:daysAgo(14),to:today}
                : dateMode==='month'? {from:daysAgo(30),to:today}
                : dateMode==='3month'?{from:daysAgo(90),to:today}
                : dateMode==='custom'?{from:dateFrom,to:dateTo}
                : {from:'',to:''}

  const displayRuns = sortedRuns.filter(r => {
    if (gradeFilter!=='all' && `${r.grade}|${r.variant}`!==gradeFilter) return false
    if (lotFilter && r.lotNumber!==lotFilter) return false
    if (bounds.from && r.date && r.date<bounds.from) return false
    if (bounds.to   && r.date && r.date>bounds.to)   return false
    return true
  })

  const sieveRuns    = displayRuns.filter(r => r.runType!=='final')
  const physicalRuns = displayRuns

  const buildLabel = (r: any, i: number) => r.date&&r.time ? `${r.date} ${r.time}` : r.date||`Run ${i+1}`

  const chartData = sieveRuns.map((r,i) => {
    const point: any = { name:buildLabel(r,i), date:r.date, grade:`${r.grade}|${r.variant}`, lotNumber:r.lotNumber||'', _idx:i, _runId:r.id||i }
    const validMesh = meshForRun(r)
    allMesh.forEach(m => {
      if (!validMesh.includes(m)) { point[m]=null; return }
      const v = parseFloat(r[m])
      point[m] = isNaN(v) ? null : v
    })
    return point
  })

  const physData = physicalRuns.map((r,i) => ({
    name:buildLabel(r,i), date:r.date, lotNumber:r.lotNumber||'', runType:r.runType||'in-process',
    bulkDensity: r.bulkDensity!==''&&r.bulkDensity!=null ? parseFloat(r.bulkDensity)||null : null,
    leafShade:   r.leafShade!==''&&r.leafShade!=null     ? parseFloat(r.leafShade)||null   : null,
    _idx:i,
  }))

  const getSpecLines = (mesh: string) => {
    if (gradeFilter==='all') return null
    const spec = activeSpecs[gradeFilter]?.[mesh]
    if (!spec||(spec[0]===0&&spec[1]===0)) return null
    return spec as [number,number]
  }

  const activeMeshes = selectedMesh ? [selectedMesh] : allMesh.filter(m =>
    sieveRuns.some(r => { const vm = meshForRun(r); return vm.includes(m) && r[m]!==''&&r[m]!=null&&!isNaN(parseFloat(r[m])) })
  )

  const hasDensityData = physData.some(d => d.bulkDensity!==null)
  const hasShadeData   = physData.some(d => d.leafShade!==null)
  const activeFilter   = dateMode!=='all' || gradeFilter!=='all' || !!lotFilter
  const selSt: React.CSSProperties = { padding:'5px 9px', border:'1px solid #d1d5db', borderRadius:6, fontSize:11, background:'#fff' }

  return (
    <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e5e7eb', padding:18, marginBottom:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, flexWrap:'wrap', gap:6 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>Trend Analysis — {activeProduct}</div>
          <div style={{ fontSize:10, color:'#9ca3af', marginTop:2 }}>
            Chronological · spec lines when grade selected ·
            <span style={{ marginLeft:4, color:activeFilter?'#1d4ed8':'#9ca3af', fontWeight:activeFilter?700:400 }}>
              {displayRuns.length}/{sortedRuns.length} runs shown
            </span>
          </div>
        </div>
        {activeFilter && (
          <button onClick={()=>{ setDateMode('all'); setDateFrom(''); setDateTo(''); setGradeFilter('all'); setLotFilter('') }}
            style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #fca5a5', background:'#fef2f2', color:'#dc2626', fontSize:11, fontWeight:600, cursor:'pointer' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12, padding:'10px 12px', background:'#f8fafc', borderRadius:8, border:'1px solid #e5e7eb' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:9, fontWeight:700, color:'#6b7280', textTransform:'uppercase' }}>Date Range</span>
          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
            {[['all','All time'],['week','This week'],['2week','2 weeks'],['month','30 days'],['3month','90 days'],['custom','Custom']].map(([mode,label]) => (
              <button key={mode} onClick={()=>{ setDateMode(mode); if(mode!=='custom'){setDateFrom('');setDateTo('')} }}
                style={{ padding:'3px 9px', borderRadius:10, border:'1px solid', fontSize:10, cursor:'pointer', fontWeight:600,
                  background:dateMode===mode?'#1f4e79':'#fff', color:dateMode===mode?'#fff':'#374151', borderColor:dateMode===mode?'#1f4e79':'#e5e7eb' }}>
                {label}
              </button>
            ))}
          </div>
          {dateMode==='custom' && (
            <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:4 }}>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ padding:'3px 7px', border:'1px solid #d1d5db', borderRadius:6, fontSize:11 }}/>
              <span style={{ fontSize:11, color:'#9ca3af' }}>→</span>
              <input type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   style={{ padding:'3px 7px', border:'1px solid #d1d5db', borderRadius:6, fontSize:11 }}/>
            </div>
          )}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:9, fontWeight:700, color:'#6b7280', textTransform:'uppercase' }}>Grade / Variant</span>
          <select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)} style={selSt}>
            <option value="all">All grades</option>
            {grades.map(g=><option key={g} value={g}>{g.replace('|',' — ')}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:9, fontWeight:700, color:'#6b7280', textTransform:'uppercase' }}>Lot Number</span>
          <select value={lotFilter} onChange={e=>setLotFilter(e.target.value)} style={selSt}>
            <option value="">All lots</option>
            {lotNumbers.map(l=><option key={l as string} value={l as string}>{l as string}</option>)}
          </select>
        </div>
      </div>

      {/* Chart type tabs */}
      <div style={{ display:'flex', gap:3, marginBottom:12, borderBottom:'1px solid #e5e7eb', paddingBottom:8 }}>
        {([['sieve','🔬 Sieve Fractions'],['density','⚖ Bulk Density'],['shade','🍃 Leaf Shade']] as const).map(([tab,label]) => (
          <button key={tab} onClick={()=>setChartTab(tab)}
            disabled={(tab==='density'&&!hasDensityData)||(tab==='shade'&&!hasShadeData)}
            style={{ padding:'5px 12px', borderRadius:'6px 6px 0 0', border:'1px solid',
              borderBottom:chartTab===tab?'1px solid #fff':'1px solid #e5e7eb', marginBottom:chartTab===tab?-1:0,
              cursor:((tab==='density'&&!hasDensityData)||(tab==='shade'&&!hasShadeData))?'not-allowed':'pointer',
              fontSize:11, fontWeight:chartTab===tab?700:500,
              background:chartTab===tab?'#fff':'#f9fafb', color:chartTab===tab?'#1f4e79':'#9ca3af',
              borderColor:chartTab===tab?'#e5e7eb':'#f3f4f6',
              opacity:((tab==='density'&&!hasDensityData)||(tab==='shade'&&!hasShadeData))?0.4:1 }}>
            {label}
          </button>
        ))}
      </div>

      {chartTab==='sieve' && <>
        <div style={{ display:'flex', gap:5, marginBottom:12, flexWrap:'wrap' }}>
          <button onClick={()=>setSelectedMesh(null)}
            style={{ padding:'3px 10px', borderRadius:12, border:'1px solid', fontSize:10, cursor:'pointer', fontWeight:600,
              background:selectedMesh===null?'#1f4e79':'#f9fafb', color:selectedMesh===null?'#fff':'#374151', borderColor:selectedMesh===null?'#1f4e79':'#e5e7eb' }}>
            All fractions
          </button>
          {allMesh.map(m => {
            const hasData = activeMeshes.includes(m)
            const color   = MESH_COLORS[m]||'#6b7280'
            return (
              <button key={m} onClick={()=>hasData?setSelectedMesh(selectedMesh===m?null:m):null}
                style={{ padding:'3px 10px', borderRadius:12, border:`1px solid ${color}`, fontSize:10,
                  cursor:hasData?'pointer':'default', fontWeight:600, opacity:hasData?1:0.3,
                  background:selectedMesh===m?color:`${color}20`, color:selectedMesh===m?'#fff':color }}>
                {m.replace(' (%)','').replace('>','>')}
              </button>
            )
          })}
        </div>

        {chartData.length < 2 ? (
          <div style={{ textAlign:'center', padding:'30px 0', color:'#9ca3af', fontSize:12 }}>
            {sieveRuns.length===0 ? 'No in-process runs — Final QC runs have no sieve data' : 'Add at least 2 in-process runs to see the trend chart'}
          </div>
        ) : (
          activeMeshes.map(mesh => {
            const spec    = gradeFilter!=='all' ? getSpecLines(mesh) : null
            const hasData = chartData.some(d => d[mesh]!==null&&d[mesh]!==undefined)
            if (!hasData) return null
            const color = MESH_COLORS[mesh]||'#6b7280'
            return (
              <div key={mesh} style={{ marginBottom:selectedMesh?0:20 }}>
                {!selectedMesh && (
                  <div style={{ fontSize:11, fontWeight:700, color, marginBottom:4 }}>
                    {mesh.replace(' (%)','').replace('>','>')}
                    {spec && <span style={{ fontWeight:400, color:'#9ca3af', marginLeft:6, fontSize:10 }}>spec: {spec[0]}–{spec[1]}%</span>}
                  </div>
                )}
                <ResponsiveContainer width="100%" height={selectedMesh?260:140}>
                  <LineChart data={chartData} margin={{ top:8, right:20, left:0, bottom:4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                    <XAxis dataKey="name" tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false}/>
                    <YAxis tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${v}%`}
                      domain={[spec?Math.max(0,spec[0]-10):'auto', spec?spec[1]+10:'auto']}/>
                    <Tooltip content={({ active, payload, label }: any) => {
                      if (!active||!payload?.length) return null
                      const run = sieveRuns[payload[0]?.payload?._idx]
                      return (
                        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px', boxShadow:'0 4px 12px rgba(0,0,0,.1)', fontSize:11 }}>
                          <div style={{ fontWeight:700, color:'#111827', marginBottom:4 }}>{label}</div>
                          {run && <div style={{ color:'#6b7280', marginBottom:6, fontSize:10 }}>{run.date} — {run.grade} {run.variant}</div>}
                          {payload.map((p: any, i: number) => {
                            if (p.value===null||p.value===undefined) return null
                            const sp = run ? getSpecLines(p.dataKey) : null
                            const inSpec = sp ? (p.value>=sp[0]&&p.value<=sp[1]) : null
                            return (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                                <span style={{ width:10, height:10, borderRadius:'50%', background:p.color, flexShrink:0 }}/>
                                <span style={{ color:'#374151', minWidth:60 }}>{p.dataKey.replace(' (%)','')}</span>
                                <span style={{ fontFamily:'monospace', fontWeight:700, color:inSpec===false?'#dc2626':inSpec===true?'#166534':'#111827' }}>
                                  {p.value.toFixed(1)}%
                                </span>
                                {sp && <span style={{ fontSize:9, color:'#9ca3af' }}>spec: {sp[0]}–{sp[1]}%</span>}
                                {inSpec===false && <span style={{ fontSize:9, color:'#dc2626', fontWeight:700 }}>OUT</span>}
                              </div>
                            )
                          })}
                        </div>
                      )
                    }}/>
                    {spec&&spec[0]>0 && <ReferenceLine y={spec[0]} stroke={color} strokeDasharray="5 3" strokeWidth={1.5} opacity={0.6}
                      label={{ value:`Min ${spec[0]}%`, position:'insideTopLeft', fontSize:9, fill:color }}/>}
                    {spec&&spec[1]>0 && <ReferenceLine y={spec[1]} stroke={color} strokeDasharray="5 3" strokeWidth={1.5} opacity={0.6}
                      label={{ value:`Max ${spec[1]}%`, position:'insideBottomLeft', fontSize:9, fill:color }}/>}
                    <Line type="monotone" dataKey={mesh} stroke={color} strokeWidth={2.5} connectNulls={false}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props
                        const val = payload[mesh]
                        const outOfSpec = spec&&val!==null&&(val<spec[0]||val>spec[1])
                        const rid = payload._runId??payload._idx
                        return <circle key={`dot-${payload._idx}-${mesh}`} cx={cx} cy={cy}
                          r={outOfSpec?8:6} fill={outOfSpec?'#dc2626':color} stroke={outOfSpec?'#991b1b':'#fff'}
                          strokeWidth={outOfSpec?2.5:2} style={{ cursor:'pointer', pointerEvents:'all' }}
                          onClick={(e: any)=>{ e.stopPropagation(); onDotClick&&onDotClick(rid) }}/>
                      }}
                      activeDot={(props: any) => {
                        const { cx, cy, payload } = props
                        return <circle key={`adot-${payload._idx}`} cx={cx} cy={cy} r={11}
                          fill={color} stroke="#fff" strokeWidth={2.5}
                          style={{ cursor:'pointer', pointerEvents:'all' }}
                          onClick={(e: any)=>{ e.stopPropagation(); onDotClick&&onDotClick(payload._runId??payload._idx) }}/>
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          })
        )}
      </>}

      {chartTab==='density' && hasDensityData && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={physData} margin={{ top:8, right:20, left:0, bottom:4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
            <XAxis dataKey="name" tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false}/>
            <Tooltip/>
            <Line type="monotone" dataKey="bulkDensity" name="Bulk Density" stroke="#1f4e79" strokeWidth={2} dot={{ r:4 }}/>
          </LineChart>
        </ResponsiveContainer>
      )}

      {chartTab==='shade' && hasShadeData && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={physData} margin={{ top:8, right:20, left:0, bottom:4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
            <XAxis dataKey="name" tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false}/>
            <YAxis tick={{ fontSize:9, fill:'#9ca3af' }} tickLine={false} axisLine={false} domain={[1,11]}/>
            <Tooltip/>
            <Line type="monotone" dataKey="leafShade" name="Leaf Shade" stroke="#166534" strokeWidth={2} dot={{ r:4 }}/>
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── InlineEditForm ────────────────────────────────────────────────────────────

function InlineEditForm({ run, specDef, activeSpecs, onSave, onCancel }: {
  run: any; specDef: any; activeSpecs: Record<string,any>
  onSave: (f: any) => void; onCancel: () => void
}) {
  const [fields, setFields] = useState({
    date: run.date||'', lotNumber: run.lotNumber||'', serialNumber: run.serialNumber||'',
    qcName: run.qcName||'', time: run.time||'',
    bulkDensity: run.bulkDensity||'', grade: run.grade||SD_GRADES[0], variant: run.variant||'CON',
    runType: run.runType||'in-process', needleCount: run.needleCount||'',
    leafShade: run.leafShade||'', comment: run.comment||'', paLevel: run.paLevel||'',
  })
  const [gramVals, setGramVals] = useState<Record<string,string>>(run.gramValues||{})
  const [pcts,     setPcts]     = useState<Record<string,string>>({})

  const editMesh  = sdIsOrg(fields.variant) ? (specDef.meshForORG||[]) : (specDef.meshForCON||[])
  const specKey   = `${fields.grade}|${fields.variant}`
  const specRow   = activeSpecs[specKey] || {}

  useEffect(() => {
    const init: Record<string,string> = {}
    editMesh.forEach((m: string) => { init[m] = run[m]??'' })
    setPcts(init)
  }, [])

  function handleGram(gKey: string, val: string) {
    const newG = { ...gramVals, [gKey]: val }
    setGramVals(newG)
    const total = editMesh.reduce((s: number, m: string) => {
      const v = parseFloat(newG[m.replace(' (%)',' (g)')])
      return s + (isNaN(v)?0:v)
    }, 0)
    if (total > 0) {
      const np: Record<string,string> = {}
      editMesh.forEach((m: string) => {
        const g = parseFloat(newG[m.replace(' (%)',' (g)')])
        np[m] = isNaN(g) ? pcts[m]||'' : ((g/total)*100).toFixed(1)
      })
      setPcts(np)
    }
  }

  const setF = (k: string, v: string) => setFields(f => ({...f,[k]:v}))
  const inputSt: React.CSSProperties = { width:'100%', padding:'5px 7px', border:'1px solid #d1d5db', borderRadius:5, fontSize:11, boxSizing:'border-box' }

  return (
    <div className="bg-ok/5 border-2 border-ok rounded-xl p-4 my-2">
      <div className="text-[12px] font-bold text-ok mb-3">
        ✏️ Editing: {run.lotNumber} — {run.date}
        {(run.editHistory||[]).length > 0 && (
          <span className="ml-2 text-[10px] text-text-faint font-normal">
            (edited {(run.editHistory||[]).length}×)
          </span>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:8, marginBottom:12 }}>
        {[['Date','date','date'],['Lot Number','lotNumber','text'],['Serial No.','serialNumber','text'],
          ['QC Name','qcName','text'],['Time','time','text'],['Bulk Density','bulkDensity','number']]
          .map(([label,key,type]) => (
            <div key={key}>
              <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>{label}</label>
              <input type={type} value={(fields as any)[key]} onChange={e=>setF(key,e.target.value)} style={inputSt}/>
            </div>
          ))}
        <div>
          <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Grade</label>
          <select value={fields.grade} onChange={e=>setF('grade',e.target.value)} style={{ ...inputSt, background:'#fff' }}>
            {SD_GRADES.map(g=><option key={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Variant</label>
          <select value={fields.variant} onChange={e=>setF('variant',e.target.value)} style={{ ...inputSt, background:'#fff' }}>
            {SD_VARIANTS.map(v=><option key={v}>{v}</option>)}
          </select>
        </div>
        {specDef.hasNeedleCount && (
          <div>
            <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Needle Count</label>
            <input type="number" value={fields.needleCount} onChange={e=>setF('needleCount',e.target.value)} style={inputSt}/>
          </div>
        )}
        {specDef.hasLeafShade && (
          <div>
            <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Leaf Shade</label>
            <input type="number" min="1" max="11" value={fields.leafShade} onChange={e=>setF('leafShade',e.target.value)} style={inputSt}/>
          </div>
        )}
        <div>
          <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>PA Level</label>
          <select value={fields.paLevel} onChange={e=>setF('paLevel',e.target.value)} style={{ ...inputSt, background:'#fff' }}>
            <option value="">— not set —</option>
            {['P0','P1','P2','P3','FAIL'].map(lv=><option key={lv}>{lv}</option>)}
          </select>
        </div>
      </div>

      {/* Sieve values */}
      <div style={{ background:'#f8fafc', borderRadius:8, padding:12, marginBottom:10, border:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:8 }}>Sieve Values</div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${editMesh.length},1fr)`, gap:6, marginBottom:4 }}>
          {editMesh.map((m: string) => (
            <div key={m} style={{ textAlign:'center', fontSize:10, fontWeight:700 }}>
              {m.replace(' (%)','').replace('>','>')}
              {specRow[m]&&!(specRow[m][0]===0&&specRow[m][1]===0) && (
                <div style={{ fontSize:9, color:'#9ca3af', fontWeight:400 }}>{specRow[m][0]}–{specRow[m][1]}%</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize:9, color:'#6b7280', marginBottom:3, fontWeight:600 }}>GRAMS</div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${editMesh.length},1fr)`, gap:6, marginBottom:8 }}>
          {editMesh.map((m: string) => {
            const gKey = m.replace(' (%)',' (g)')
            return <input key={gKey} type="number" step="0.1" placeholder="g" value={gramVals[gKey]??''}
              onChange={e=>handleGram(gKey,e.target.value)}
              style={{ width:'100%', padding:'5px 4px', border:'1px solid #d1d5db', borderRadius:5, fontSize:11, textAlign:'center', boxSizing:'border-box', fontFamily:'monospace' }}/>
          })}
        </div>
        <div style={{ fontSize:9, color:'#6b7280', marginBottom:3, fontWeight:600 }}>PERCENT %</div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${editMesh.length},1fr)`, gap:6 }}>
          {editMesh.map((m: string) => {
            const val = pcts[m]??''
            const spec = specRow[m]
            const status = sdChk(val, spec)
            return <input key={m} type="number" step="0.1" placeholder="%" value={val}
              onChange={e=>setPcts(p=>({...p,[m]:e.target.value}))}
              style={{ width:'100%', padding:'5px 4px',
                border:`1.5px solid ${status==='fail'?'#f87171':status==='pass'?'#86efac':'#d1d5db'}`,
                borderRadius:5, fontSize:12, fontWeight:700, textAlign:'center', boxSizing:'border-box',
                background:status==='fail'?'#fef2f2':status==='pass'?'#f0fdf4':'#fff',
                color:status==='fail'?'#dc2626':status==='pass'?'#166534':'#111827', fontFamily:'monospace' }}/>
          })}
        </div>
      </div>

      <div style={{ marginBottom:10 }}>
        <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Comment</label>
        <textarea value={fields.comment} onChange={e=>setF('comment',e.target.value)} rows={2}
          style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:5, fontSize:11, resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}/>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button onClick={()=>onSave({...fields,...pcts,gramValues:gramVals})}
          style={{ padding:'6px 20px', borderRadius:6, border:'none', background:'#166534', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
          Save Changes
        </button>
        <button onClick={onCancel}
          style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff', fontSize:12, cursor:'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SievingPage() {
  const { p } = useAuth(); const canWrite = p('can_add_sieving_runs'); const isAdmin = p('can_delete_sieving_runs')
  const db = getDb()

  const [activeProduct, setActiveProduct] = useState('Fine Leaf')
  const [runs, setRuns] = useState<Record<string,any[]>>({})
  const [customSpecs, setCustomSpecs] = useState<Record<string,any>>(
    Object.fromEntries(SD_PRODUCTS.map(p => [p, JSON.parse(JSON.stringify(SIEVING_SPECS_DB[p].variants))]))
  )
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [sdError,   setSdError]   = useState('')
  const [lastSaved, setLastSaved] = useState<Date|null>(null)
  const [showChart, setShowChart] = useState(true)

  const [showForm,       setShowForm]       = useState(false)
  const [showSpecEditor, setShowSpecEditor] = useState(false)
  const [showSpecPanel,  setShowSpecPanel]  = useState(true)
  const [filter,         setFilter]         = useState('all')
  const [editRunId,      setEditRunId]      = useState<any>(null)
  const [errors,         setErrors]         = useState<Record<string,string>>({})
  const [isRetest,       setIsRetest]       = useState(false)
  const [anomalyWarn,    setAnomalyWarn]    = useState('')
  const [lotMsg,         setLotMsg]         = useState('')
  const [highlightedRunId, setHighlightedRunId] = useState<any>(null)
  const [paLookup,       setPaLookup]       = useState<Record<string,string>>({})
  const [rLookup,        setRLookup]        = useState<Record<string,string>>({})
  const [leafShadeLookup,setLeafShadeLookup]= useState<Record<string,number>>({})
  const [tableCollapsed, setTableCollapsed] = useState(false)

  // Load PA levels from raw material records for lot auto-fill
  useEffect(() => {
    db.schema('qms').from('quality_records')
      .select('batch_number,data_json')
      .eq('workcenter','rawMaterial')
      .eq('workflow','pa_ta_analysis')
      .then(({ data }: { data: any[] | null }) => {
        if (!data) return
        const map: Record<string,string> = {}
        data.forEach((r: any) => {
          const lot = (r.batch_number || '').trim().toUpperCase()
          const dj = typeof r.data_json === 'string' ? (() => { try { return JSON.parse(r.data_json) } catch { return {} } })() : (r.data_json ?? {})
          const lvl = dj.pa_level || dj.level || ''
          if (lot && lvl) map[lot] = lvl
        })
        setPaLookup(map)
      })
  }, [db])

  // Load R-grades from residue analysis records for lot auto-fill
  useEffect(() => {
    db.schema('qms').from('quality_records')
      .select('batch_number,data_json')
      .eq('workcenter','rawMaterial')
      .eq('workflow','residue')
      .then(({ data }: { data: any[] | null }) => {
        if (!data) return
        const map: Record<string,string> = {}
        data.forEach((r: any) => {
          const lot = (r.batch_number || '').trim().toUpperCase()
          const dj = typeof r.data_json === 'string' ? (() => { try { return JSON.parse(r.data_json) } catch { return {} } })() : (r.data_json ?? {})
          const grade = dj.overall_r_grade || ''
          if (lot && grade) map[lot] = grade
        })
        setRLookup(map)
      })
  }, [db])

  // Load leaf shade from raw material leaf_shade_predictions table
  useEffect(() => {
    db.schema('qms').from('leaf_shade_predictions')
      .select('lot_number, leaf_shade, actual_leaf_shade')
      .then(({ data }: { data: any[] | null }) => {
        if (!data) return
        const map: Record<string, number> = {}
        data.forEach((r: any) => {
          const lot = (r.lot_number || '').trim().toUpperCase().replace(/\s*-\s*/g, '-')
          const shade = r.actual_leaf_shade ?? r.leaf_shade
          if (lot && shade != null) map[lot] = shade
        })
        setLeafShadeLookup(map)
      })
  }, [db])

  const blankForm = () => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2,'0')
    const mm = String(now.getMinutes()).padStart(2,'0')
    return {
      date: now.toISOString().slice(0,10),
      lotNumber:'', serialNumber:'', grade:'Export', variant:'CON',
      runType:'in-process', qcName:'', time:`${hh}:${mm}`, needleCount:'', leafShade:'',
      bulkDensity:'', comment:'', paLevel:'', manualPaLevel:'',
    }
  }
  const [form, setForm]           = useState<any>(blankForm())
  const [gramValues, setGramValues] = useState<Record<string,string>>({})

  // Load all runs
  const load = useCallback(async () => {
    setLoading(true); setSdError('')
    // qms is the single source (legacy public.sd_runs consolidated in 2026-06-24).
    // Paginate — qms.sd_runs exceeds the default 1000-row page.
    let allData: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.schema('qms').from('sd_runs').select('*')
        .order('created_at', { ascending: false }).range(from, from + 999)
      if (error) { setSdError(error.message); setLoading(false); return }
      allData = allData.concat(data || [])
      if (!data || data.length < 1000) break
    }
    const grouped: Record<string,any[]> = {}
    allData.forEach((r: any) => {
      const mapped = mapDbRow(r)
      const p = mapped.product || 'Fine Leaf'
      if (!grouped[p]) grouped[p] = []
      grouped[p].push(mapped)
    })
    setRuns(grouped); setLastSaved(new Date()); setLoading(false)
  }, [db])

  useEffect(() => { load() }, [load])

  // Load saved spec overrides from DB so all PCs share the same specs
  useEffect(() => {
    db.schema('qms').from('sieving_spec_overrides').select('product,specs')
      .then(({ data }: { data: any[] | null }) => {
        if (!data || data.length === 0) return
        setCustomSpecs(prev => {
          const updated = { ...prev }
          data.forEach((row: any) => {
            if (row.product && row.specs && typeof row.specs === 'object') {
              updated[row.product] = row.specs
            }
          })
          return updated
        })
      })
  }, [db])

  const specDef     = SIEVING_SPECS_DB[activeProduct]
  const activeSpecs = customSpecs[activeProduct] || specDef.variants
  const productRuns = runs[activeProduct] || []
  const filteredRuns = (filter==='all' ? productRuns : productRuns.filter((r:any) => r.runType===filter))
    .slice().sort((a:any,b:any) => {
      const da = (a.date||'')+(a.time||''), db2 = (b.date||'')+(b.time||'')
      return da < db2 ? 1 : da > db2 ? -1 : 0
    })
  const activeMesh  = sdGetMesh(activeProduct, form.variant)
  const specKey     = `${form.grade}|${form.variant}`
  const activeSpec  = activeSpecs[specKey] || {}

  // Auto-fill grade/variant from previous runs for same lot
  const lookupLot = (lotNum: string) => {
    if (!lotNum?.trim()) { setLotMsg(''); return {} }
    const key = lotNum.trim().toUpperCase()
    const paFromLookup = paLookup[key]
    const rFromLookup  = rLookup[key]
    const allRuns = Object.values(runs).flat()
    const matches = allRuns.filter((r:any) => (r.lotNumber||'').trim().toUpperCase()===key)
      .sort((a:any,b:any)=>new Date(b.timestamp||0).getTime()-new Date(a.timestamp||0).getTime())
    const fields: any = {}
    if (matches.length) {
      const latest: any = matches[0]
      if (latest.grade)        fields.grade = latest.grade
      if (latest.variant)      fields.variant = latest.variant
      if (latest.serialNumber) fields.serialNumber = latest.serialNumber
      if (latest.leafShade)    fields.leafShade = latest.leafShade
    }
    if (paFromLookup) fields.paLevel = paFromLookup
    const normKey = key.replace(/\s*-\s*/g, '-')
    const leafShadeFromRaw = leafShadeLookup[normKey] ?? leafShadeLookup[key]
    if (leafShadeFromRaw != null && !fields.leafShade) fields.leafShade = String(leafShadeFromRaw)
    const extras = [
      paFromLookup ? `PA: ${paFromLookup}` : '',
      rFromLookup  ? `R: ${rFromLookup}`  : '',
      leafShadeFromRaw != null && !matches.length ? `Shade: ${leafShadeFromRaw}` : '',
    ].filter(Boolean).join(' · ')
    const runMsg = matches.length ? `✓ Auto-filled from previous run — ${fields.grade} · ${fields.variant}${fields.leafShade ? ` · Shade ${fields.leafShade}` : ''}` : ''
    const rawMsg = extras ? `📋 Raw material: ${extras}` : ''
    setLotMsg([runMsg, rawMsg].filter(Boolean).join('  ·  '))
    return fields
  }

  // Auto-calculate % from grams
  const calcPercents = (grams: Record<string,string>) => {
    const meshKeys = activeMesh.map(m => m.replace(' (%)',' (g)'))
    const total = meshKeys.reduce((sum,mk)=>{ const v=parseFloat(grams[mk]); return sum+(isNaN(v)?0:v) },0)
    if (total<=0) return {}
    const pcts: any = {}
    activeMesh.forEach(m => {
      const gKey = m.replace(' (%)',' (g)')
      const g = parseFloat(grams[gKey])
      pcts[m] = isNaN(g)?'':(( g/total)*100).toFixed(1)
    })
    return pcts
  }

  const handleGramChange = (gKey: string, val: string) => {
    const newGrams = { ...gramValues, [gKey]: val }
    setGramValues(newGrams)
    const pcts = calcPercents(newGrams)
    setForm((f: any) => ({ ...f, ...pcts }))
    // Anomaly detection
    const meshKeys = activeMesh.map(m => m.replace(' (%)',' (g)'))
    const allVals = meshKeys.map(k=>parseFloat(newGrams[k])).filter(v=>!isNaN(v)&&v>0)
    const warns: string[] = []
    if (allVals.length>=2) {
      const total = allVals.reduce((a,b)=>a+b,0)
      if (total>0&&total<50) warns.push(`Total grams only ${total.toFixed(1)}g — very low`)
      else if (total>500)    warns.push(`Total grams ${total.toFixed(1)}g — unusually high`)
    }
    // Per-fraction outlier check against recent similar runs
    const recentSimilar = productRuns.filter((r:any)=>r.variant===form.variant&&r.runType==='in-process').slice(-20)
    if (recentSimilar.length>=3 && Object.keys(pcts).length>0) {
      activeMesh.forEach(m=>{
        const newPct=parseFloat(pcts[m]); if(isNaN(newPct)) return
        const hist=recentSimilar.map((r:any)=>parseFloat(r[m])).filter((v:any)=>!isNaN(v)&&v>0)
        if(hist.length<3) return
        const mean=hist.reduce((a:number,b:number)=>a+b,0)/hist.length
        const std=Math.sqrt(hist.map((v:number)=>(v-mean)**2).reduce((a:number,b:number)=>a+b,0)/hist.length)
        if(std>1.5&&Math.abs(newPct-mean)>2.5*std) warns.push(`${m.replace(' (%)','')}: ${newPct.toFixed(1)}% far from avg ${mean.toFixed(1)}%`)
      })
    }
    setAnomalyWarn(warns.length?`⚠ ${warns.join(' | ')}`:'')

  }

  function validate(f: any, retest = false) {
    const errs: Record<string,string> = {}
    if (!specDef.noLotNumber&&!f.lotNumber.trim()) errs.lotNumber='Lot number is required'
    if (!f.date)              errs.date='Date is required'
    if (!f.qcName.trim())     errs.qcName='QC controller is required'
    if (!f.grade)             errs.grade='Grade is required'
    if (!f.variant)           errs.variant='Variant is required'
    if (!f.runType)           errs.runType='Run type is required'
    if (f.runType==='in-process') {
      if (!f.serialNumber.trim()) {
        errs.serialNumber='Serial number is required'
      }
      if (!f.time.trim()) errs.time='Time is required'
    }
    if (!retest&&f.time&&f.time.trim()&&f.lotNumber&&f.date) {
      const dup = productRuns.find((r:any)=>r.lotNumber===f.lotNumber&&r.date===f.date&&r.time===f.time.trim()&&r.runType===f.runType)
      if (dup) errs._dupTime=`A ${f.runType} run for lot ${f.lotNumber} already exists at ${f.time} on ${f.date}. Mark as Re-test.`
    }
    if (f.runType!=='final') {
      const hasMesh = activeMesh.some(m=>f[m]!==''&&f[m]!==undefined&&f[m]!==null)
      if (!hasMesh) errs._mesh='Please enter at least one sieve result'
    }
    if (!specDef.noBulkDensity&&(f.bulkDensity===''||f.bulkDensity==null)) errs.bulkDensity='Bulk density is required'
    if (specDef.hasLeafShade&&!f.leafShade) errs.leafShade='Leaf shade is required (1–11)'
    if (f.leafShade) { const ls=parseInt(f.leafShade,10); if (isNaN(ls)||ls<1||ls>11) errs.leafShade='Leaf shade must be 1–11' }
    return errs
  }

  async function addRun() {
    const errs = validate(form, isRetest)
    setErrors(errs)
    if (Object.keys(errs).length>0) return
    const specRow = activeSpecs[specKey] || {}
    const violations: string[] = []
    activeMesh.forEach(m=>{
      const v=parseFloat(form[m]); const spec=specRow[m]
      if (!isNaN(v)&&spec&&!(spec[0]===0&&spec[1]===0)) {
        if (spec[0]!==null&&v<spec[0]) violations.push(`${m}: ${v.toFixed(1)}% below min ${spec[0]}%`)
        if (spec[1]!==null&&v>spec[1]) violations.push(`${m}: ${v.toFixed(1)}% above max ${spec[1]}%`)
      }
    })
    const sieveResults: any = {}
    activeMesh.forEach(m=>{ if (form[m]!==''&&form[m]!=null) sieveResults[m]=form[m] })
    const newRun = {
      product:       activeProduct,
      date:          form.date,
      lot_number:    form.lotNumber||null,
      serial_number: form.serialNumber||null,
      grade:         form.grade||null,
      variant:       form.variant||null,
      run_type:      form.runType||null,
      qc_name:       form.qcName||null,
      time_of_run:   form.time||null,
      needle_count:  form.needleCount||null,
      leaf_shade:    form.leafShade||null,
      bulk_density:  form.bulkDensity||null,
      comment:       form.comment||null,
      pa_level:      form.paLevel||form.manualPaLevel||null,
      pass_status:   violations.length===0?'Pass':'Fail',
      violations,
      gram_values:   gramValues,
      sieve_results: sieveResults,
      edit_history:  [],
    }
    setSaving(true)
    const { data: saved, error } = await db.schema('qms').from('sd_runs').insert(newRun).select().single()
    if (error) { setSdError('Could not save run: '+error.message); setSaving(false); return }
    const mapped = mapDbRow(saved)
    setRuns(prev=>({ ...prev, [activeProduct]: [...(prev[activeProduct]||[]), mapped] }))
    setShowForm(false); setGramValues({}); setForm(blankForm()); setErrors({}); setIsRetest(false); setAnomalyWarn(''); setLotMsg('')
    setLastSaved(new Date()); setSaving(false)
  }

  async function deleteRun(id: any) {
    if (!confirm('Delete this sieving run? This cannot be undone.')) return
    await db.schema('qms').from('sd_runs').delete().eq('id', id)
    setRuns(prev=>({ ...prev, [activeProduct]: (prev[activeProduct]||[]).filter((r:any)=>r.id!==id) }))
  }

  async function saveSpecs(newSpecs: any) {
    const updated = { ...customSpecs, [activeProduct]: newSpecs }
    setCustomSpecs(updated)
    setShowSpecEditor(false)
    // Persist to Supabase directly
    try {
      await getDb().schema('qms').from('sieving_spec_overrides')
        .upsert({ product: activeProduct, specs: newSpecs }, { onConflict: 'product' })
    } catch (_) {
      // Non-fatal: specs saved in local state even if Supabase unreachable
    }
  }

  function doExcelExport() {
    if (!filteredRuns.length) { alert('No runs to export'); return }
    const mesh = [...new Set([...specDef.meshForORG, ...specDef.meshForCON])]
    exportSievingRuns(activeProduct, filteredRuns, mesh)
  }

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  const inputSt: React.CSSProperties = { padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:11, width:'100%', boxSizing:'border-box' }
  const errSt: React.CSSProperties   = { fontSize:10, color:'#dc2626', marginTop:2 }
  const ErrMsg = ({ field }: { field:string }) => errors[field] ? <div style={errSt}>⚠ {errors[field]}</div> : null

  return (
    <div className="p-5 max-w-[1400px]">
      {/* Status bar */}
      {loading && <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#eff6ff',borderRadius:7,marginBottom:10,fontSize:12,color:'#1e40af'}}>Loading sieving runs…</div>}
      {sdError && <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:7,marginBottom:10,fontSize:12,color:'#991b1b',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>⚠ {sdError}</span>
        <button onClick={()=>{setSdError('');load()}} style={{fontSize:11,padding:'2px 8px',borderRadius:5,border:'1px solid #fca5a5',background:'#fff',cursor:'pointer',color:'#991b1b'}}>Retry</button>
      </div>}
      {saving && <div style={{padding:'6px 12px',background:'#fefce8',borderRadius:7,marginBottom:10,fontSize:11,color:'#854d0e'}}>⏳ Saving…</div>}
      {!loading&&!sdError&&lastSaved && <div style={{display:'flex',justifyContent:'flex-end',marginBottom:6}}><span style={{fontSize:10,color:'#9ca3af'}}>✓ Synced {lastSaved.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>}

      {/* Product tabs */}
      <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
        {SD_PRODUCTS.map(p=>(
          <button key={p} onClick={()=>{setActiveProduct(p);setShowForm(false);setShowSpecEditor(false);setFilter('all');setEditRunId(null)}}
            style={{padding:'7px 16px',borderRadius:8,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
              background:activeProduct===p?'#1f4e79':'#f3f4f6',color:activeProduct===p?'#fff':'#374151'}}>
            {p}
            <span style={{marginLeft:5,fontSize:10,opacity:.7}}>({(runs[p]||[]).length})</span>
          </button>
        ))}
      </div>

      {/* Spec editor */}
      {showSpecEditor && <SievingSpecEditor product={activeProduct} specDef={specDef} customSpecs={activeSpecs} onSave={saveSpecs} onClose={()=>setShowSpecEditor(false)}/>}

      {/* Spec panel */}
      <div style={{marginBottom:14,borderRadius:10,border:'1px solid #e5e7eb',background:'#fff',overflow:'hidden'}}>
        <button onClick={()=>setShowSpecPanel(s=>!s)} style={{width:'100%',padding:'11px 16px',background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:'inherit'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:13,fontWeight:700,color:'#111827'}}>Specifications — {activeProduct}</span>
            <span style={{fontSize:10,color:'#9ca3af'}}>ORG/RA-ORG/FT-ORG use &gt;10 mesh · CON/RA-CON/FT-CON use &gt;12 mesh · {Object.keys(activeSpecs).length} variants (Export / Export Blend / Domestic)</span>
          </div>
          <span style={{fontSize:10,color:'#9ca3af',transform:showSpecPanel?'rotate(180deg)':'',transition:'.2s'}}>▼</span>
        </button>
        {showSpecPanel && (
          <div style={{padding:'0 16px 14px',overflowX:'auto'}}>
            <table style={{borderCollapse:'collapse',fontSize:11,width:'100%'}}>
              <thead>
                <tr style={{background:'#1f4e79',color:'#fff'}}>
                  <th style={{padding:'6px 10px',textAlign:'left'}}>Grade</th>
                  <th style={{padding:'6px 10px',textAlign:'center'}}>Variant</th>
                  {[...new Set([...specDef.meshForORG,...specDef.meshForCON])].sort().map(m=>(
                    <th key={m} style={{padding:'6px 8px',textAlign:'center'}}>{m.toUpperCase()}</th>
                  ))}
                  {specDef.hasLeafShade&&<th style={{padding:'6px 8px',textAlign:'center'}}>Leaf Shade</th>}
                </tr>
              </thead>
              <tbody>
                {Object.entries(activeSpecs).map(([vk,s]: any,i)=>{
                  const [g,v]=vk.split('|'); const gs=gradeStyle(g)
                  return (
                    <tr key={vk} style={{background:i%2===0?'#f9fafb':'#fff',borderBottom:'1px solid #f3f4f6'}}>
                      <td style={{padding:'6px 10px'}}><span style={{padding:'2px 9px',borderRadius:8,fontSize:10,fontWeight:700,background:gs.bg,color:gs.color}}>{g}</span></td>
                      <td style={{padding:'6px 10px',textAlign:'center'}}><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:sdIsOrg(v)?'#ede9fe':'#dbeafe',color:sdIsOrg(v)?'#7c3aed':'#1d4ed8'}}>{v}</span></td>
                      {[...new Set([...specDef.meshForORG,...specDef.meshForCON])].sort().map(m=>(
                        <td key={m} style={{padding:'6px 8px',textAlign:'center',fontFamily:'monospace',fontSize:11,color:s[m]&&!(s[m][0]===0&&s[m][1]===0)?'#374151':'#d1d5db'}}>
                          {s[m]&&!(s[m][0]===0&&s[m][1]===0)?`${s[m][0]}–${s[m][1]}%`:'—'}
                        </td>
                      ))}
                      {specDef.hasLeafShade&&<td style={{padding:'6px 8px',textAlign:'center',fontFamily:'monospace',fontSize:11}}>{s['Leaf Shade']?`${s['Leaf Shade'][0]??'—'}–${s['Leaf Shade'][1]??'—'}`:'—'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {canWrite && <button onClick={()=>{setShowForm(true);setShowSpecEditor(false);setEditRunId(null)}}
          style={{padding:'6px 14px',borderRadius:6,border:'none',background:'#166534',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>+ New Run</button>}
        {canWrite && <button onClick={()=>{setShowSpecEditor(s=>!s);setShowForm(false);setEditRunId(null)}}
          style={{padding:'5px 12px',borderRadius:6,border:'1px solid #7c3aed',fontSize:11,cursor:'pointer',fontWeight:600,
            background:showSpecEditor?'#7c3aed':'#faf5ff',color:showSpecEditor?'#fff':'#7c3aed'}}>
          {showSpecEditor?'× Close Editor':'Edit Specs'}</button>}
        {[['all','All'],['in-process','In-Process'],['final','Final QC']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)}
            style={{padding:'5px 12px',borderRadius:6,border:'1px solid',fontSize:11,cursor:'pointer',fontWeight:600,
              background:filter===k?'#1f4e79':'#fff',color:filter===k?'#fff':'#374151',borderColor:filter===k?'#1f4e79':'#e5e7eb'}}>{l}</button>
        ))}
        <span style={{marginLeft:'auto',fontSize:11,color:'#9ca3af'}}>{filteredRuns.length} run{filteredRuns.length!==1?'s':''}</span>
        <button onClick={doExcelExport} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #166534',fontSize:11,cursor:'pointer',fontWeight:600,background:'#f0fdf4',color:'#166534'}}>⬇ Export Excel</button>
        <button onClick={()=>setShowChart(s=>!s)} style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${showChart?'#1f4e79':'#e5e7eb'}`,fontSize:11,cursor:'pointer',fontWeight:600,background:showChart?'#eff6ff':'#fff',color:showChart?'#1f4e79':'#374151'}}>
          📈 {showChart?'Hide':'Show'} Chart
        </button>
        <button onClick={load} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e5e7eb',fontSize:11,cursor:'pointer'}}>↻ Refresh</button>
      </div>

      {/* New Run Form */}
      {showForm && canWrite && (
        <div style={{background:'#f8fafc',border:'2px solid #1f4e79',borderRadius:12,padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:15,color:'#1f4e79'}}>⊕ New {activeProduct} Run</div>
            <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setLotMsg('')}}
              style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#6b7280',lineHeight:1,padding:'0 4px'}}>×</button>
          </div>

          {/* Run Type — prominent tablet-friendly selector */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:10,fontWeight:700,color:errors.runType?'#dc2626':'#6b7280',display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Run Type *</label>
            <div style={{display:'flex',gap:8}}>
              {([['in-process','⚙ In-Process','#1f4e79'],['final','✓ Final QC','#166534']] as const).map(([val,label,col])=>(
                <button key={val} type="button" onClick={()=>setF('runType',val)}
                  style={{flex:1,padding:'13px 16px',borderRadius:8,border:`2px solid ${form.runType===val?col:'#d1d5db'}`,
                    background:form.runType===val?col:'#fff',color:form.runType===val?'#fff':'#374151',
                    fontSize:14,fontWeight:700,cursor:'pointer',transition:'all 0.15s',
                    boxShadow:form.runType===val?`0 2px 8px ${col}44`:'none'}}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {errors._dupTime&&<div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:6,fontSize:11,color:'#991b1b',marginBottom:10}}>⚠ {errors._dupTime}</div>}
          {errors._mesh&&<div style={{padding:'8px 12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:6,fontSize:11,color:'#92400e',marginBottom:10}}>⚠ {errors._mesh}</div>}
          {anomalyWarn&&<div style={{padding:'8px 12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:6,fontSize:11,color:'#92400e',marginBottom:10,fontWeight:600}}>{anomalyWarn}</div>}
          {lotMsg&&<div style={{padding:'6px 12px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:6,fontSize:10,color:'#166534',marginBottom:10}}>{lotMsg}</div>}

          {/* Row 1: basic info */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr)',gap:12,marginBottom:14}}>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.date?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Date *</label>
              <input type="date" value={form.date} onChange={e=>setF('date',e.target.value)} style={{...inputSt,borderColor:errors.date?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="date"/>
            </div>
            {!specDef.noLotNumber&&<div>
              <label style={{fontSize:10,fontWeight:700,color:errors.lotNumber?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Lot Number *</label>
              <input value={form.lotNumber} onChange={e=>{const v=e.target.value;setF('lotNumber',v);const auto=lookupLot(v);setForm((f:any)=>({...f,lotNumber:v,...auto}))}} style={{...inputSt,borderColor:errors.lotNumber?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="lotNumber"/>
            </div>}
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.serialNumber?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Serial No. {form.runType==='in-process'?'*':''}</label>
              <input value={form.serialNumber} onChange={e=>setF('serialNumber',e.target.value)} style={{...inputSt,borderColor:errors.serialNumber?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="serialNumber"/>
            </div>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.qcName?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>QC Controller *</label>
              <input value={form.qcName} onChange={e=>setF('qcName',e.target.value)} style={{...inputSt,borderColor:errors.qcName?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="qcName"/>
            </div>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.time?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Time {form.runType==='in-process'?'*':''}</label>
              <input type="text" placeholder="HH:MM" value={form.time} onChange={e=>setF('time',e.target.value)} style={{...inputSt,borderColor:errors.time?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="time"/>
            </div>
          </div>

          {/* Grade tabs */}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:10,fontWeight:700,color:errors.grade?'#dc2626':'#374151',display:'block',marginBottom:6,textTransform:'uppercase'}}>Grade *</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {SD_GRADES.map(g=>(
                <button key={g} type="button" onClick={()=>setF('grade',g)}
                  style={{flex:1,minWidth:80,padding:'9px 16px',borderRadius:7,border:`2px solid ${form.grade===g?'#1f4e79':'#d1d5db'}`,
                    background:form.grade===g?'#1f4e79':'#fff',color:form.grade===g?'#fff':'#374151',
                    fontSize:13,fontWeight:700,cursor:'pointer',transition:'all 0.15s'}}>
                  {g}
                </button>
              ))}
            </div>
            <ErrMsg field="grade"/>
          </div>

          {/* Variant + physical properties */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr)',gap:12,marginBottom:14}}>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.variant?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Variant *</label>
              <select value={form.variant} onChange={e=>setF('variant',e.target.value)} style={{...inputSt,background:'#fff',borderColor:errors.variant?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}>
                {SD_VARIANTS.map(v=><option key={v}>{v}</option>)}
              </select>
              <ErrMsg field="variant"/>
            </div>
            {!specDef.noBulkDensity&&<div>
              <label style={{fontSize:10,fontWeight:700,color:errors.bulkDensity?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Bulk Density (cc/100g) *</label>
              <input type="number" step="any" value={form.bulkDensity} onChange={e=>setF('bulkDensity',e.target.value)} style={{...inputSt,borderColor:errors.bulkDensity?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="bulkDensity"/>
            </div>}
            <div>
              <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>
                PA Level {form.paLevel&&<span style={{fontSize:9,color:'#166534',fontWeight:400,marginLeft:4}}>✓ auto</span>}
              </label>
              <select value={form.paLevel||form.manualPaLevel} onChange={e=>setF('paLevel',e.target.value)}
                style={{...inputSt,background:form.paLevel?'#f0fdf4':'#fff',borderColor:form.paLevel?'#86efac':'#d1d5db',padding:'9px 10px',fontSize:13}}>
                <option value="">— not set —</option>
                {['P0','P1','P2','P3','FAIL'].map(lv=><option key={lv}>{lv}</option>)}
              </select>
            </div>
            {specDef.hasLeafShade&&<div>
              <label style={{fontSize:10,fontWeight:700,color:errors.leafShade?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>
                Leaf Shade (1–11) {form.leafShade&&<span style={{fontSize:9,color:'#166534',fontWeight:400,marginLeft:4}}>✓ auto</span>}
              </label>
              <input type="number" min="1" max="11" step="1" value={form.leafShade} onChange={e=>setF('leafShade',e.target.value)} style={{...inputSt,borderColor:errors.leafShade?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="leafShade"/>
            </div>}
            {specDef.hasNeedleCount&&form.runType!=='final'&&<div>
              <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Needle Count</label>
              <input type="number" step="any" value={form.needleCount} onChange={e=>setF('needleCount',e.target.value)} style={{...inputSt,padding:'9px 10px',fontSize:13}}/>
            </div>}
            <div style={{gridColumn:'1 / -1'}}>
              <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Comment</label>
              <input value={form.comment} onChange={e=>setF('comment',e.target.value)} style={{...inputSt,padding:'9px 10px',fontSize:13}}/>
            </div>
          </div>

          {/* Sieve fractions — in-process only */}
          {form.runType!=='final'&&activeMesh.length>0&&(
            <div style={{background:'#fff',borderRadius:8,border:'1px solid #e5e7eb',padding:14,marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:12,color:'#1f4e79',marginBottom:10}}>⚙ Sieve Results</div>
              <div style={{overflowX:'auto'}}>
                <table style={{borderCollapse:'collapse',fontSize:11,width:'100%'}}>
                  <thead><tr style={{background:'#1f4e79',color:'#fff'}}>
                    <th style={{padding:'6px 8px',textAlign:'left'}}>Fraction</th>
                    <th style={{padding:'6px 8px',textAlign:'center'}}>Grams (g)</th>
                    <th style={{padding:'6px 8px',textAlign:'center'}}>Result (%)</th>
                    <th style={{padding:'6px 8px',textAlign:'center'}}>Spec</th>
                    <th style={{padding:'6px 8px',textAlign:'center'}}>Status</th>
                  </tr></thead>
                  <tbody>
                    {activeMesh.map((m,i)=>{
                      const gKey=m.replace(' (%)',' (g)')
                      const spec=activeSpec[m]
                      const chk=sdChk(form[m],spec)
                      return (
                        <tr key={m} style={{background:i%2===0?'#fff':'#f9fafb',borderBottom:'1px solid #f3f4f6'}}>
                          <td style={{padding:'5px 8px',fontWeight:600}}>{m}</td>
                          <td style={{padding:'4px 8px'}}>
                            <input type="number" step="any" value={gramValues[gKey]||''} onChange={e=>handleGramChange(gKey,e.target.value)}
                              placeholder="g" style={{width:100,padding:'6px 8px',border:'1px solid #bfdbfe',borderRadius:5,fontSize:12,textAlign:'center',boxSizing:'border-box'}}/>
                          </td>
                          <td style={{padding:'5px 8px',textAlign:'center',fontFamily:'monospace',fontWeight:700,fontSize:13,color:chk==='fail'?'#dc2626':chk==='pass'?'#166534':'#374151'}}>
                            {form[m]?form[m]+'%':'—'}
                          </td>
                          <td style={{padding:'5px 8px',textAlign:'center',fontSize:10,color:'#6b7280'}}>
                            {spec&&!(spec[0]===0&&spec[1]===0)?`${spec[0]}–${spec[1]}%`:'—'}
                          </td>
                          <td style={{padding:'5px 8px',textAlign:'center',fontSize:11,fontWeight:700,color:chk==='fail'?'#dc2626':chk==='pass'?'#166534':'#9ca3af'}}>
                            {chk==='fail'?'⚠ FAIL':chk==='pass'?'✓':'—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {form.runType==='final'&&<div style={{padding:'10px 14px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:7,marginBottom:14,fontSize:11,color:'#166534'}}>
            ✓ Final QC — no sieve fractions required. Enter bulk density and leaf shade above.
          </div>}

          {/* Retest + save */}
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:'pointer',fontWeight:500}}>
              <input type="checkbox" checked={isRetest} onChange={e=>setIsRetest(e.target.checked)} style={{width:17,height:17}}/>
              Mark as Re-test
            </label>
            <div style={{marginLeft:'auto',display:'flex',gap:8}}>
              <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setLotMsg('')}}
                style={{padding:'10px 20px',borderRadius:7,border:'1px solid #d1d5db',background:'#fff',fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={addRun} disabled={saving}
                style={{padding:'10px 26px',borderRadius:7,border:'none',background:saving?'#9ca3af':'#166534',color:'#fff',fontSize:13,fontWeight:700,cursor:saving?'default':'pointer'}}>
                {saving?'Saving…':'✓ Save Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Runs table */}
      {/* Trend chart */}
      {showChart && filteredRuns.length > 0 && (
        <SievingChart
          runs={filteredRuns}
          specDef={specDef}
          activeSpecs={activeSpecs}
          activeProduct={activeProduct}
          onDotClick={(runId) => {
            setHighlightedRunId(runId)
            const el = document.getElementById(`run-row-${runId}`)
            el?.scrollIntoView({ behavior:'smooth', block:'center' })
            setTimeout(() => setHighlightedRunId(null), 3000)
          }}
        />
      )}

      {!loading&&filteredRuns.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:'#9ca3af',fontSize:11}}>No {activeProduct} {filter!=='all'?filter+' ':''} runs yet — click "+ New Run"</div>}
      {!loading&&filteredRuns.length>0&&(
        <div style={{borderRadius:10,border:'1px solid #e5e7eb',background:'#fff',overflow:'hidden'}}>
          <button onClick={()=>setTableCollapsed(c=>!c)}
            style={{width:'100%',padding:'10px 16px',background:'#1f4e79',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',color:'#fff',fontFamily:'inherit'}}>
            <span style={{fontSize:12,fontWeight:700}}>Runs — {filteredRuns.length} record{filteredRuns.length!==1?'s':''}</span>
            <span style={{fontSize:10,opacity:.7,transform:tableCollapsed?'rotate(0deg)':'rotate(180deg)',transition:'transform .2s',display:'inline-block'}}>▲</span>
          </button>
          {!tableCollapsed&&<div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse',fontSize:11,width:'100%'}}>
            <thead>
              <tr style={{background:'#1f4e79',color:'#fff',position:'sticky',top:0,zIndex:2}}>
                {canWrite&&<th style={{padding:'5px 4px',width:22}}></th>}
                <th style={{padding:'5px 8px',textAlign:'left',whiteSpace:'nowrap'}}>Date</th>
                {!specDef.noLotNumber&&<th style={{padding:'5px 8px',textAlign:'left'}}>Lot</th>}
                <th style={{padding:'5px 8px',textAlign:'left'}}>Serial</th>
                <th style={{padding:'5px 8px'}}>Grade</th>
                <th style={{padding:'5px 8px'}}>Var.</th>
                <th style={{padding:'5px 8px'}}>Type</th>
                <th style={{padding:'5px 8px'}}>QC</th>
                <th style={{padding:'5px 8px'}}>Time</th>
                {!specDef.noBulkDensity&&<th style={{padding:'5px 8px'}}>BD</th>}
                {specDef.hasNeedleCount&&<th style={{padding:'5px 8px',fontSize:9}}>Needles</th>}
                {specDef.hasLeafShade&&<th style={{padding:'5px 8px',fontSize:9}}>Shade</th>}
                {sdGetMesh(activeProduct,'CON').map(m=><th key={m} style={{padding:'5px 6px',textAlign:'center',fontSize:9}}>{m.replace(' (%)','')}</th>)}
                <th style={{padding:'5px 8px'}}>Status</th>
                <th style={{padding:'5px 8px',fontSize:9,color:'#bfdbfe'}}>Violations</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((row:any,i:number)=>{
                const vios: string[] = row.violations||[]
                const isHighlighted = row.id === highlightedRunId
                const rowBg = isHighlighted?'#fef9c3':vios.length>0?(i%2===0?'#fff5f5':'#fff0f0'):(i%2===0?'#fafafa':'#fff')
                const mesh  = sdGetMesh(activeProduct, row.variant)
                const gs    = gradeStyle(row.grade)
                const sc    = statusColors(row.passStatus)
                return (
                  <React.Fragment key={row.id}>
                  <tr id={`run-row-${row.id}`} style={{background:rowBg,borderBottom:'1px solid #f3f4f6',transition:'background 0.6s',outline:isHighlighted?'2px solid #fbbf24':'none',outlineOffset:'-2px'}}>
                    {canWrite&&<td style={{padding:'3px 4px',textAlign:'center'}}>
                      <button onClick={()=>setEditRunId(editRunId===row.id?null:row.id)}
                        style={{background:'none',border:`1px solid ${editRunId===row.id?'#166534':'#d1d5db'}`,borderRadius:4,color:editRunId===row.id?'#166534':'#374151',cursor:'pointer',fontSize:11,padding:'2px 6px',marginBottom:2,display:'block'}}>
                        ✏️
                      </button>
                      <button onClick={()=>deleteRun(row.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:12,padding:'0 2px'}} title="Delete">🗑</button>
                    </td>}
                    <td style={{padding:'3px 8px',fontFamily:'monospace',fontSize:10,whiteSpace:'nowrap'}}>{row.date}</td>
                    {!specDef.noLotNumber&&<td style={{padding:'3px 8px',fontWeight:700,fontFamily:'monospace',fontSize:10,whiteSpace:'nowrap'}}>{row.lotNumber}</td>}
                    <td style={{padding:'3px 8px',fontSize:10,color:'#6b7280'}}>{row.serialNumber||'—'}</td>
                    <td style={{padding:'3px 6px',textAlign:'center',whiteSpace:'nowrap'}}><span style={{padding:'1px 7px',borderRadius:8,fontSize:9,fontWeight:700,background:gs.bg,color:gs.color}}>{row.grade}</span></td>
                    <td style={{padding:'3px 6px',textAlign:'center'}}><span style={{padding:'1px 6px',borderRadius:8,fontSize:9,fontWeight:700,background:sdIsOrg(row.variant)?'#ede9fe':'#dbeafe',color:sdIsOrg(row.variant)?'#7c3aed':'#1d4ed8'}}>{row.variant}</span></td>
                    <td style={{padding:'3px 6px',fontSize:10,textAlign:'center'}}>{row.runType}</td>
                    <td style={{padding:'3px 8px',fontSize:10}}>{row.qcName||'—'}</td>
                    <td style={{padding:'3px 8px',fontFamily:'monospace',textAlign:'center'}}>{row.time||'—'}</td>
                    {!specDef.noBulkDensity&&<td style={{padding:'3px 8px',textAlign:'center'}}>{row.bulkDensity||'—'}</td>}
                    {specDef.hasNeedleCount&&<td style={{padding:'3px 8px',textAlign:'center',color:parseFloat(row.needleCount)>15?'#dc2626':'inherit'}}>{row.needleCount||'—'}</td>}
                    {specDef.hasLeafShade&&<td style={{padding:'3px 8px',textAlign:'center'}}>{row.leafShade||'—'}</td>}
                    {sdGetMesh(activeProduct,'CON').map(m=>{
                      const spec=activeSpec[m]
                      const chk=sdChk(row[m],spec)
                      return <td key={m} style={{padding:'3px 5px',textAlign:'center',fontFamily:'monospace',fontSize:10,background:chk==='fail'?'#fef2f2':'',color:chk==='fail'?'#dc2626':chk==='pass'?'#166534':'inherit',fontWeight:chk!=='neutral'?700:400}}>{row[m]!=null&&row[m]!==''?row[m]+'%':'—'}</td>
                    })}
                    <td style={{padding:'3px 8px',textAlign:'center'}}>
                      <span style={{padding:'2px 8px',borderRadius:8,fontSize:9,fontWeight:700,background:sc.bg,color:sc.color,border:`1px solid ${sc.border}`}}>{row.passStatus||'—'}</span>
                    </td>
                    <td style={{padding:'3px 8px',fontSize:9,color:'#dc2626',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={vios.join('; ')}>
                      {vios.length>0?`⚠ ${vios.length} violation${vios.length>1?'s':''}`:''}</td>
                  </tr>
                  {editRunId===row.id && (
                    <tr key={`edit-${row.id}`}><td colSpan={20} style={{padding:0}}>
                      <InlineEditForm
                        run={row}
                        specDef={specDef}
                        activeSpecs={activeSpecs}
                        onSave={async (updated: any) => {
                          const vios: string[] = []
                          const sr = activeSpecs[`${updated.grade}|${updated.variant}`]||{}
                          const mesh = sdGetMesh(activeProduct, updated.variant)
                          mesh.forEach((m: string) => {
                            const sp = sr[m]; if (!sp) return
                            const v = parseFloat(updated[m]); if (isNaN(v)) return
                            if (sp[0]!==0&&v<sp[0]) vios.push(`${m} ${v.toFixed(1)}% < min ${sp[0]}%`)
                            if (sp[1]!==0&&v>sp[1]) vios.push(`${m} ${v.toFixed(1)}% > max ${sp[1]}%`)
                          })
                          const dbRow: any = {
                            date: updated.date, lot_number: updated.lotNumber||null,
                            serial_number: updated.serialNumber||null, grade: updated.grade,
                            variant: updated.variant, run_type: updated.runType,
                            qc_name: updated.qcName||null, time_of_run: updated.time||null,
                            bulk_density: updated.bulkDensity||null,
                            needle_count: updated.needleCount||null, leaf_shade: updated.leafShade||null,
                            comment: updated.comment||null, pa_level: updated.paLevel||null,
                            pass_status: vios.length===0?'Pass':'Fail', violations: vios,
                            gram_values: updated.gramValues||{},
                            sieve_results: Object.fromEntries(
                              (sdIsOrg(updated.variant)?specDef.meshForORG:specDef.meshForCON).map((m: string)=>[m,updated[m]||''])
                            ),
                            edit_history: [...(row.editHistory||[]), { at: new Date().toISOString(), by: 'user' }],
                          }
                          const { error } = await getDb().schema('qms').from('sd_runs').update(dbRow).eq('id', row.id)
                          if (error) { alert('Save failed: '+error.message); return }
                          setRuns((prev: any) => ({ ...prev, [activeProduct]: (prev[activeProduct]||[]).map((r: any) =>
                            r.id!==row.id ? r : mapDbRow({ ...r, ...dbRow, id: row.id })
                          )}))
                          setEditRunId(null)
                        }}
                        onCancel={()=>setEditRunId(null)}
                      />
                    </td></tr>
                  )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
          </div>}
        </div>
      )}
    </div>
  )
}