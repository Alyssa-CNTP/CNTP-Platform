/**
 * Acumatica inventory item codes — single source of truth for production capture.
 * All lookup functions take (productType, variant, grade) and return the
 * Acumatica inventory ID + description.
 */

export interface AcumaticaCode {
  inventoryId: string   // e.g. '10LGEF-C'
  description: string   // e.g. 'Sieved Fine Leaf: Export - Conventional'
  phantomId?:  string   // phantom item for production order (sieving only)
  isPhantom:   boolean  // true if this IS the phantom item
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps variant short name to its inventory-ID suffix.
 * CON → -C | ORG → -O | RA CON → -RC | RA ORG → -RO
 */
function variantSuffix(v: string): string {
  switch (v) {
    case 'CON':    return '-C'
    case 'ORG':    return '-O'
    case 'RA CON': return '-RC'
    case 'RA ORG': return '-RO'
    default:       return `-${v}`
  }
}

/**
 * Maps grade letter to the leaf code family prefix segment.
 * A (Export) → E | B (Export Blend) → BL | C (Domestic) → D
 */
function gradeFamilyLeaf(g: string): string {
  switch (g) {
    case 'A': return 'E'
    case 'B': return 'BL'
    case 'C': return 'D'
    default:  return g
  }
}

/** Human-readable grade label for descriptions. */
function gradeLabel(g: string): string {
  switch (g) {
    case 'A': return 'Export'
    case 'B': return 'Export Blend'
    case 'C': return 'Domestic'
    default:  return g
  }
}

/** Human-readable variant long name for descriptions. */
function variantLongName(v: string): string {
  switch (v) {
    case 'CON':    return 'Conventional'
    case 'ORG':    return 'Organic'
    case 'RA CON': return 'RA Conventional'
    case 'RA ORG': return 'RA Organic'
    default:       return v
  }
}

// ---------------------------------------------------------------------------
// Main lookup
// ---------------------------------------------------------------------------

/**
 * Returns the Acumatica inventory code for a production output stream.
 * Returns null for waste streams that have no Acumatica code.
 */
export function getAcumaticaCode(
  productType: string,
  variant: string,
  grade: string,
): AcumaticaCode | null {
  const vs   = variantSuffix(variant)
  const vln  = variantLongName(variant)

  // ── Blender outputs ──────────────────────────────────────────────────────
  if (productType === 'Blended Batch') {
    // Blender output — code comes from the blend_codes table dropdown, not auto-derived
    return null
  }

  // ── Sieving outputs ──────────────────────────────────────────────────────
  if (productType === 'Fine Leaf') {
    const family  = gradeFamilyLeaf(grade)
    const glabel  = gradeLabel(grade)
    const invId   = `10LG${family}F${vs}`
    const phantom = `S10LG${family}${vs}`
    return {
      inventoryId: invId,
      description: `Sieved Fine Leaf: ${glabel} - ${vln}`,
      phantomId:   phantom,
      isPhantom:   false,
    }
  }

  if (productType === 'Coarse Leaf') {
    const family  = gradeFamilyLeaf(grade)
    const glabel  = gradeLabel(grade)
    const invId   = `10LG${family}C${vs}`
    const phantom = `S10LG${family}${vs}`
    return {
      inventoryId: invId,
      description: `Sieved Coarse Leaf: ${glabel} - ${vln}`,
      phantomId:   phantom,
      isPhantom:   false,
    }
  }

  if (productType === 'RB Blocks') {
    return {
      inventoryId: `15IGBL-C${vs}`,
      description: `Blocks: Clean - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Rolsiev Sticks') {
    return {
      inventoryId: `15IGST${vs}`,
      description: `Sticks - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Indent Sticks') {
    return {
      inventoryId: `15IGIS${vs}`,
      description: `Indent Sticks - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Brown Dust') {
    return {
      inventoryId: `15IGDB${vs}`,
      description: `Dust: Brown - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Powder Dust') {
    return {
      inventoryId: `15IGDPOWDR${vs}`,
      description: `Dust: Powder - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Bucket Elevator Spillage') {
    // Waste stream — no Acumatica code
    return null
  }

  // ── Refining 1 outputs ───────────────────────────────────────────────────
  if (productType === 'Indent Dust') {
    return {
      inventoryId: `15IGDIS${vs}`,
      description: `Dust: Indent - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'White Dust') {
    return {
      inventoryId: `15IGDW${vs}`,
      description: `Dust: White - ${vln}`,
      isPhantom:   false,
    }
  }

  // ── Refining 2 outputs ───────────────────────────────────────────────────
  if (productType === 'Cut Heavy Stick Fine') {
    return {
      inventoryId: `20BGCHS-F${vs}`,
      description: `Cut Heavy Stick Fine - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Cut Heavy Stick Coarse') {
    return {
      inventoryId: `20BGCHS-C${vs}`,
      description: `Cut Heavy Stick Coarse - ${vln}`,
      isPhantom:   false,
    }
  }

  // Note: 'White Dust' and 'Powder Dust' already handled above; they share
  // the same codes across Refining 1, Refining 2, and Granule streams.

  // ── Granule outputs ──────────────────────────────────────────────────────
  if (productType === 'SG Granules') {
    return {
      inventoryId: `20BGGSG-001${vs}`,
      description: `Granules SG - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'SF Granules') {
    return {
      inventoryId: `20BGGF-001${vs}`,
      description: `Granules: Fine - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'Export Granules') {
    return {
      inventoryId: `20BGGE-001${vs}`,
      description: `Granule Export - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'SG Dust') {
    return {
      inventoryId: `15IGDSG${vs}`,
      description: `Dust: SG - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'SF Dust') {
    return {
      inventoryId: `15IGDSF${vs}`,
      description: `Dust: SF - ${vln}`,
      isPhantom:   false,
    }
  }

  if (productType === 'ALT Dust') {
    return { inventoryId: `15IGDALT${vs}`, description: `Dust: ALT - ${vln}`, isPhantom: false }
  }

  if (productType === 'Blocks Dirty' || productType === 'Dirty Blocks') {
    return { inventoryId: `15IGBLD${vs}`, description: `Blocks: Dirty - ${vln}`, isPhantom: false }
  }

  if (productType === 'Leaf Grade Dust' || productType === 'LG Dust') {
    return { inventoryId: `15IGDLG${vs}`, description: `Dust: Leaf Grade - ${vln}`, isPhantom: false }
  }

  if (productType === 'Pasteurised Dust' || productType === 'Past Dust') {
    return { inventoryId: `15IGPASTDB${vs}`, description: `Dust: Pasteurised - ${vln}`, isPhantom: false }
  }

  if (productType === 'SG Granules 002') {
    return { inventoryId: `20BGGSG-001${vs}`, description: `Granules SG: (29BD|18WD|45IS|8PWD) - ${vln}`, isPhantom: false }
  }

  if (productType === 'SF Granules 002') {
    return { inventoryId: `20BGGF-002${vs}`, description: `Granules: Fine: (56BD|36IS|8POW) - ${vln}`, isPhantom: false }
  }

  if (productType === 'Export Granules 002') {
    return { inventoryId: `20BGGE-002${vs}`, description: `Granules: Export: (56BD|36IS|8POW) - ${vln}`, isPhantom: false }
  }

  return null
}

// ---------------------------------------------------------------------------
// Sieving input (farm bag consumption items)
// ---------------------------------------------------------------------------

/**
 * Returns the Acumatica code for the farm-bag raw material consumed during
 * sieving. Grade determines the code family; variant determines the suffix.
 *
 * A (Export)       → 05RMDE + vs
 * B (Export Blend) → 05RMDBL + vs
 * C (Domestic)     → 05RMDD + vs
 */
export function getInputAcumaticaCode(
  grade: string,
  variant: string,
): AcumaticaCode | null {
  const vs  = variantSuffix(variant)
  const vln = variantLongName(variant)

  switch (grade) {
    case 'A':
      return {
        inventoryId: `05RMDE${vs}`,
        description: `Raw Material Dry: Export - ${vln}`,
        isPhantom:   false,
      }
    case 'B':
      return {
        inventoryId: `05RMDBL${vs}`,
        description: `Raw Material Dry: Export Blend - ${vln}`,
        isPhantom:   false,
      }
    case 'C':
      return {
        inventoryId: `05RMDD${vs}`,
        description: `Raw Material Dry: Domestic - ${vln}`,
        isPhantom:   false,
      }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Formatting helper
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label combining the inventory ID and description.
 * e.g. '10LGEF-C — Sieved Fine Leaf: Export - Conventional'
 */
export function formatCodeLabel(code: AcumaticaCode): string {
  return `${code.inventoryId} — ${code.description}`
}
