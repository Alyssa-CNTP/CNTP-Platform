'use client'

// app/(app)/quality/sieving/page.tsx
// Full parity with SievingDashboard in CNTPquality.
// Data: qms.sd_runs (product, date, lot_number, serial_number, grade, variant,
//        run_type, qc_name, time_of_run, needle_count, leaf_shade, bulk_density,
//        comment, pa_level, pass_status, violations[], gram_values{}, sieve_results{})

import React, { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { useAuth } from '@/lib/auth/context'
import { getDb } from '@/lib/supabase/db'
import { isoDate } from '@/lib/utils/formatDate'
import { checkOutlier, mean, stdDev } from '@/lib/utils/outliers'
import { isNegative } from '@/lib/utils/validation'
import { exportSievingRuns } from '@/lib/utils/exportExcel'
import { useQcNames } from '@/lib/hooks/useQcNames'
import QCNameField from '@/components/shared/QCNameField'

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

// ─── SievingOutlierChart ────────────────────────────────────────────────────
// Bounded to "This Week" (bucketed by day) or "This Month" (bucketed by
// week-of-month) — never the full history — so it never becomes the
// unreadable "all runs" chart it replaced. Two views share that same window:
//   Mesh Trend — every sieve fraction as its own line (like the old chart)
//   Outliers   — one chosen metric plotted with a ±2.5σ band, flagging points
//                 outside it (Bulk Density, Leaf Shade, or a sieve fraction)

const TREND_LINE_COLORS = ['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#6b7280','#84cc16']

function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = s.getDay() || 7 // Monday-based week
  s.setDate(s.getDate() - dow + 1)
  return s
}

// weekOffset/monthOffset: 0 = current, 1 = one week/month back, 2 = two back, etc.
// Negative values are allowed (future) so "Next" can step back toward today.
function dayBucketsForWeek(weekOffset: number): { key: string; label: string }[] {
  const anchor = new Date(); anchor.setDate(anchor.getDate() - weekOffset * 7)
  const start = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i)
    return { key: isoDate(d), label: d.toLocaleDateString('en-ZA', { weekday: 'short' }) + ' ' + d.getDate() }
  })
}

function weekRangeLabel(weekOffset: number): string {
  const buckets = dayBucketsForWeek(weekOffset)
  const from = new Date(buckets[0].key + 'T12:00:00'), to = new Date(buckets[6].key + 'T12:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
  return `${fmt(from)} – ${fmt(to)}${from.getFullYear() !== new Date().getFullYear() ? ' ' + from.getFullYear() : ', ' + from.getFullYear()}`
}

function weekBucketsForMonth(monthOffset: number): { key: string; label: string; from: Date; to: Date }[] {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 0)
  const buckets: { key: string; label: string; from: Date; to: Date }[] = []
  let cursor = new Date(monthStart)
  let i = 1
  while (cursor <= monthEnd) {
    const from = new Date(cursor)
    const to   = new Date(Math.min(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 6).getTime(), monthEnd.getTime()))
    buckets.push({ key: `W${i}`, label: `Week ${i}`, from, to })
    cursor.setDate(cursor.getDate() + 7)
    i++
  }
  return buckets
}

