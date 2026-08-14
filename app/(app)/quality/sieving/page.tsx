'use client'

// app/(app)/quality/sieving/page.tsx
// Full parity with SievingDashboard in CNTPquality.
// Data: qms.sd_runs (product, date, lot_number, serial_number, grade, variant,
//        run_type, qc_name, time_of_run, needle_count, leaf_shade, bulk_density,
//        comment, pa_level, pass_status, violations[], gram_values{}, sieve_results{})

import React, { useState, useEffect, useCallback } from 'react'
import {
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell,
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
      'Export|Conventional':          {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|RA-Conventional':       {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      // IPS-SIEV-003.2 Export ORG/RA-ORG: >6:Max1, >10:>70, >18:5-15, >40:<5, Dust:Max1
      'Export|Organic':          {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|RA-Organic':       {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|FT-Conventional':       {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export|FT-Organic':       {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|Conventional':    {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|RA-Conventional': {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|Organic':    {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|RA-Organic': {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|FT-Conventional': {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Export Blend|FT-Organic': {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      // IPS-SIEV-003 Domestic CON/RA-CON: same mesh as Export CON
      'Domestic|Conventional':        {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|RA-Conventional':     {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|Organic':        {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|RA-Organic':     {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|FT-Conventional':     {'>6 (%)':[0,1],'>12 (%)':[80,100],'>18 (%)':[10,20],'>40 (%)':[0,5],'Dust (%)':[0,1]},
      'Domestic|FT-Organic':     {'>6 (%)':[0,1],'>10 (%)':[70,100],'>18 (%)':[5,15],'>40 (%)':[0,5],'Dust (%)':[0,1]},
    },
  },
  'Coarse Leaf': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust'],
    labels: ['>6','>10','>12','>18','>40','Dust'],
    // CON/RA-CON/FT-CON use >12 mesh; ORG/RA-ORG/FT-ORG use >10 mesh
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)'],
    hasLeafShade: true, hasNeedleCount: true, needle_max: 12, qcFieldsFinalOnly: true,
    volumetrics: '280-340', leaf_shade: '1-3 (Domestic) / 4-11 (Export)', temp_range: '85-105',
    variants: {
      // IPS-SIEV-002.1 Export CON/RA-CON: >12:5-25, >18:60-85, >40:5-20, Dust:0-1, Shade:4-11
      'Export|Conventional':          {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|RA-Conventional':       {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // IPS-SIEV-002.2 Export ORG/RA-ORG: >10:25-100, >18:65-85, >40:10-20, Dust:0-1, Shade:4-11
      'Export|Organic':          {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|RA-Organic':       {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|FT-Conventional':       {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export|FT-Organic':       {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // Export Blend: same mesh values as Export
      'Export Blend|Conventional':    {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|RA-Conventional': {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|Organic':    {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|RA-Organic': {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|FT-Conventional': {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      'Export Blend|FT-Organic': {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[4,11]},
      // IPS-SIEV-002 Domestic CON/RA-CON: same mesh, Shade:1-3
      'Domestic|Conventional':        {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|RA-Conventional':     {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|Organic':        {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|RA-Organic':     {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|FT-Conventional':     {'>12 (%)':[5,25],'>18 (%)':[60,85],'>40 (%)':[5,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
      'Domestic|FT-Organic':     {'>10 (%)':[25,100],'>18 (%)':[65,85],'>40 (%)':[10,20],'Dust (%)':[0,1],'Leaf Shade':[1,3]},
    },
  },
  'Fine Leaf': {
    sieves: ['gt6','gt10','gt12','gt18','gt40','dust'],
    labels: ['>6','>10','>12','>18','>40','Dust'],
    // CON/RA-CON/FT-CON use >12 mesh; ORG/RA-ORG/FT-ORG use >10 mesh (IPS-SIEV-001.2)
    meshForORG: ['>6 (%)','>10 (%)','>18 (%)','>40 (%)','Dust (%)'],
    meshForCON: ['>6 (%)','>12 (%)','>18 (%)','>40 (%)','Dust (%)'],
    hasLeafShade: true, hasNeedleCount: true, needle_max: 12, qcFieldsFinalOnly: true,
    volumetrics: '280-340', leaf_shade: '1-3 (Domestic) / 4-11 (Export)', temp_range: '85-105',
    variants: {
      // IPS-SIEV-001.1 Export CON/RA-CON: >12:0-1, >18:15-35, >40:50-85, Dust:0-2, Shade:4-11
      'Export|Conventional':          {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export|RA-Conventional':       {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      // IPS-SIEV-001.2 Export ORG/RA-ORG: >10:0-1, >18:15-35, >40:50-85, Dust:0-5, Shade:4-11
      'Export|Organic':          {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export|RA-Organic':       {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export|FT-Conventional':       {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export|FT-Organic':       {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      // Export Blend: same mesh values as Export
      'Export Blend|Conventional':    {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|RA-Conventional': {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|Organic':    {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export Blend|RA-Organic': {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      'Export Blend|FT-Conventional': {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[4,11]},
      'Export Blend|FT-Organic': {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[4,11]},
      // IPS-SIEV-001 Domestic CON/RA-CON: same mesh, Shade:1-3
      'Domestic|Conventional':        {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|RA-Conventional':     {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|Organic':        {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
      'Domestic|RA-Organic':     {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
      'Domestic|FT-Conventional':     {'>12 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,2],'Leaf Shade':[1,3]},
      'Domestic|FT-Organic':     {'>10 (%)':[0,1],'>18 (%)':[15,35],'>40 (%)':[50,85],'Dust (%)':[0,5],'Leaf Shade':[1,3]},
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
      'Export|Conventional':          {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|RA-Conventional':       {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      // IPS-SIEV-005.2 Export ORG/RA-ORG: >6:5-25, >10:40-65, >18:15-35, >40:<5, Dust:Max1, Fine Tea:<25
      'Export|Organic':          {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|RA-Organic':       {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|FT-Conventional':       {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export|FT-Organic':       {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|Conventional':    {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|RA-Conventional': {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|Organic':    {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|RA-Organic': {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|FT-Conventional': {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Export Blend|FT-Organic': {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      // IPS-SIEV-005 Domestic CON/RA-CON: >6:5-25, >12:40-65, >18:10-25, >40:<5, Dust:Max1, Fine Tea:<25
      'Domestic|Conventional':        {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|RA-Conventional':     {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|Organic':        {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|RA-Organic':     {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|FT-Conventional':     {'>6 (%)':[5,25],'>12 (%)':[40,65],'>18 (%)':[10,25],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
      'Domestic|FT-Organic':     {'>6 (%)':[5,25],'>10 (%)':[40,65],'>18 (%)':[15,35],'>40 (%)':[0,5],'Dust (%)':[0,1],'Fine Leaf (%)':[0,25]},
    },
  },
}

const SD_GRADES   = ['Export','Export Blend','Domestic']
const SD_VARIANTS = ['Conventional','Organic','RA-Organic','RA-Conventional','FT-Conventional','FT-Organic']
const SD_PRODUCTS = Object.keys(SIEVING_SPECS_DB)

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Kept case/spelling-tolerant (not a strict list match) so it still works for
// any historical row not yet normalized by normProdVariant() below.
function sdIsOrg(v: string) {
  const s = (v || '').trim().toLowerCase()
  return s.includes('organic') || s === 'org' || s === 'ra-org' || s === 'ft-org'
}
// Same normalisation used everywhere a lot number keys into paLookup/
// rLookup/leafShadeLookup, so a bag's lot always matches its raw-material
// record regardless of dash spacing ("GS-0098" / "GS 0098" / "gs-0098").
function lotKeyOf(lot: string | null | undefined) { return (lot || '').trim().toUpperCase().replace(/\s*-\s*/g, '-') }
// Mirrors qms.norm_sd_product() (supabase/migrations/20260807_001_sieving_bag_qc_link.sql)
// — used client-side to classify a raw production.prod_bagging Realtime insert
// payload, since a SQL function can't be called from the browser.
function normSdProductJs(p: string | null | undefined): string | null {
  if (!p) return null
  const s = p.toLowerCase()
  if (s.includes('coarse leaf')) return 'Coarse Leaf'
  if (s.includes('fine leaf')) return 'Fine Leaf'
  if (s.includes('indent stick')) return 'Indent Sticks'
  if (s.includes('rb block') || s.includes('rooibos block') || s.trim() === 'blocks') return 'Rooibos Blocks'
  return null
}
// Sieving output serials encode their output type: ST{TYPE}-DDMMYY-NNN, e.g.
// STFL-130826-001 is Fine Leaf and STCL-130826-001 is Coarse Leaf. Mirrors
// SIEVING_TYPE_ABBR in components/production/capture/SievingCapture.tsx, which
// generates them. Only the codes that map to a sieve tab are listed — anything
// else (dust, spillage, an unknown two-letter stem) is not a QC product and is
// deliberately left unrecognised.
// Formats a UTC timestamp as its Africa/Johannesburg (SAST) calendar date,
// YYYY-MM-DD — matching the <input type="date"> value format. A plain
// `.slice(0,10)` on the raw UTC string is off by one for anything tagged
// between 00:00-01:59 SAST (still "yesterday" in UTC).
function sastDateStr(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}
// The default (and only fetched) window for the runs table and chart — see
// load()'s query filter below. 'YYYY-MM-DD' so it compares lexicographically
// against sd_runs.date the same way the rest of the file does.
function threeMonthsAgoISO(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return isoDate(d)
}
// qms.sd_runs (and SIEVING_SPECS_DB / SD_VARIANTS) now spell variant out in
// full — 'Conventional', 'Organic', 'RA-Conventional', 'RA-Organic',
// 'FT-Conventional', 'FT-Organic' — matching production.prod_bagging /
// production.bag_tags' own CHECK constraint, EXCEPT that constraint only
// actually contains the abbreviated 'FT-ORG' (no 'FT-Conventional' has ever
// been written there). Any bag-driven auto-fill that copies a production
// `variant` straight into the form without going through this first risks
// storing whatever production happens to spell it as — historically that was
// short codes ('CON'), producing two different spellings of the same variant
// in the runs table and silently missing spec lookups keyed on
// `${grade}|${variant}`. Kept tolerant of both the current full words and the
// old short codes so a historical row or an unmapped upstream value still
// normalizes correctly instead of falling through unrecognized.
function normProdVariant(v: string | null | undefined): string {
  const s = (v || '').trim()
  if (!s) return ''
  if ((SD_VARIANTS as string[]).includes(s)) return s
  const key = s.toUpperCase()
  const map: Record<string,string> = {
    'CONVENTIONAL': 'Conventional', 'ORGANIC': 'Organic',
    'RA-CONVENTIONAL': 'RA-Conventional', 'RA-ORGANIC': 'RA-Organic',
    'FT-CONVENTIONAL': 'FT-Conventional', 'FT-ORGANIC': 'FT-Organic',
    'CON': 'Conventional', 'ORG': 'Organic',
    'RA-CON': 'RA-Conventional', 'RA-ORG': 'RA-Organic',
    'FT-CON': 'FT-Conventional', 'FT-ORG': 'FT-Organic',
  }
  return map[key] || s
}
const SERIAL_CODE_TO_PRODUCT: Record<string, string> = {
  FL: 'Fine Leaf', CL: 'Coarse Leaf', IS: 'Indent Sticks', RB: 'Rooibos Blocks',
}
// Returns the product a serial belongs to when it's a recognisable ST-serial,
// else null. Legacy hand-typed serials ("13.08.05") return null so they keep
// working — this only ever blocks a serial that provably belongs elsewhere.
function productOfSerial(serial: string | null | undefined): string | null {
  const m = String(serial || '').trim().toUpperCase().match(/^ST([A-Z]{2})-/)
  return m ? (SERIAL_CODE_TO_PRODUCT[m[1]] ?? null) : null
}
// The error message to show when a serial belongs to a different sieve than the
// tab being captured on, or null when it's fine.
function serialTabMismatch(serial: string | null | undefined, activeProduct: string): string | null {
  const p = productOfSerial(serial)
  return p && p !== activeProduct
    ? `${String(serial).trim()} is a ${p} bag — it can't be used on the ${activeProduct} tab. Switch to the ${p} tab, or pick a ${activeProduct} serial.`
    : null
}
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
    baggingId:    r.bagging_id||'',
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
// Bucketed over whatever [rangeStart, rangeEnd] the page's date-range slicer
// is set to — the same window the records table below it is filtered to, so
// the two always show the same slice of history instead of the chart having
// its own separate navigation. Granularity adapts to the span so it stays
// readable at any zoom level:
//   single day   → by hour (same-shift visibility for an out-of-spec reading)
//   up to ~9 wks → by day
//   longer       → by Monday-based week
// Two chart types share that same window:
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
function fmtShort(d: Date): string { return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) }

type ChartBucket = { key: string; label: string; from?: Date; to?: Date }
type ChartGranularity = 'hour' | 'day' | 'week'

// Picks a granularity and the buckets covering [startISO, endISO] (inclusive,
// 'YYYY-MM-DD') at that granularity. A single-day range gets hour buckets so
// a same-shift out-of-spec reading is still visible before the day rolls
// over; anything wider than ~9 weeks steps up to weekly so the chart doesn't
// try to plot 90+ individual day-points.
function bucketsForRange(startISO: string, endISO: string): { granularity: ChartGranularity; buckets: ChartBucket[]; label: string } {
  const start = new Date(startISO + 'T00:00:00'), end = new Date(endISO + 'T00:00:00')
  const spanDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000))
  const label = spanDays === 0
    ? start.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : `${fmtShort(start)} – ${fmtShort(end)}${start.getFullYear() !== end.getFullYear() ? ' ' + start.getFullYear() : ', ' + end.getFullYear()}`

  if (spanDays === 0) {
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      key: `${startISO}T${String(h).padStart(2, '0')}`, label: `${String(h).padStart(2, '0')}:00`,
    }))
    return { granularity: 'hour', buckets, label }
  }
  if (spanDays <= 62) {
    const buckets: ChartBucket[] = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      buckets.push({ key: isoDate(d), label: fmtShort(d) })
    }
    return { granularity: 'day', buckets, label }
  }
  const buckets: ChartBucket[] = []
  let cursor = startOfWeek(start)
  while (cursor <= end) {
    const from = new Date(cursor)
    const to = new Date(cursor); to.setDate(to.getDate() + 6)
    buckets.push({ key: isoDate(from), label: `${fmtShort(from)} – ${fmtShort(to)}`, from, to })
    cursor.setDate(cursor.getDate() + 7)
  }
  return { granularity: 'week', buckets, label }
}

// Representative spec key used for the mesh-trend reference band. The %
// mesh bounds are identical across Export/Domestic for a given Conventional/
// Organic mesh set in every product in SIEVING_SPECS_DB — only Leaf Shade
// differs by grade — so "Export|Conventional" is a safe stand-in for the
// trend view, which isn't scoped to one grade/variant.
const TREND_SPEC_KEY = 'Export|Conventional'

function SievingOutlierChart({ runs, activeProduct, specDef, activeSpecs, rangeStart, rangeEnd, view, offset, onViewChange, onOffsetChange, onPointClick }: {
  runs: any[]; activeProduct: string; specDef: any; activeSpecs?: Record<string,any>
  rangeStart: string; rangeEnd: string
  view: 'day' | 'week' | 'month'; offset: number
  onViewChange: (v: 'day' | 'week' | 'month') => void; onOffsetChange: (updater: (o: number) => number) => void
  onPointClick?: (runId: any) => void
}) {
  const [chartType, setChartType] = useState<'trend' | 'outliers'>('trend')
  const meshOptions = sdGetMesh(activeProduct, 'Conventional')
  const metricOptions = [
    { key: 'bulkDensity', label: 'Bulk Density', suffix: '' },
    ...(specDef.hasLeafShade ? [{ key: 'leafShade', label: 'Leaf Shade', suffix: '' }] : []),
    ...meshOptions.map(m => ({ key: m, label: m.replace(' (%)', ''), suffix: '%' })),
  ]
  const [metric, setMetric] = useState(metricOptions[0].key)
  const metricDef = metricOptions.find(m => m.key === metric) || metricOptions[0]

  // Granularity and buckets adapt to the slicer's span — see bucketsForRange().
  // Runs outside [rangeStart, rangeEnd] are excluded (the parent already
  // scopes `runs` to this same window, but the guard is cheap and keeps this
  // component correct standalone too).
  const { granularity, buckets: bucketLabels, label: rangeLabel } = bucketsForRange(rangeStart, rangeEnd)
  const bucketKeyFor = (r: any): string | null => {
    if (!r.date || r.date < rangeStart || r.date > rangeEnd) return null
    if (granularity === 'hour') {
      const hh = parseInt((r.time || '').split(':')[0], 10)
      if (isNaN(hh) || hh < 0 || hh > 23) return null
      return `${r.date}T${String(hh).padStart(2, '0')}`
    }
    if (granularity === 'day') return r.date
    const d = new Date(r.date + 'T12:00:00')
    const b = bucketLabels.find(wb => wb.from && wb.to && d >= wb.from && d <= wb.to)
    return b ? b.key : null
  }

  const inWindow = runs.filter((r: any) => bucketKeyFor(r) != null)

  // Spec band per mesh — see TREND_SPEC_KEY note above.
  const specSource = activeSpecs || specDef.variants
  const specBoundsFor = (m: string): { min: number; max: number } | null => {
    const range = specSource?.[TREND_SPEC_KEY]?.[m]
    return Array.isArray(range) ? { min: range[0], max: range[1] } : null
  }

  // ── Mesh Trend data: one row per bucket, one column per sieve fraction (mean) ──
  const trendData = bucketLabels.map(b => {
    const rows = inWindow.filter((r: any) => r.runType === 'in-process' && bucketKeyFor(r) === b.key)
    const entry: any = { period: b.label }
    meshOptions.forEach(m => {
      const vals = rows.map((r: any) => parseFloat(r[m])).filter((v: number) => !isNaN(v))
      const val = vals.length ? +mean(vals).toFixed(1) : null
      entry[m] = val
      const bounds = specBoundsFor(m)
      entry[`${m}__oos`] = val != null && !!bounds && (val < bounds.min || val > bounds.max)
    })
    return entry
  })
  const hasTrendData = trendData.some(row => meshOptions.some(m => row[m] != null))

  // ── Outliers data: every run in the window for the chosen metric, ±2.5σ band ──
  const points = inWindow
    .map((r: any) => ({ period: bucketLabels.find(b => b.key === bucketKeyFor(r))?.label || '', value: parseFloat(r[metric]), run: r }))
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
          {(['day','week','month'] as const).map(v => (
            <button key={v} onClick={()=>onViewChange(v)}
              style={{ padding:'5px 12px', fontSize:11, fontWeight:600, border:'none', cursor:'pointer',
                background:view===v?'#1f4e79':'#fff', color:view===v?'#fff':'#374151' }}>
              {v==='day'?'By Hour':v==='week'?'By Week':'By Month'}
            </button>
          ))}
        </div>
        {/* Timeline navigator — step back through previous days/weeks/months.
            The window it sets drives both this chart and the records table
            below, so they always show the same slice of history. */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button onClick={()=>onOffsetChange((o:number)=>o+1)} title={`Previous ${view}`}
            style={{ padding:'4px 8px', fontSize:12, border:'1px solid #d1d5db', borderRadius:6, background:'#fff', cursor:'pointer' }}>◀</button>
          <span style={{ fontSize:11, fontWeight:700, color:'#374151', minWidth:120, textAlign:'center' }}>{rangeLabel}</span>
          <button onClick={()=>onOffsetChange((o:number)=>Math.max(0,o-1))} disabled={offset===0} title={`Next ${view}`}
            style={{ padding:'4px 8px', fontSize:12, border:'1px solid #d1d5db', borderRadius:6, background:offset===0?'#f3f4f6':'#fff', color:offset===0?'#d1d5db':'#374151', cursor:offset===0?'default':'pointer' }}>▶</button>
          {offset!==0 && (
            <button onClick={()=>onOffsetChange(()=>0)} style={{ padding:'4px 10px', fontSize:11, fontWeight:600, border:'1px solid #1f4e79', borderRadius:6, background:'#eff6ff', color:'#1f4e79', cursor:'pointer' }}>Today</button>
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
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:14 }}>
            {meshOptions.map((m,i) => {
              const bounds = specBoundsFor(m)
              const oosCount = trendData.filter(row => row[`${m}__oos`]).length
              const lineColor = TREND_LINE_COLORS[i%TREND_LINE_COLORS.length]
              // Padded domain covering both the data and the spec band, so the
              // out-of-spec shading never forces the axis to a fixed 0-100 —
              // that would flatten a tight-spec mesh like Dust (0-1%) flat.
              const vals = trendData.map(row => row[m]).filter((v: any) => v != null)
              const lo = Math.min(...vals, bounds?.min ?? Infinity)
              const hi = Math.max(...vals, bounds?.max ?? -Infinity)
              const finiteLo = isFinite(lo) ? lo : 0, finiteHi = isFinite(hi) ? hi : 100
              const pad = Math.max(1, (finiteHi - finiteLo) * 0.2)
              const domainMin = Math.max(0, finiteLo - pad), domainMax = finiteHi + pad
              return (
                <div key={m} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 12px 4px' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#1f2937' }}>{m.replace(' (%)','')}</span>
                    <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                      {bounds && <span style={{ fontSize:10, color:'#6b7280', fontWeight:600 }}>Spec {bounds.min}–{bounds.max}%</span>}
                      {oosCount>0 && <span style={{ fontSize:10, fontWeight:700, color:'#dc2626' }}>🚩 {oosCount} out of spec</span>}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={trendData} margin={{ top:6, right:12, left:0, bottom:2 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                      <XAxis dataKey="period" tick={{ fontSize:9 }} interval={granularity==='hour'?2:0} />
                      <YAxis tick={{ fontSize:9 }} unit="%" width={36} domain={[domainMin, domainMax]} />
                      <Tooltip formatter={(v:any)=>v==null?'—':`${v}%`} />
                      {/* Spec band — in-spec shaded green, out-of-spec zones shaded a dark red so it's unmistakable at a glance, plus solid dark boundary lines */}
                      {bounds && (
                        <>
                          <ReferenceArea y1={domainMin} y2={bounds.min} fill="#7f1d1d" fillOpacity={0.16} />
                          <ReferenceArea y1={bounds.min} y2={bounds.max} fill="#16a34a" fillOpacity={0.07} />
                          <ReferenceArea y1={bounds.max} y2={domainMax} fill="#7f1d1d" fillOpacity={0.16} />
                        </>
                      )}
                      {bounds && (
                        <ReferenceLine y={bounds.min} stroke="#111827" strokeWidth={1.5} label={{ value:`min ${bounds.min}%`, fontSize:9, fill:'#111827', position:'insideBottomLeft' }} />
                      )}
                      {bounds && (
                        <ReferenceLine y={bounds.max} stroke="#111827" strokeWidth={1.5} label={{ value:`max ${bounds.max}%`, fontSize:9, fill:'#111827', position:'insideTopLeft' }} />
                      )}
                      <Line
                        dataKey={m} name={m.replace(' (%)','')} stroke={lineColor} strokeWidth={2} connectNulls
                        dot={(props: any) => {
                          const { cx, cy, payload, index } = props
                          if (payload[m] == null) return <React.Fragment key={`d-${m}-${index}`} />
                          const bad = payload[`${m}__oos`]
                          return <circle key={`d-${m}-${index}`} cx={cx} cy={cy} r={bad?5:3.5} fill={bad?'#dc2626':lineColor} stroke={bad?'#7f1d1d':'#fff'} strokeWidth={bad?1.5:1} />
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
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
              <XAxis dataKey="period" type="category" tick={{ fontSize:10 }} interval={granularity==='hour'?1:0} />
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

// ─── Sieving range-nav helpers ──────────────────────────────────────────────
// Replaces the dual-handle slider with the original clickable By Hour/Week/
// Month navigator. offset steps back in time (0 = current); the parent owns
// one offset per view so switching tabs doesn't lose your place in the others.
function dayForOffset(offset: number): Date { const d = new Date(); d.setDate(d.getDate() - offset); return d }
function weekRangeForOffset(offset: number): { start: Date; end: Date } {
  const anchor = new Date(); anchor.setDate(anchor.getDate() - offset * 7)
  const start = startOfWeek(anchor)
  const end = new Date(start); end.setDate(start.getDate() + 6)
  return { start, end }
}
function monthRangeForOffset(offset: number): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0)
  return { start, end }
}

function InlineEditForm({ run, specDef, activeSpecs, onSave, onCancel, qcNames, bagSerials, activeProduct, allRuns }: {
  run: any; specDef: any; activeSpecs: Record<string,any>
  onSave: (f: any) => void; onCancel: () => void; qcNames: string[]
  bagSerials?: {serial:string;lot:string;baggedAt:string}[]
  activeProduct: string
  allRuns?: any[]
}) {
  const [fields, setFields] = useState({
    date: run.date||'', lotNumber: run.lotNumber||'', serialNumber: run.serialNumber||'',
    qcName: run.qcName||'', time: run.time||'',
    bulkDensity: run.bulkDensity||'', grade: run.grade||SD_GRADES[0], variant: run.variant||'Conventional',
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
    const serialMismatch = serialTabMismatch(fields.serialNumber, activeProduct)
    if (serialMismatch) { alert(serialMismatch); return }
    if (isNegative(fields.bulkDensity)) { alert('Bulk density cannot be negative.'); return }
    if (isNegative(fields.needleCount)) { alert('Needle count cannot be negative.'); return }
    if (Object.keys(gramVals).some(k => isNegative(gramVals[k]))) { alert('Sieve grams cannot be negative.'); return }
    if (editMesh.some((m: string) => isNegative(pcts[m]))) { alert('Sieve percentages cannot be negative.'); return }
    if (fields.runType === 'in-process') {
      const missing = editMesh.filter((m: string) => pcts[m] === '' || pcts[m] == null)
      if (missing.length > 0) { alert(`All sieve mesh results are required for an In-Process run — missing: ${missing.map((m: string) => m.replace(' (%)', '')).join(', ')}`); return }
    }
    // A bag can only have one Final QC result — block editing this run's
    // serial into one that another Final QC row already owns.
    if (fields.runType === 'final' && fields.serialNumber && fields.serialNumber.trim()) {
      const dupSerial = (allRuns||[]).find((r: any) =>
        r.id !== run.id && r.runType === 'final' && r.serialNumber &&
        r.serialNumber.trim().toUpperCase() === fields.serialNumber.trim().toUpperCase())
      if (dupSerial) { alert(`Bag ${fields.serialNumber} already has a Final QC result (${dupSerial.date} ${dupSerial.time}, by ${dupSerial.qcName||'—'}). Edit that record instead.`); return }
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
          ['QC Name','qcName','text'],['Time','time','text'],
          ...(!specDef.noBulkDensity&&(!specDef.qcFieldsFinalOnly||fields.runType==='final')?[['Bulk Density','bulkDensity','number']]:[])]
          .map(([label,key,type]) => (
            <div key={key}>
              <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>{label}</label>
              {key==='qcName' ? (
                <QCNameField value={(fields as any)[key]} onChange={v=>setF(key,v)} names={qcNames} style={inputSt} />
              ) : key==='serialNumber' ? (
                <>
                  <input list="edit-serial-dl" value={fields.serialNumber} onChange={e=>setF('serialNumber',e.target.value)}
                    placeholder="Pick or type a serial"
                    style={{...inputSt, borderColor: serialTabMismatch(fields.serialNumber, activeProduct) ? '#fca5a5' : '#d1d5db'}}/>
                  <datalist id="edit-serial-dl">
                    {(bagSerials||[]).map(b=>(
                      <option key={b.serial} value={b.serial}>{b.lot?`lot ${b.lot}`:''}{b.baggedAt?` · ${String(b.baggedAt).slice(0,16).replace('T',' ')}`:''}</option>
                    ))}
                  </datalist>
                  {serialTabMismatch(fields.serialNumber, activeProduct) && (
                    <div style={{ fontSize:9, color:'#dc2626', marginTop:2 }}>
                      ⚠ {productOfSerial(fields.serialNumber)} serial — not valid on the {activeProduct} tab
                    </div>
                  )}
                </>
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
        {specDef.hasLeafShade && (!specDef.qcFieldsFinalOnly||fields.runType==='final') && (
          <div>
            <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>Leaf Shade</label>
            <input type="number" min="1" max="11" value={fields.leafShade} onChange={e=>setF('leafShade',e.target.value)} style={inputSt}/>
          </div>
        )}
        <div>
          <label style={{ fontSize:9, fontWeight:700, color:'#374151', display:'block', marginBottom:2, textTransform:'uppercase' }}>PA Level</label>
          <select value={fields.paLevel} onChange={e=>setF('paLevel',e.target.value)} style={{ ...inputSt, background:'#fff' }}>
            <option value="">— not set —</option>
            {['P0','P1','P2','P3','P4','FAIL'].map(lv=><option key={lv}>{lv}</option>)}
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
  const { p, fullName, displayName } = useAuth(); const canWrite = p('can_add_sieving_runs'); const isAdmin = p('can_delete_sieving_runs')
  const myName = fullName || displayName || ''
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
  // Replaces the old Daily/Weekly/Monthly/60-Day/All period buttons with the
  // By Hour/Week/Month navigator (moved here from the chart) so the records
  // table shares the same window instead of having its own separate control.
  // One offset per view so switching tabs doesn't lose your place in the others.
  // Defaults to 'week' rather than 'day' — the table shares this window now,
  // and defaulting to "today" left both the chart and table empty on any
  // product with no run logged yet today (was harmless before, when the
  // table had its own separate All-time filter).
  const [rangeView,      setRangeView]      = useState<'day'|'week'|'month'>('week')
  const [dayOffset,      setDayOffset]      = useState(0)
  const [weekOffset,     setWeekOffset]     = useState(0)
  const [monthOffset,    setMonthOffset]    = useState(0)
  const rangeOffset = rangeView==='day' ? dayOffset : rangeView==='week' ? weekOffset : monthOffset
  const setRangeOffset = rangeView==='day' ? setDayOffset : rangeView==='week' ? setWeekOffset : setMonthOffset
  const rangeWindow = rangeView==='day' ? (() => { const d = dayForOffset(dayOffset); return { start: d, end: d } })()
    : rangeView==='week' ? weekRangeForOffset(weekOffset) : monthRangeForOffset(monthOffset)
  const rangeStart = isoDate(rangeWindow.start)
  const rangeEnd   = isoDate(rangeWindow.end)
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
  // Final QC is now driven by the bags production has actually made: every
  // Fine Leaf / Coarse Leaf bagging becomes a pending QC (qms.v_pending_bag_qc).
  const [pendingBags,   setPendingBags]   = useState<any[]>([])
  const [pendingLoading,setPendingLoading]= useState(false)
  // Set when the pending-bag fetch itself fails, so a broken queue reads as
  // broken rather than as "nothing to sample".
  const [pendingError,  setPendingError]  = useState('')
  // Lets a failed refresh keep the last good list instead of blanking it.
  const pendingBagsRef = React.useRef<any[]>([])
  React.useEffect(() => { pendingBagsRef.current = pendingBags }, [pendingBags])
  const [selectedBagId, setSelectedBagId] = useState<string>('')
  const [printBag,      setPrintBag]      = useState<any>(null)
  // Serial numbers actually assigned to bags of the product currently open, so
  // the inline row editor can offer a dropdown instead of free-typing one —
  // sourced from every bagging (not just pending ones), since an edit may need
  // to correct a serial on an already-sampled or historical run.
  const [bagSerialOptions, setBagSerialOptions] = useState<{serial:string;lot:string;baggedAt:string}[]>([])
  useEffect(() => {
    db.schema('qms').from('v_bag_events').select('bag_serial_no,lot_number,bagged_at')
      .eq('product', activeProduct).not('bag_serial_no', 'is', null)
      .order('bagged_at', { ascending: false }).limit(300)
      .then(({ data }: { data: any[] | null }) => {
        setBagSerialOptions((data ?? []).map((r:any) => ({ serial: r.bag_serial_no, lot: r.lot_number, baggedAt: r.bagged_at })))
      })
  }, [db, activeProduct])
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

  // Pending Final QC bags — one per Fine Leaf / Coarse Leaf bagging that has
  // not been sampled yet. Indent Sticks and Rooibos Blocks are excluded by the
  // view (they get bags and labels but never a QC stamp).
  const loadPendingBags = useCallback(async () => {
    setPendingLoading(true)
    const { data, error } = await db.schema('qms').from('v_pending_bag_qc')
      .select('*').order('bagged_at', { ascending: false }).limit(300)
    // Surface a failed fetch instead of rendering it as "no bags pending".
    // Discarding this error is what hid a 20s view + 8s statement timeout
    // (PostgREST 500 / 57014) for a full shift: the queue looked empty on the
    // live site while production had bags waiting, and nothing said otherwise.
    setPendingError(error ? (error.message || 'Could not load the pending bag list.') : '')
    if (error) { setPendingLoading(false); return pendingBagsRef.current }
    const rows = data ?? []
    setPendingBags(rows)
    setPendingLoading(false)
    // No pruning needed: the awaiting-QC cards are derived from this list, so
    // refreshing it is what adds and removes them.
    return rows
  }, [db])
  useEffect(() => { loadPendingBags() }, [loadPendingBags])

  // The QC's time is always the moment of capture — never typed or edited.
  const nowHHMM = () => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`
  }

  const blankForm = () => {
    return {
      // SAST, not the raw UTC slice — between 00:00 and 01:59 SAST the UTC date
      // is still yesterday, which would file the run against the wrong day.
      date: sastDateStr(new Date().toISOString()),
      lotNumber:'', serialNumber:'', grade:'Export', variant:'Conventional',
      runType:'in-process', qcName: myName, time: nowHHMM(), needleCount:'', leafShade:'',
      bulkDensity:'', comment:'', paLevel:'', manualPaLevel:'', baggingId:'',
    }
  }
  const [form, setForm]           = useState<any>(blankForm())
  const [gramValues, setGramValues] = useState<Record<string,string>>({})

  // In-Process no longer carries a serial at all — it's a reading off the
  // machine while a bag is still filling, not a sample of one finished bag, so
  // there's nothing for a serial to identify. (Previously this auto-filled the
  // most recent bag's serial, which just meant every In-Process reading for a
  // sieve pointed at whatever bag happened to be latest, with no way to enter
  // one manually either — it looked like a required field nobody could
  // usefully fill in.) Only Final QC — sampling one specific finished bag —
  // has a serial, picked from the pending-bag list above.

  // Load all runs
  const load = useCallback(async () => {
    setLoading(true); setSdError('')
    // qms is the single source (legacy public.sd_runs consolidated in 2026-06-24).
    // Only the last 3 months is fetched — this table is thousands of rows deep
    // and nothing in the UI (chart or table) shows further back than the
    // date-range slicer's window anyway. Paginate within that window since a
    // busy quarter can still exceed the default 1000-row page.
    const sinceDate = threeMonthsAgoISO()
    let allData: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.schema('qms').from('sd_runs').select('*')
        .gte('date', sinceDate)
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

  // The runs feeding both the chart and the table are scoped to the same
  // slicer range — dates are stored as 'YYYY-MM-DD' so lexicographic
  // comparison works.
  const rangeRuns = productRuns.filter((r:any) => (r.date||'') >= rangeStart && (r.date||'') <= rangeEnd)

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

  const filteredRuns = (filter==='all' ? rangeRuns : rangeRuns.filter((r:any) => r.runType===filter))
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
      // Normalized defensively — a handful of historical rows saved the
      // production-schema spelling ("Conventional") before this was fixed at
      // the source, and copying one forward here would keep it circulating.
      if (latest.variant)      fields.variant = normProdVariant(latest.variant) || latest.variant
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
    // In-Process no longer carries a serial number (bags are only serialised at
    // bagging). The time is stamped automatically at capture, so it is never
    // missing and never user-entered.
    if (f.runType==='final' && !f.baggingId && !f.serialNumber.trim()) {
      errs._bag='Pick the bag being sampled from the pending list.'
    }
    // A serial encodes its own output type, so a Coarse Leaf bag can never be
    // captured on the Fine Leaf tab (or vice versa) — that would file the run
    // against the wrong product's specs entirely.
    const mismatch = serialTabMismatch(f.serialNumber, activeProduct)
    if (mismatch) errs.serialNumber = mismatch
    if (!retest&&f.time&&f.time.trim()&&f.lotNumber&&f.date) {
      const dup = productRuns.find((r:any)=>r.lotNumber===f.lotNumber&&r.date===f.date&&r.time===f.time.trim()&&r.runType===f.runType)
      if (dup) errs._dupTime=`A ${f.runType} run for lot ${f.lotNumber} already exists at ${f.time} on ${f.date}. Mark as Re-test.`
    }
    // A bag can only be sampled once at Final QC — a second "final" run against
    // the same serial is always a mistake (duplicate save, wrong bag picked
    // twice), never a legitimate re-test, since the bag itself is consumed by
    // the first sample. In-Process may legitimately share a serial across
    // several readings while that bag is still filling, so this only applies
    // to Final QC.
    if (f.runType==='final' && f.serialNumber && f.serialNumber.trim()) {
      const dupSerial = productRuns.find((r:any)=>
        r.runType==='final' && r.serialNumber &&
        r.serialNumber.trim().toUpperCase()===f.serialNumber.trim().toUpperCase())
      if (dupSerial) errs._dupSerial=`Bag ${f.serialNumber} already has a Final QC result (${dupSerial.date} ${dupSerial.time}, by ${dupSerial.qcName||'—'}). Edit that record instead of creating a new one.`
    }
    if (f.runType==='in-process') {
      // In-Process requires every mesh fraction filled in — no partial sieve results.
      const missing = activeMesh.filter(m=>f[m]===''||f[m]===undefined||f[m]===null)
      if (missing.length>0) errs._mesh=`All sieve mesh results are required for an In-Process run — missing: ${missing.map(m=>m.replace(' (%)','')).join(', ')}`
    }
    // Bulk density / leaf shade are only mandatory on Final QC — optional on In-Process.
    if (f.runType==='final') {
      if (!specDef.noBulkDensity&&(f.bulkDensity===''||f.bulkDensity==null)) errs.bulkDensity='Bulk density is required'
      if (specDef.hasLeafShade&&!f.leafShade) errs.leafShade='Leaf shade is required (1–11)'
    }
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
      // In-Process never carries a serial — enforced here too (not just by
      // hiding the field) so the lot-number auto-fill below can't silently
      // attach a stale serial from a previous run against the same lot.
      serial_number: form.runType==='final' ? (form.serialNumber||null) : null,
      grade:         form.grade||null,
      variant:       form.variant||null,
      run_type:      form.runType||null,
      qc_name:       form.qcName||null,
      // Always the capture moment — the QC cannot type or edit this.
      time_of_run:   nowHHMM(),
      bagging_id:    form.baggingId || null,
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

    // Link QC result back to the bag for audit trail (best-effort — don't block save).
    if (form.serialNumber?.trim()) {
      const serial = form.serialNumber.trim().toUpperCase()
      const now = new Date().toISOString()
      const passLabel = newRun.pass_status === 'Pass' ? 'Pass' : 'Fail'
      try {
        await getDb().schema('production').from('bag_tags')
          .update({ qc_initials: form.qcName || null, qc_signed_at: now } as any)
          .eq('serial_number', serial)
      } catch { /* non-fatal */ }
      try {
        await getDb().schema('production').from('scan_events').insert({
          serial_number: serial,
          action: 'qc_check',
          section_id: 'sieving',
          session_id: null,
          operator_id: null,
          weight_kg: null,
          notes: `${passLabel} · QC: ${form.qcName || '—'} · ${activeProduct} ${form.grade} ${form.variant}${newRun.violations?.length ? ' · ' + newRun.violations.join('; ') : ''}`,
        } as any)
      } catch { /* non-fatal */ }
    }

    // A Final QC clears that bag from the pending queue; an out-of-spec
    // in-process run changes which bags are flagged, so refresh either way.
    loadPendingBags()
    if (form.runType === 'final') setPrintBag({ ...mapped, bag: selectedBag, residue: rLookup[lotKeyOf(mapped.lotNumber)] || null })
    setShowForm(false); setGramValues({}); setForm(blankForm()); setErrors({}); setIsRetest(false); setAnomalyWarn(''); setConfirmAnomaly(false); setLotMsg(''); setTagLookupState('idle'); setSelectedBagId('')
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
    // Persist to Supabase so every PC shares the same specs. A schema
    // mismatch or RLS denial comes back as {error}, not a thrown exception —
    // that's exactly how this silently never persisted for a long stretch —
    // so check it explicitly rather than only try/catching network failures.
    try {
      const { error } = await getDb().schema('qms').from('sieving_spec_overrides')
        .upsert({ product: activeProduct, specs: newSpecs, updated_by: myName || null }, { onConflict: 'product' })
      if (error) alert('Specs saved for this session, but could not save to the shared database (other PCs won\'t see this change): ' + error.message)
    } catch (_) {
      alert('Specs saved for this session, but could not reach the database — other PCs won\'t see this change until it saves successfully.')
    }
  }

  function doExcelExport() {
    if (!filteredRuns.length) { alert('No runs to export'); return }
    const mesh = [...new Set([...specDef.meshForORG, ...specDef.meshForCON])]
    exportSievingRuns(activeProduct, filteredRuns, mesh)
  }

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const [tagLookupState, setTagLookupState] = React.useState<'idle'|'loading'|'found'|'notfound'>('idle')
  const DEST_TO_GRADE: Record<string, string> = { A: 'Export', B: 'Export Blend', C: 'Domestic' }

  async function lookupBagTag(serial: string) {
    const s = serial.trim().toUpperCase()
    if (!s) { setTagLookupState('idle'); return }
    setTagLookupState('loading')
    try {
      const { data } = await getDb().schema('production').from('bag_tags')
        .select('lot_number,variant,destination,created_at').eq('serial_number', s).maybeSingle()
      if (!data) { setTagLookupState('notfound'); return }
      const grade = DEST_TO_GRADE[data.destination ?? ''] ?? 'Export'
      // created_at is a UTC timestamptz — slicing it directly would show the
      // wrong calendar day for any bag tagged between 00:00-01:59 SAST (still
      // "yesterday" in UTC). Format in Africa/Johannesburg instead.
      const date  = data.created_at ? sastDateStr(data.created_at) : ''
      setForm((f: any) => ({
        ...f,
        ...(data.lot_number ? { lotNumber: data.lot_number } : {}),
        ...(data.variant    ? { variant: normProdVariant(data.variant) } : {}),
        grade,
        ...(date            ? { date }                        : {}),
      }))
      setTagLookupState('found')
    } catch { setTagLookupState('idle') }
  }

  // Pre-fills the Final QC form from a bag record (a row of qms.v_bag_qc_status
  // / v_pending_bag_qc). Shared by the manual dropdown and the "ready for QC"
  // pop-up, so picking a bag behaves identically either way. Everything filled
  // here stays editable so the QC can verify/correct it — except the time,
  // which is always the capture moment.
  function applyBagToForm(bag: any) {
    setSelectedBagId(bag.bagging_id)
    const lotKey  = (bag.lot_number || '').trim().toUpperCase().replace(/\s*-\s*/g,'-')
    const shade   = leafShadeLookup[lotKey]
    const pa      = paLookup[lotKey]
    setForm((f:any) => ({
      ...f,
      runType:      'final',
      baggingId:    bag.bagging_id,
      serialNumber: bag.bag_serial_no || '',
      lotNumber:    bag.lot_number || '',
      variant:      normProdVariant(bag.variant) || f.variant,
      // The run's date is WHEN THE QC WAS DONE, to match the time beside it,
      // which is always stamped at capture. Previously this took the bag's
      // bagging date instead, so a bag made yesterday and sampled this morning
      // was stored as date=yesterday + time=this-morning — an instant that
      // never happened. The table sorts on date+time, so those rows buried
      // themselves near the bottom of the previous day and read as missing
      // (STFL-130826-012, sampled 07:33 on the 14th, filed under 13 Aug 07:33).
      // The bag's own bagging date is not lost: it stays on the bag via the
      // serial/bagging_id link and is shown in the confirmation line below.
      date:         sastDateStr(new Date().toISOString()),
      qcName:       f.qcName || myName,
      time:         nowHHMM(),
      ...(pa    ? { paLevel: pa } : {}),
      ...(shade != null ? { leafShade: String(shade) } : {}),
    }))
    const bits = [
      `📦 Bag ${bag.bag_serial_no || '—'} · ${bag.product} · lot ${bag.lot_number || '—'}`,
      // Keep the bag's own bagging moment visible — the run's Date field is now
      // the QC date, so this is where "when was this bag actually made" lives.
      bag.bagged_at ? `Bagged ${String(bag.bagged_at).slice(0,10)} ${String(bag.bagged_at).slice(11,16)}` : '',
      pa ? `PA: ${pa}` : '',
      shade != null ? `Shade: ${shade} (from raw material)` : '',
      bag.inprocess_out_of_spec ? `⚠ In-process sieve OUT OF SPEC at ${String(bag.inprocess_at||'').slice(11,16)}` : '',
    ].filter(Boolean)
    setLotMsg(bits.join('  ·  '))
    setTagLookupState('found')
  }

  function selectPendingBag(bagId: string) {
    setSelectedBagId(bagId)
    if (!bagId) { setLotMsg(''); return }
    const bag = pendingBags.find((b:any) => String(b.bagging_id) === String(bagId))
    if (!bag) return
    applyBagToForm(bag)
  }

  // ── "Bag awaiting QC" panel ────────────────────────────────────────────────
  // Derived straight from the pending queue rather than accumulated from
  // Realtime events, so every un-sampled Fine Leaf / Coarse Leaf bag keeps a
  // card on screen until it is actually linked to a Final QC — it can't be
  // dismissed away and forgotten, and it can't linger after the bag is done.
  // Realtime and the 60s poll only refresh that queue; they never own the list.
  const bagAlerts = pendingBags
  const [alertsCollapsed, setAlertsCollapsed] = useState(false)
  useEffect(() => {
    const id = setInterval(loadPendingBags, 60000)
    return () => clearInterval(id)
  }, [loadPendingBags])
  useEffect(() => {
    const channel = db.channel('sieving-bag-ready')
      .on('postgres_changes', { event: 'INSERT', schema: 'production', table: 'prod_bagging' }, () => loadPendingBags())
      .on('postgres_changes', { event: 'INSERT', schema: 'production', table: 'bag_tags' },     () => loadPendingBags())
      .subscribe()
    return () => { db.removeChannel(channel) }
  }, [db, loadPendingBags])

  // Clicking a card: jump to that sieve's tab, re-fetch the pending queue (so
  // we work from the fully-enriched row — PA/leaf-shade lookups, in-process
  // spec status), open Final QC pre-filled on that exact bag, and scroll it
  // into view. The card itself stays until the bag is actually linked.
  async function openBagAlert(bagAlert: any) {
    setActiveProduct(bagAlert.product)
    const fresh = await loadPendingBags()
    const bag = fresh.find((b:any) => String(b.bagging_id) === String(bagAlert.bagging_id))
    if (!bag) { alert(`${bagAlert.bag_serial_no || 'That bag'} was already sampled — nothing to do.`); return }
    setShowForm(true)
    setEditRunId(null)
    setShowSpecEditor(false)
    applyBagToForm(bag)
    setTimeout(() => document.getElementById('sieving-new-run-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const selectedBag = pendingBags.find((b:any) => String(b.bagging_id) === String(selectedBagId)) || null

  // The bag picker must only offer bags of the sieve currently open (Fine Leaf
  // tab → Fine Leaf bags, Coarse Leaf tab → Coarse Leaf bags, etc.) — otherwise
  // a QC on the Fine Leaf tab could pick and sample a Coarse Leaf bag by mistake.
  const tabPendingBags = pendingBags.filter((b:any) => b.product === activeProduct)

  // Re-print a bag label from the history table — after edits to that row, or
  // any time later. Looks the bag up fresh (not just the pending list, since a
  // sampled bag has already dropped off it) so the in-process spec banner is
  // still accurate even for an old run.
  async function reprintLabel(row: any) {
    let bag: any = null
    if (row.baggingId) {
      const { data } = await db.schema('qms').from('v_bag_qc_status').select('*').eq('bagging_id', row.baggingId).maybeSingle()
      bag = data
    } else if (row.serialNumber) {
      const { data } = await db.schema('qms').from('v_bag_qc_status').select('*').eq('bag_serial_no', row.serialNumber).order('bagged_at', { ascending: false }).limit(1)
      bag = data?.[0] ?? null
    }
    setPrintBag({ ...row, bag, residue: rLookup[lotKeyOf(row.lotNumber)] || null })
  }

  const inputSt: React.CSSProperties = { padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:11, width:'100%', boxSizing:'border-box' }
  const errSt: React.CSSProperties   = { fontSize:10, color:'#dc2626', marginTop:2 }
  const ErrMsg = ({ field }: { field:string }) => errors[field] ? <div style={errSt}>⚠ {errors[field]}</div> : null

  return (
    <div className="p-5 max-w-[1400px]">
      {/* "Bag ready for QC" pop-ups — fire live the moment production bags a
          new Fine Leaf / Coarse Leaf output. Non-blocking: dismissing one just
          removes the nudge, the bag itself stays in the pending queue above. */}
      {/* Bags awaiting QC — stays on screen until each bag is actually linked to
          a Final QC. Deliberately has no per-card dismiss: the whole panel can
          be collapsed out of the way, but a bag only leaves the list by being
          sampled, so nothing gets closed and forgotten. */}
      {bagAlerts.length > 0 && (
        <div style={{position:'fixed',top:70,right:16,zIndex:5000,display:'flex',flexDirection:'column',gap:8,maxWidth:340,maxHeight:'calc(100vh - 90px)'}}>
          <button onClick={()=>setAlertsCollapsed(c=>!c)}
            style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,background:'#166534',border:'none',borderRadius:10,padding:'9px 12px',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:'0 12px 30px rgba(0,0,0,.15)'}}>
            <span>📦 {bagAlerts.length} bag{bagAlerts.length>1?'s':''} awaiting QC</span>
            <span style={{opacity:.85}}>{alertsCollapsed?'▲':'▼'}</span>
          </button>
          {!alertsCollapsed && (
            <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>
              {bagAlerts.map(a=>(
                <div key={a.bagging_id} style={{background:'#fff',border:'1px solid #86efac',borderLeft:`4px solid ${a.inprocess_out_of_spec?'#991b1b':'#166534'}`,borderRadius:10,boxShadow:'0 12px 30px rgba(0,0,0,.15)',padding:'12px 14px'}}>
                  <div style={{fontWeight:700,fontSize:12,color:a.inprocess_out_of_spec?'#991b1b':'#166534'}}>
                    {a.inprocess_out_of_spec?'⚠':'📦'} {a.product} bag awaiting QC
                  </div>
                  <div style={{fontSize:11,color:'#374151',marginTop:4}}>
                    {a.bag_serial_no || '(no serial)'} · lot {a.lot_number || '—'}
                    {a.bagged_at ? <><br/><span style={{color:'#6b7280'}}>Bagged {String(a.bagged_at).slice(0,10)} {String(a.bagged_at).slice(11,16)}</span></> : null}
                  </div>
                  <button onClick={()=>openBagAlert(a)}
                    style={{marginTop:8,width:'100%',padding:'7px 10px',borderRadius:7,border:'none',background:'#166534',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                    Sample now →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* Toolbar A — New Run / Edit Specs sit above the Specifications table so
          editing the spec a run will be checked against is right next to it. */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {canWrite && <button onClick={()=>{setShowForm(true);setShowSpecEditor(false);setEditRunId(null)
          setTimeout(()=>document.getElementById('sieving-new-run-form')?.scrollIntoView({behavior:'smooth',block:'start'}),50)}}
          style={{padding:'6px 14px',borderRadius:6,border:'none',background:'#166534',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>+ New Run</button>}
        {canWrite && <button onClick={()=>{setShowSpecEditor(s=>!s);setShowForm(false);setEditRunId(null)}}
          style={{padding:'5px 12px',borderRadius:6,border:'1px solid #7c3aed',fontSize:11,cursor:'pointer',fontWeight:600,
            background:showSpecEditor?'#7c3aed':'#faf5ff',color:showSpecEditor?'#fff':'#7c3aed'}}>
          {showSpecEditor?'× Close Editor':'Edit Specs'}</button>}
      </div>

      {/* Spec editor */}
      {showSpecEditor && <SievingSpecEditor product={activeProduct} specDef={specDef} customSpecs={activeSpecs} onSave={saveSpecs} onClose={()=>setShowSpecEditor(false)}/>}

      {/* Spec panel */}
      <div style={{marginBottom:14,borderRadius:10,border:'1px solid #e5e7eb',background:'#fff',overflow:'hidden'}}>
        <button onClick={()=>setShowSpecPanel(s=>!s)} style={{width:'100%',padding:'11px 16px',background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',fontFamily:'inherit'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:13,fontWeight:700,color:'#111827'}}>Specifications — {activeProduct}</span>
            <span style={{fontSize:10,color:'#9ca3af'}}>Organic/RA-Organic/FT-Organic use &gt;10 mesh · Conventional/RA-Conventional/FT-Conventional use &gt;12 mesh · {Object.keys(activeSpecs).length} variants (Export / Export Blend / Domestic)</span>
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

      {/* New Run Form */}
      {/* Bag label — printed after a Final QC, carrying the two values the QC
          measured (bulk density + leaf shade) alongside the bag's identity. */}
      {printBag && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={()=>setPrintBag(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:420,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',background:'#166534',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:700,fontSize:14}}>✓ Final QC saved — bag label</span>
              <button onClick={()=>setPrintBag(null)} style={{background:'rgba(255,255,255,.2)',border:'none',borderRadius:6,color:'#fff',fontSize:18,cursor:'pointer',padding:'0 8px'}}>×</button>
            </div>
            <div id="bag-qc-label" style={{padding:18,fontFamily:'monospace',color:'#111'}}>
              <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'4px 10px',fontSize:13}}>
                <b>SERIAL</b><span>{printBag.serialNumber||'—'}</span>
                <b>PRODUCT</b><span>{printBag.product||activeProduct}</span>
                <b>LOT</b><span>{printBag.lotNumber||'—'}</span>
              </div>
              <div style={{marginTop:12,border:'2px solid #111',borderRadius:6,display:'grid',gridTemplateColumns:'1fr 1fr'}}>
                {([
                  ['BULK DENSITY', printBag.bulkDensity, 'cc/100g'],
                  ['LEAF SHADE',   printBag.leafShade,   '1–11'],
                  ['PA LEVEL',     printBag.paLevel,      ''],
                  ['RESIDUE',      printBag.residue,      ''],
                ] as [string, any, string][]).map(([label, value, unit], i) => (
                  <div key={label} style={{textAlign:'center',padding:'10px 8px',borderTop:i>=2?'1px solid #111':undefined,borderLeft:i%2===1?'1px solid #111':undefined}}>
                    <div style={{fontSize:10,letterSpacing:'.08em'}}>{label}</div>
                    <div style={{fontSize:22,fontWeight:800}}>{value||'—'}</div>
                    {unit && <div style={{fontSize:9}}>{unit}</div>}
                  </div>
                ))}
              </div>
              {printBag.bag?.inprocess_out_of_spec && (
                <div style={{marginTop:10,padding:'6px 10px',border:'2px solid #991b1b',color:'#991b1b',borderRadius:6,fontSize:11,fontWeight:700,textAlign:'center'}}>
                  ⚠ IN-PROCESS SIEVE OUT OF SPEC — REVIEW BEFORE RELEASE
                </div>
              )}
            </div>
            <div style={{padding:'10px 16px',borderTop:'1px solid #eee',display:'flex',justifyContent:'flex-end',gap:8}}>
              <button onClick={()=>setPrintBag(null)} style={{padding:'8px 16px',borderRadius:7,border:'1px solid #d1d5db',background:'#fff',fontSize:12,cursor:'pointer'}}>Close</button>
              <button onClick={()=>window.print()} style={{padding:'8px 20px',borderRadius:7,border:'none',background:'#166534',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>🖨 Print label</button>
            </div>
          </div>
        </div>
      )}

      {showForm && canWrite && (
        <div id="sieving-new-run-form" style={{background:'#f8fafc',border:'2px solid #1f4e79',borderRadius:12,padding:20,marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:15,color:'#1f4e79'}}>⊕ New {activeProduct} Run</div>
            <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setConfirmAnomaly(false);setLotMsg('');setTagLookupState('idle')}}
              style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#6b7280',lineHeight:1,padding:'0 4px'}}>×</button>
          </div>

          {/* Run Type — prominent tablet-friendly selector */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:10,fontWeight:700,color:errors.runType?'#dc2626':'#6b7280',display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>Run Type *</label>
            <div style={{display:'flex',gap:8}}>
              {([['in-process','⚙ In-Process','#1f4e79'],['final','✓ Final QC (bag)','#166534']] as const).map(([val,label,col])=>(
                <button key={val} type="button" onClick={()=>{
                  // Switching run type always clears the serial/bag link. Without
                  // this, the serial auto-filled for In-Process carried over into
                  // Final QC — showing a populated "✓ from bag" serial while the
                  // bag picker still read "0 pending / none selected", which is
                  // exactly the contradiction that looked like a broken dropdown.
                  setF('runType',val)
                  setSelectedBagId('')
                  setForm((f:any)=>({...f, runType: val, baggingId:'', serialNumber:''}))
                  setLotMsg(''); setTagLookupState('idle')
                }}
                  style={{flex:1,padding:'13px 16px',borderRadius:8,border:`2px solid ${form.runType===val?col:'#d1d5db'}`,
                    background:form.runType===val?col:'#fff',color:form.runType===val?'#fff':'#374151',
                    fontSize:14,fontWeight:700,cursor:'pointer',transition:'all 0.15s',
                    boxShadow:form.runType===val?`0 2px 8px ${col}44`:'none'}}>
                  {label}{val==='final'&&tabPendingBags.length>0?` · ${tabPendingBags.length}`:''}
                </button>
              ))}
            </div>
          </div>

          {/* Final QC — pick the bag production has made. Each bagging of Fine
              Leaf / Coarse Leaf is a pending QC; the bag carries its own serial,
              lot, grade and variant so the QC verifies rather than re-types. */}
          {form.runType==='final' && (
            <div style={{marginBottom:16,padding:'12px 14px',background:'#f0fdf4',border:'2px solid #86efac',borderRadius:8}}>
              <label style={{fontSize:10,fontWeight:700,color:errors._bag?'#dc2626':'#166534',display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.05em'}}>
                Bag awaiting QC — {activeProduct} * {pendingLoading?'· loading…':`· ${tabPendingBags.length} pending`}
              </label>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <select value={selectedBagId} onChange={e=>selectPendingBag(e.target.value)}
                  style={{...inputSt,padding:'10px 10px',fontSize:13,background:'#fff',borderColor:errors._bag?'#fca5a5':'#86efac',flex:1}}>
                  <option value="">— select the {activeProduct} bag being sampled —</option>
                  {tabPendingBags.map((b:any)=>(
                    <option key={b.bagging_id} value={b.bagging_id}>
                      {b.bag_serial_no || '(no serial)'} · {b.product} · lot {b.lot_number || '—'}
                      {b.bagged_at ? ` · ${String(b.bagged_at).slice(0,10)} ${String(b.bagged_at).slice(11,16)}` : ''}
                      {b.inprocess_out_of_spec ? '  ⚠ OUT OF SPEC' : ''}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={loadPendingBags}
                  style={{padding:'10px 14px',borderRadius:7,border:'1px solid #86efac',background:'#fff',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>↻</button>
              </div>
              {pendingError&&(
                <div style={{fontSize:11,color:'#991b1b',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:6,padding:'6px 8px',marginTop:6}}>
                  ⚠ Could not load the bags awaiting QC — this list may be incomplete. Tap ↻ to retry. ({pendingError})
                </div>
              )}
              {tabPendingBags.length===0&&!pendingLoading&&!pendingError&&(
                <div style={{fontSize:11,color:'#6b7280',marginTop:6}}>
                  {['Fine Leaf','Coarse Leaf'].includes(activeProduct)
                    ? `No ${activeProduct} bags awaiting QC — a pending entry appears here each time production bags a ${activeProduct} output.`
                    : `${activeProduct} bags do not require a QC stamp.`}
                </div>
              )}
              {errors._bag&&<div style={{fontSize:10,color:'#dc2626',marginTop:4}}>⚠ {errors._bag}</div>}

              {/* The in-process sieve that governed this bag */}
              {selectedBag&&selectedBag.inprocess_run_id&&(
                <div style={{marginTop:10,padding:'8px 10px',borderRadius:6,
                  background:selectedBag.inprocess_out_of_spec?'#fef2f2':'#f8fafc',
                  border:`1px solid ${selectedBag.inprocess_out_of_spec?'#fca5a5':'#e5e7eb'}`}}>
                  <div style={{fontSize:10,fontWeight:700,color:selectedBag.inprocess_out_of_spec?'#991b1b':'#374151',marginBottom:2}}>
                    {selectedBag.inprocess_out_of_spec?'⚠ In-process sieve was OUT OF SPEC for this bag':'✓ In-process sieve in spec'}
                    {selectedBag.inprocess_at?` — sampled ${String(selectedBag.inprocess_at).slice(11,16)}`:''}
                  </div>
                  {selectedBag.inprocess_out_of_spec&&Array.isArray(selectedBag.inprocess_violations)&&(
                    <ul style={{margin:'2px 0 0 16px',padding:0}}>
                      {selectedBag.inprocess_violations.map((v:string,i:number)=>(
                        <li key={i} style={{fontSize:10,color:'#991b1b'}}>{v}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {errors._dupTime&&<div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:6,fontSize:11,color:'#991b1b',marginBottom:10}}>⚠ {errors._dupTime}</div>}
          {errors._dupSerial&&<div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:6,fontSize:11,color:'#991b1b',marginBottom:10}}>⚠ {errors._dupSerial}</div>}
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
            {/* Serial No. — Final QC only. It's a sample of one specific,
                finished bag, so it comes from the bag picked in the queue
                above. In-Process is a reading off the machine while a bag is
                still filling, not a sample of one bag — there's no serial to
                attach it to. */}
            {form.runType==='final' && <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.serialNumber?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>
                Serial No. {form.serialNumber&&<span style={{fontSize:9,color:'#166534',fontWeight:400}}>✓ from bag</span>}
              </label>
              <input value={form.serialNumber}
                onChange={e=>{setF('serialNumber',e.target.value);setTagLookupState('idle')}}
                onBlur={e=>lookupBagTag(e.target.value)}
                onKeyDown={e=>{ if (e.key==='Enter') { e.preventDefault(); lookupBagTag(form.serialNumber) } }}
                placeholder="Type or scan barcode"
                style={{...inputSt,borderColor:errors.serialNumber?'#fca5a5':tagLookupState==='notfound'?'#fca5a5':tagLookupState==='found'?'#86efac':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              {tagLookupState==='loading' && <div style={{fontSize:10,color:'#6b7280',marginTop:2}}>Looking up bag tag…</div>}
              {tagLookupState==='found'   && <div style={{fontSize:10,color:'#16a34a',marginTop:2}}>✓ Bag tag found — date, lot, grade and variant pre-filled</div>}
              {tagLookupState==='notfound'&& <div style={{fontSize:10,color:'#dc2626',marginTop:2}}>⚠ No bag tag found for this serial — fill in manually</div>}
              <ErrMsg field="serialNumber"/>
            </div>}
            <div>
              <label style={{fontSize:10,fontWeight:700,color:errors.qcName?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>
                QC Controller * {myName&&form.qcName===myName&&<span style={{fontSize:9,color:'#166534',fontWeight:400}}>✓ logged in</span>}
              </label>
              <QCNameField value={form.qcName} onChange={v=>setF('qcName',v)} names={qcNames} style={{...inputSt,borderColor:errors.qcName?'#fca5a5':'#d1d5db',padding:'9px 10px',fontSize:13}}/>
              <ErrMsg field="qcName"/>
            </div>
            {/* Time is stamped when the QC saves — deliberately not editable. */}
            <div>
              <label style={{fontSize:10,fontWeight:700,color:'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>
                Time <span style={{fontSize:9,color:'#6b7280',fontWeight:400}}>🔒 stamped at capture</span>
              </label>
              <input type="text" value={form.time} readOnly title="The time is recorded automatically when you save this run"
                style={{...inputSt,padding:'9px 10px',fontSize:13,background:'#f3f4f6',color:'#6b7280',cursor:'not-allowed'}}/>
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
            {!specDef.noBulkDensity&&(!specDef.qcFieldsFinalOnly||form.runType==='final')&&<div>
              <label style={{fontSize:10,fontWeight:700,color:errors.bulkDensity?'#dc2626':'#374151',display:'block',marginBottom:4,textTransform:'uppercase'}}>Bulk Density (cc/100g){form.runType==='final'?' *':''}</label>
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
                {['P0','P1','P2','P3','P4','FAIL'].map(lv=><option key={lv}>{lv}</option>)}
              </select>
            </div>
            {specDef.hasLeafShade&&(!specDef.qcFieldsFinalOnly||form.runType==='final')&&<div>
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
              <button onClick={()=>{setShowForm(false);setErrors({});setGramValues({});setForm(blankForm());setAnomalyWarn('');setConfirmAnomaly(false);setLotMsg('');setTagLookupState('idle')}}
                style={{padding:'10px 20px',borderRadius:7,border:'1px solid #d1d5db',background:'#fff',fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={addRun} disabled={saving || (outlierWarnings.length>0 && !confirmAnomaly)}
                style={{padding:'10px 26px',borderRadius:7,border:'none',background:(saving||(outlierWarnings.length>0 && !confirmAnomaly))?'#9ca3af':'#166534',color:'#fff',fontSize:13,fontWeight:700,cursor:(saving||(outlierWarnings.length>0 && !confirmAnomaly))?'default':'pointer'}}>
                {saving?'Saving…':'✓ Save Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mesh trend + outlier view — the By Hour/Week/Month navigator inside it
          sets the window that also bounds the records table further down, so
          the two always show the same slice of history. */}
      <div style={{marginBottom:8}}>
        <button onClick={()=>setShowOutlierChart(s=>!s)}
          style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${showOutlierChart?'#1f4e79':'#e5e7eb'}`,fontSize:11,cursor:'pointer',fontWeight:600,background:showOutlierChart?'#eff6ff':'#fff',color:showOutlierChart?'#1f4e79':'#374151'}}>
          📈 {showOutlierChart?'Hide':'Show'} Chart
        </button>
      </div>
      {/* Not gated on rangeRuns.length — the chart's own nav (By Hour/Week/Month
          + prev/next) is the only way to move off an empty window, so it must
          stay rendered even when the current window has zero runs; the chart
          body already shows "no data for this range" internally. */}
      {showOutlierChart && (
        <SievingOutlierChart runs={rangeRuns} activeProduct={activeProduct} specDef={specDef} activeSpecs={activeSpecs}
          rangeStart={rangeStart} rangeEnd={rangeEnd}
          view={rangeView} offset={rangeOffset} onViewChange={setRangeView} onOffsetChange={setRangeOffset}
          onPointClick={(runId)=>{
            setChartHighlightId(runId)
            const el = document.getElementById(`run-row-${runId}`)
            el?.scrollIntoView({ behavior:'smooth', block:'center' })
            setTimeout(()=>setChartHighlightId(null), 3000)
          }} />
      )}

      {/* Toolbar B — filters for the records table, positioned right above it
          so it reads as "these control the table below" rather than being
          separated from it by the spec table and chart. */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {[['all','All'],['in-process','In-Process'],['final','Final QC']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)}
            style={{padding:'5px 12px',borderRadius:6,border:'1px solid',fontSize:11,cursor:'pointer',fontWeight:600,
              background:filter===k?'#1f4e79':'#fff',color:filter===k?'#fff':'#374151',borderColor:filter===k?'#1f4e79':'#e5e7eb'}}>{l}</button>
        ))}
        <span style={{fontSize:11,color:'#9ca3af'}}>{filteredRuns.length} run{filteredRuns.length!==1?'s':''}</span>
        <div style={{marginLeft:'auto',position:'relative',minWidth:220}}>
          <input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="🔍 Search this table…"
            style={{width:'100%',padding:'6px 30px 6px 10px',fontSize:11,border:'1px solid #d1d5db',borderRadius:6,boxSizing:'border-box'}}/>
          {searchText && (
            <button onClick={()=>setSearchText('')} title="Clear search"
              style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:13}}>✕</button>
          )}
        </div>
        <button onClick={doExcelExport} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #166534',fontSize:11,cursor:'pointer',fontWeight:600,background:'#f0fdf4',color:'#166534'}}>⬇ Export Excel</button>
        <button onClick={load} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e5e7eb',fontSize:11,cursor:'pointer'}}>↻ Refresh</button>
      </div>

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
                {sdGetMesh(activeProduct,'Conventional').map(m=>(
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
                      {row.runType==='final'&&(
                        <button onClick={()=>reprintLabel(row)}
                          style={{background:'none',border:'1px solid #86efac',borderRadius:4,color:'#166534',cursor:'pointer',fontSize:11,padding:'2px 5px',marginTop:2,display:'block'}}
                          title="Re-print this bag's label — reflects any edits made to this row">
                          🖨
                        </button>
                      )}
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
                    {sdGetMesh(activeProduct,'Conventional').map(m=>{
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
                        bagSerials={bagSerialOptions}
                        activeProduct={activeProduct}
                        allRuns={productRuns}
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