function monthRangeLabel(monthOffset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function SievingOutlierChart({ runs, activeProduct, specDef, onPointClick }: {
  runs: any[]; activeProduct: string; specDef: any; onPointClick?: (runId: any) => void
}) {
  const [view, setView]           = useState<'week' | 'month'>('week')
  const [chartType, setChartType] = useState<'trend' | 'outliers'>('trend')
  const [weekOffset, setWeekOffset]   = useState(0)   // 0 = this week, 1 = last week, ...
  const [monthOffset, setMonthOffset] = useState(0)   // 0 = this month, 1 = last month, ...
  const offset = view === 'week' ? weekOffset : monthOffset
  const setOffset = view === 'week' ? setWeekOffset : setMonthOffset
  const meshOptions = sdGetMesh(activeProduct, 'CON')
  const metricOptions = [
    { key: 'bulkDensity', label: 'Bulk Density', suffix: '' },
    ...(specDef.hasLeafShade ? [{ key: 'leafShade', label: 'Leaf Shade', suffix: '' }] : []),
    ...meshOptions.map(m => ({ key: m, label: m.replace(' (%)', ''), suffix: '%' })),
  ]
  const [metric, setMetric] = useState(metricOptions[0].key)
  const metricDef = metricOptions.find(m => m.key === metric) || metricOptions[0]

  // Bucket definitions for the selected window — day-of-week for "This Week",
  // week-of-month for "This Month". Runs outside the window are excluded.
  // weekOffset/monthOffset step the window back in time — a timeline, not
  // just the current week/month.
  const dayBuckets  = dayBucketsForWeek(weekOffset)
  const weekBuckets = weekBucketsForMonth(monthOffset)
  const rangeLabel  = view === 'week' ? weekRangeLabel(weekOffset) : monthRangeLabel(monthOffset)
  const bucketOf = (dateStr: string): string | null => {
    if (view === 'week') {
      const key = dateStr
      return dayBuckets.some(b => b.key === key) ? key : null
    }
    const d = new Date(dateStr + 'T12:00:00')
    const b = weekBuckets.find(wb => d >= wb.from && d <= wb.to)
    return b ? b.key : null
  }
  const bucketLabels = view === 'week' ? dayBuckets : weekBuckets

  const inWindow = runs.filter((r: any) => r.date && bucketOf(r.date) != null)

  // ── Mesh Trend data: one row per bucket, one column per sieve fraction (mean) ──
  const trendData = bucketLabels.map(b => {
    const rows = inWindow.filter((r: any) => r.runType === 'in-process' && bucketOf(r.date) === b.key)
    const entry: any = { period: b.label }
    meshOptions.forEach(m => {
      const vals = rows.map((r: any) => parseFloat(r[m])).filter((v: number) => !isNaN(v))
      entry[m] = vals.length ? +mean(vals).toFixed(1) : null
    })
    return entry
  })
  const hasTrendData = trendData.some(row => meshOptions.some(m => row[m] != null))

  // ── Outliers data: every run in the window for the chosen metric, ±2.5σ band ──
  const points = inWindow
    .map((r: any) => ({ period: bucketLabels.find(b => b.key === bucketOf(r.date))?.label || '', value: parseFloat(r[metric]), run: r }))
    .filter((p: any) => !isNaN(p.value))
  const values = points.map((p: any) => p.value)
  const m = mean(values), sd = stdDev(values)
  const upper = m + 2.5 * sd, lower = m - 2.5 * sd
  const scatterData = points.map((p: any) => ({
    period: p.period, value: p.value, runId: p.run.id,
    label: `${p.run.lotNumber || p.run.serialNumber || '—'} · ${p.run.date}`,
    isOutlier: sd > 0 && (p.value > upper || p.value < lower),
  }))
  const outlierCount = scatterData.filter((d: any) => d.isOutlier).length

  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, padding:14, marginBottom:16 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
        <div style={{ display:'flex', border:'1px solid #d1d5db', borderRadius:6, overflow:'hidden' }}>
          {(['trend','outliers'] as const).map(t => (
            <button key={t} onClick={()=>setChartType(t)}
              style={{ padding:'5px 12px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer',
                background:chartType===t?'#166534':'#fff', color:chartType===t?'#fff':'#374151' }}>
              {t==='trend'?'📈 Mesh Trend':'⚠ Outliers'}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', border:'1px solid #d1d5db', borderRadius:6, overflow:'hidden' }}>
          {(['week','month'] as const).map(v => (
            <button key={v} onClick={()=>setView(v)}
              style={{ padding:'5px 12px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer',
                background:view===v?'#1f4e79':'#fff', color:view===v?'#fff':'#374151' }}>
              {v==='week'?'By Week':'By Month'}
            </button>
          ))}
        </div>
        {/* Timeline navigator — step back through previous weeks/months */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={()=>setOffset((o:number)=>o+1)} title={`Previous ${view}`}
            style={{ padding:'4px 8px', fontSize:12, border:'1px solid #d1d5db', borderRadius:6, background:'#fff', cursor:'pointer' }}>◀</button>
          <span style={{ fontSize:11, fontWeight:700, color:'#374151', minWidth:120, textAlign:'center' }}>{rangeLabel}</span>
          <button onClick={()=>setOffset((o:number)=>Math.max(0,o-1))} disabled={offset===0} title={`Next ${view}`}
            style={{ padding:'4px 8px', fontSize:12, border:'1px solid #d1d5db', borderRadius:6, background:offset===0?'#f3f4f6':'#fff', color:offset===0?'#d1d5db':'#374151', cursor:offset===0?'default':'pointer' }}>▶</button>
          {offset!==0 && (
            <button onClick={()=>setOffset(0)} style={{ padding:'4px 10px', fontSize:11, fontWeight:600, border:'1px solid #1f4e79', borderRadius:6, background:'#eff6ff', color:'#1f4e79', cursor:'pointer' }}>Today</button>
          )}
        </div>
        {chartType==='outliers' && (
          <select value={metric} onChange={e=>setMetric(e.target.value)}
            style={{ padding:'4px 8px', fontSize:11, border:'1px solid #d1d5db', borderRadius:6, background:'#fff' }}>
            {metricOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
        {chartType==='outliers' && outlierCount>0 && (
          <span style={{ fontSize:11, fontWeight:700, color:'#dc2626', marginLeft:'auto' }}>
            ⚠ {outlierCount} outlier{outlierCount!==1?'s':''} (&gt;2.5σ from mean)
          </span>
        )}
      </div>

      {chartType==='trend' ? (
        !hasTrendData ? (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#9ca3af', fontSize:11 }}>
            No in-process sieve results for {rangeLabel} yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top:8, right:20, left:0, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="period" tick={{ fontSize:10 }} />
              <YAxis tick={{ fontSize:10 }} unit="%" width={40} />
              <Tooltip formatter={(v:any)=>v==null?'—':`${v}%`} />
              <Legend wrapperStyle={{ fontSize:10 }} />
              {meshOptions.map((m,i) => (
                <Line key={m} dataKey={m} name={m.replace(' (%)','')} stroke={TREND_LINE_COLORS[i%TREND_LINE_COLORS.length]}
                  strokeWidth={2} dot={{ r:3 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )
      ) : (
        scatterData.length < 3 ? (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#9ca3af', fontSize:11 }}>
            Not enough {metricDef.label.toLowerCase()} data for {rangeLabel} to plot outliers.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top:8, right:20, left:0, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="period" type="category" tick={{ fontSize:10 }} />
              <YAxis dataKey="value" tick={{ fontSize:10 }} unit={metricDef.suffix} width={44} />
              <Tooltip formatter={(v:any)=>`${v}${metricDef.suffix}`}
                labelFormatter={(_l:any, payload:any) => payload?.[0]?.payload?.label || ''} />
              {!isNaN(m) && <ReferenceLine y={m} stroke="#6b7280" strokeDasharray="4 2" label={{ value:'mean', fontSize:9, fill:'#6b7280' }} />}
              {sd>0 && <ReferenceLine y={upper} stroke="#f59e0b" strokeDasharray="3 3" />}
              {sd>0 && <ReferenceLine y={lower} stroke="#f59e0b" strokeDasharray="3 3" />}
              <Scatter data={scatterData} onClick={(d:any)=>onPointClick?.(d?.runId ?? d?.payload?.runId)} cursor="pointer">
                {scatterData.map((d:any,i:number) => <Cell key={i} fill={d.isOutlier?'#dc2626':'#3b82f6'} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )
      )}
    </div>
  )
}

function InlineEditForm({ run, specDef, activeSpecs, onSave, onCancel, qcNames }: {
  run: any; specDef: any; activeSpecs: Record<string,any>
  onSave: (f: any) => void; onCancel: () => void; qcNames: string[]
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

  function handleSaveClick() {
    if (isNegative(fields.bulkDensity)) { alert('Bulk density cannot be negative.'); return }
    if (isNegative(fields.needleCount)) { alert('Needle count cannot be negative.'); return }
    if (Object.keys(gramVals).some(k => isNegative(gramVals[k]))) { alert('Sieve grams cannot be negative.'); return }
    if (editMesh.some((m: string) => isNegative(pcts[m]))) { alert('Sieve percentages cannot be negative.'); return }
    if (fields.runType === 'in-process') {
      const missing = editMesh.filter((m: string) => pcts[m] === '' || pcts[m] == null)
      if (missing.length > 0) { alert(`All sieve mesh results are required for an In-Process run — missing: ${missing.map((m: string) => m.replace(' (%)', '')).join(', ')}`); return }
    }
    onSave({ ...fields, ...pcts, gramValues: gramVals })
  }

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
              {key==='qcName' ? (
                <QCNameField value={(fields as any)[key]} onChange={v=>setF(key,v)} names={qcNames} style={inputSt} />
              ) : (
                <input type={type} min={type==='number'?0:undefined} value={(fields as any)[key]} onChange={e=>setF(key,e.target.value)} style={inputSt}/>
              )}
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
            <input type="number" min="0" value={fields.needleCount} onChange={e=>setF('needleCount',e.target.value)} style={inputSt}/>
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
            return <input key={gKey} type="number" min="0" step="0.1" placeholder="g" value={gramVals[gKey]??''}
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
            return <input key={m} type="number" min="0" step="0.1" placeholder="%" value={val}
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
        <button onClick={handleSaveClick}
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
  const qcNames = useQcNames()

  const [activeProduct, setActiveProduct] = useState('Fine Leaf')
  const [runs, setRuns] = useState<Record<string,any[]>>({})
  const [customSpecs, setCustomSpecs] = useState<Record<string,any>>(
    Object.fromEntries(SD_PRODUCTS.map(p => [p, JSON.parse(JSON.stringify(SIEVING_SPECS_DB[p].variants))]))
  )
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [sdError,   setSdError]   = useState('')
  const [lastSaved, setLastSaved] = useState<Date|null>(null)

  const [showForm,       setShowForm]       = useState(false)
  const [showSpecEditor, setShowSpecEditor] = useState(false)
  const [showSpecPanel,  setShowSpecPanel]  = useState(true)
  const [filter,         setFilter]         = useState('all')
  const [period,         setPeriod]         = useState<'today'|'week'|'month'|'60d'|'all'>('all')
  const [searchText,     setSearchText]     = useState('')
  const [sdSort,         setSdSort]         = useState<{key:string;dir:'asc'|'desc'}>({ key:'date', dir:'desc' })
  const [editRunId,      setEditRunId]      = useState<any>(null)
  const [errors,         setErrors]         = useState<Record<string,string>>({})
  const [isRetest,       setIsRetest]       = useState(false)
  const [anomalyWarn,    setAnomalyWarn]    = useState('')
  const [confirmAnomaly, setConfirmAnomaly] = useState(false)
  const [lotMsg,         setLotMsg]         = useState('')
  const [paLookup,       setPaLookup]       = useState<Record<string,string>>({})
  const [rLookup,        setRLookup]        = useState<Record<string,string>>({})
  const [leafShadeLookup,setLeafShadeLookup]= useState<Record<string,number>>({})
  const [tableCollapsed, setTableCollapsed] = useState(false)
  const [showOutlierChart, setShowOutlierChart] = useState(true)
  const [chartHighlightId, setChartHighlightId] = useState<any>(null)

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

  // Period cutoff — Daily / Weekly / Monthly / 60 Days / All. Dates are stored
  // as 'YYYY-MM-DD' so lexicographic comparison against the cutoff works.
  const periodCutoff = (() => {
    if (period === 'all') return null
    const d = new Date()
    if (period === 'today') return isoDate(d)
    if (period === 'week')  d.setDate(d.getDate() - 7)
    if (period === 'month') d.setMonth(d.getMonth() - 1)
    if (period === '60d')   d.setDate(d.getDate() - 60)
    return isoDate(d)
  })()

  // Global search — case-insensitive substring match across every displayed
  // field (date, lot, serial, grade, variant, type, QC, time, BD, needles,
  // shade, every sieve %, status, violations).
  const rowSearchText = (row: any) => [
    row.date, row.lotNumber, row.serialNumber, row.grade, row.variant, row.runType,
    row.qcName, row.time, row.bulkDensity, row.needleCount, row.leafShade, row.passStatus,
    ...sdGetMesh(activeProduct, row.variant).map(m => row[m]),
    ...(row.violations || []),
  ].filter(Boolean).join(' ').toLowerCase()

  // Column sort — click a header to sort by it (toggles asc/desc).
  const sortKeyVal = (row: any, key: string): string|number => {
    switch (key) {
      case 'date':        return (row.date||'')+(row.time||'')
      case 'lotNumber':   return (row.lotNumber||'').toLowerCase()
      case 'serialNumber':return (row.serialNumber||'').toLowerCase()
      case 'grade':       return (row.grade||'').toLowerCase()
      case 'variant':     return (row.variant||'').toLowerCase()
      case 'runType':     return (row.runType||'').toLowerCase()
      case 'qcName':      return (row.qcName||'').toLowerCase()
      case 'time':        return row.time||''
      case 'bulkDensity': { const v = parseFloat(row.bulkDensity); return isNaN(v) ? -Infinity : v }
      case 'needleCount': { const v = parseFloat(row.needleCount); return isNaN(v) ? -Infinity : v }
      case 'leafShade':   { const v = parseFloat(row.leafShade); return isNaN(v) ? -Infinity : v }
      case 'passStatus':  return (row.passStatus||'').toLowerCase()
      case 'violations':  return (row.violations||[]).length
      default: { const v = parseFloat(row[key]); return isNaN(v) ? -Infinity : v }   // sieve mesh columns
    }
  }
  const toggleSort = (key: string) =>
    setSdSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const filteredRuns = (filter==='all' ? productRuns : productRuns.filter((r:any) => r.runType===filter))
    .filter((r:any) => !periodCutoff || (r.date||'') >= periodCutoff)
    .filter((r:any) => !searchText.trim() || rowSearchText(r).includes(searchText.trim().toLowerCase()))
    .slice().sort((a:any,b:any) => {
      const va = sortKeyVal(a, sdSort.key), vb = sortKeyVal(b, sdSort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sdSort.dir === 'asc' ? cmp : -cmp
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
    // Simple absolute sanity check on total grams (not a statistical outlier check).
    const meshKeys = activeMesh.map(m => m.replace(' (%)',' (g)'))
    const allVals = meshKeys.map(k=>parseFloat(newGrams[k])).filter(v=>!isNaN(v)&&v>0)
    if (allVals.length>=2) {
      const total = allVals.reduce((a,b)=>a+b,0)
      if (total>0&&total<50) setAnomalyWarn(`⚠ Total grams only ${total.toFixed(1)}g — very low`)
      else if (total>500)    setAnomalyWarn(`⚠ Total grams ${total.toFixed(1)}g — unusually high`)
      else setAnomalyWarn('')
    } else setAnomalyWarn('')
  }

  // ── Variation / outlier detection vs recent similar runs ──
  // Flags a value only when recent history already has real spread (std >
  // floor) AND the new value sits >2.5 std away. Covers sieve mesh %
  // (in-process only), Bulk Density and Leaf Shade (both run types).
  const outlierWarnings: string[] = (() => {
    const warns: string[] = []
    const checkField = (hist: any[], key: string, label: string, cur: any, stdFloor: number, unit = '') => {
      const n = parseFloat(cur); if (isNaN(n)) return
      const histVals = hist.map((r:any)=>parseFloat(r[key])).filter((v:number)=>!isNaN(v)&&v>0)
      const result = checkOutlier(n, histVals, stdFloor)
      if (result?.flagged) warns.push(`${label}: ${n}${unit} far from recent avg ${result.mean.toFixed(1)}${unit}`)
    }
    const histInProcess = productRuns.filter((r:any)=>r.variant===form.variant&&r.runType==='in-process').slice(-20)
    const histAny        = productRuns.filter((r:any)=>r.variant===form.variant).slice(-30)
    if (form.runType!=='final') activeMesh.forEach(m => checkField(histInProcess, m, m.replace(' (%)',''), form[m], 1.5, '%'))
    checkField(histAny, 'bulkDensity', 'Bulk Density', form.bulkDensity, 5)
    checkField(histAny, 'leafShade', 'Leaf Shade', form.leafShade, 0.5)
    return warns
  })()

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
    if (f.runType==='in-process') {
      // In-Process requires every mesh fraction filled in — no partial sieve results.
      const missing = activeMesh.filter(m=>f[m]===''||f[m]===undefined||f[m]===null)
      if (missing.length>0) errs._mesh=`All sieve mesh results are required for an In-Process run — missing: ${missing.map(m=>m.replace(' (%)','')).join(', ')}`
    }
    if (!specDef.noBulkDensity&&(f.bulkDensity===''||f.bulkDensity==null)) errs.bulkDensity='Bulk density is required'
    if (specDef.hasLeafShade&&!f.leafShade) errs.leafShade='Leaf shade is required (1–11)'
    if (f.leafShade) { const ls=parseInt(f.leafShade,10); if (isNaN(ls)||ls<1||ls>11) errs.leafShade='Leaf shade must be 1–11' }
    // No captured value may be negative.
    if (!errs._mesh && Object.keys(gramValues).some(k=>isNegative(gramValues[k]))) errs._mesh='Sieve grams cannot be negative'
    if (isNegative(f.bulkDensity)) errs.bulkDensity='Bulk density cannot be negative'
    if (isNegative(f.needleCount)) errs.needleCount='Needle count cannot be negative'
    return errs
  }

  async function addRun() {
    const errs = validate(form, isRetest)
    setErrors(errs)
    if (Object.keys(errs).length>0) return
    if (outlierWarnings.length>0 && !confirmAnomaly) { alert('Please tick "Yes, these values are correct" before saving.'); return }
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
    setShowForm(false); setGramValues({}); setForm(blankForm()); setErrors({}); setIsRetest(false); setAnomalyWarn(''); setConfirmAnomaly(false); setLotMsg('')
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
        <button onClick={load} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e5e7eb',fontSize:11,cursor:'pointer'}}>↻ Refresh</button>
      </div>

      {/* Period filter — Daily / Weekly / Monthly / 60 Days / All */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:10,fontWeight:700,color:'#6b7280',textTransform:'uppercase'}}>Period:</span>
        {([['today','Daily'],['week','Weekly'],['month','Monthly'],['60d','60 Days'],['all','All']] as const).map(([k,l])=>(
          <button key={k} onClick={()=>setPeriod(k)}
            style={{padding:'5px 12px',borderRadius:6,border:'1px solid',fontSize:11,cursor:'pointer',fontWeight:600,
              background:period===k?'#166534':'#fff',color:period===k?'#fff':'#374151',borderColor:period===k?'#166534':'#e5e7eb'}}>{l}</button>
        ))}
        <div style={{marginLeft:'auto',position:'relative',minWidth:220}}>
          <input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="🔍 Search this table…"
            style={{width:'100%',padding:'6px 30px 6px 10px',fontSize:11,border:'1px solid #d1d5db',borderRadius:6,boxSizing:'border-box'}}/>
          {searchText && (
            <button onClick={()=>setSearchText('')} title="Clear search"
              style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:13}}>✕</button>
          )}
        </div>
      </div>

      {/* New Run Form */}
      {showForm && canWrite && (
        <div style={{background:'#f8fafc',border:'2px solid #1f4e79',borderRadius:12,padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:15,color:'#1f4e79'}}>⊕ New {activeProduct} Run</div>
            <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setConfirmAnomaly(false);setLotMsg('')}}
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

          {/* Variation / outlier warnings — require explicit confirmation before saving */}
          {outlierWarnings.length>0 && (
            <div style={{padding:'10px 12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:11,color:'#92400e',marginBottom:4}}>⚠ Unusual variation — please double-check before saving</div>
              <ul style={{margin:'0 0 8px 18px',padding:0}}>
                {outlierWarnings.map((w,i)=><li key={i} style={{fontSize:11,color:'#92400e'}}>{w}</li>)}
              </ul>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:11,fontWeight:600,color:'#92400e',cursor:'pointer'}}>
                <input type="checkbox" checked={confirmAnomaly} onChange={e=>setConfirmAnomaly(e.target.checked)} />
                Yes, these values are correct
              </label>
            </div>
          )}
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
              <QCNameField value={form.qcName} onChange={v=>setF('qcName',v)} names={qcNames} style={{...inputSt,borderColor:errors.qcName?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
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
              <input type="number" min="0" step="any" value={form.bulkDensity} onChange={e=>setF('bulkDensity',e.target.value)} style={{...inputSt,borderColor:errors.bulkDensity?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
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
              <label style={{fontSize:10,fontWeight:700,color:errors.needleCount?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Needle Count</label>
              <input type="number" min="0" step="any" value={form.needleCount} onChange={e=>setF('needleCount',e.target.value)} style={{...inputSt,borderColor:errors.needleCount?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="needleCount"/>
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
                            <input type="number" min="0" step="any" value={gramValues[gKey]||''} onChange={e=>handleGramChange(gKey,e.target.value)}
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
              <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setConfirmAnomaly(false);setLotMsg('')}}
                style={{padding:'10px 20px',borderRadius:7,border:'1px solid #d1d5db',background:'#fff',fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={addRun} disabled={saving || (outlierWarnings.length>0 && !confirmAnomaly)}
                style={{padding:'10px 26px',borderRadius:7,border:'none',background:(saving||(outlierWarnings.length>0 && !confirmAnomaly))?'#9ca3af':'#166534',color:'#fff',fontSize:13,fontWeight:700,cursor:(saving||(outlierWarnings.length>0 && !confirmAnomaly))?'default':'pointer'}}>
                {saving?'Saving…':'✓ Save Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* This Week / This Month chart — mesh trend + outlier view. Bounded window, not full history. */}
      <div style={{marginBottom:8}}>
        <button onClick={()=>setShowOutlierChart(s=>!s)}
          style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${showOutlierChart?'#1f4e79':'#e5e7eb'}`,fontSize:11,cursor:'pointer',fontWeight:600,background:showOutlierChart?'#eff6ff':'#fff',color:showOutlierChart?'#1f4e79':'#374151'}}>
          📈 {showOutlierChart?'Hide':'Show'} Chart
        </button>
      </div>
      {showOutlierChart && productRuns.length>0 && (
        <SievingOutlierChart runs={productRuns} activeProduct={activeProduct} specDef={specDef}
          onPointClick={(runId)=>{
            setChartHighlightId(runId)
            const el = document.getElementById(`run-row-${runId}`)
            el?.scrollIntoView({ behavior:'smooth', block:'center' })
            setTimeout(()=>setChartHighlightId(null), 3000)
          }} />
      )}

      {/* Runs table */}

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
                {([
                  ['date','Date',true],
                  ...(specDef.noLotNumber?[]:[['lotNumber','Lot',true]]),
                  ['serialNumber','Serial',true],
                  ['grade','Grade',false],
                  ['variant','Var.',false],
                  ['runType','Type',false],
                  ['qcName','QC',false],
                  ['time','Time',false],
                  ...(specDef.noBulkDensity?[]:[['bulkDensity','BD',false]]),
                  ...(specDef.hasNeedleCount?[['needleCount','Needles',false]]:[]),
                  ...(specDef.hasLeafShade?[['leafShade','Shade',false]]:[]),
                ] as [string,string,boolean][]).map(([key,label,left])=>(
                  <th key={key} onClick={()=>toggleSort(key)}
                    style={{padding:'5px 8px',textAlign:left?'left':'center',whiteSpace:'nowrap',cursor:'pointer',userSelect:'none'}}
                    title="Click to sort">
                    {label}{sdSort.key===key?(sdSort.dir==='asc'?' ▲':' ▼'):''}
                  </th>
                ))}
                {sdGetMesh(activeProduct,'CON').map(m=>(
                  <th key={m} onClick={()=>toggleSort(m)} style={{padding:'5px 6px',textAlign:'center',fontSize:9,cursor:'pointer',userSelect:'none'}} title="Click to sort">
                    {m.replace(' (%)','')}{sdSort.key===m?(sdSort.dir==='asc'?' ▲':' ▼'):''}
                  </th>
                ))}
                <th onClick={()=>toggleSort('passStatus')} style={{padding:'5px 8px',cursor:'pointer',userSelect:'none'}} title="Click to sort">
                  Status{sdSort.key==='passStatus'?(sdSort.dir==='asc'?' ▲':' ▼'):''}
                </th>
                <th onClick={()=>toggleSort('violations')} style={{padding:'5px 8px',fontSize:9,color:'#bfdbfe',cursor:'pointer',userSelect:'none'}} title="Click to sort">
                  Violations{sdSort.key==='violations'?(sdSort.dir==='asc'?' ▲':' ▼'):''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((row:any,i:number)=>{
                const vios: string[] = row.violations||[]
                const isHighlighted = row.id === chartHighlightId
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
                        qcNames={qcNames}
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