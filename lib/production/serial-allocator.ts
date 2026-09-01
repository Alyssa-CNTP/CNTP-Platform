/**
 * Allocating a bag serial.  ARCHITECTURE.md §5.
 *
 * lib/core/serials.ts builds serials and is pure. This is the other half: it
 * gets the NUMBER, which needs the database, and is therefore a feature-layer
 * module rather than core.
 *
 * The number comes from `production.next_bag_seq(scope)` — an atomic upsert on
 * a counter row. Not from `max + 1` over bag_tags, which is what every capture
 * section does today and is the documented cause of bags going missing: two
 * operators adding a bag in the same moment read the same max, mint the same
 * serial, and one row loses the primary-key race (§1B).
 */

import { getDb } from '@/lib/supabase/db'
import {
  serialScope, formatBagSerial, maxSeq,
  type BagSerialParts, type WorkCentre,
} from '@/lib/core/serials'

export type AllocationSource = 'db' | 'local'

export interface AllocatedSerial {
  serial: string
  seq: number
  scope: string
  /**
   * Where the number came from. 'local' means the RPC was unreachable and the
   * number was seeded from bags already on this screen — usable, but NOT
   * collision-proof. Callers that can surface it should; see below.
   */
  source: AllocationSource
}

/**
 * Allocate the next serial for a bag.
 *
 * `localSerials` is only the offline fallback. Pass this session's own bag
 * serials so a tablet that loses signal mid-shift keeps numbering upward
 * instead of restarting at 001 and colliding with its own earlier bags.
 *
 * THE FALLBACK IS NOT SAFE UNDER CONCURRENCY and is not meant to be — it is
 * the difference between "this tablet can keep working" and "this tablet
 * stops". It reports `source: 'local'` so the caller can flag it rather than
 * letting a silent downgrade look identical to the safe path. The moment the
 * RPC is reachable again, allocation goes back through the counter, which is
 * seeded high enough that local numbers get skipped rather than reused.
 */
export async function allocateBagSerial(
  parts: Omit<BagSerialParts, 'seq'>,
  localSerials: readonly string[] = [],
): Promise<AllocatedSerial> {
  // Throws for a Granule bag with no lot or a Blender bag with no blend — a
  // programming error, and better here (before a round trip) than after one.
  const scope = serialScope(parts)

  try {
    const { data, error } = await getDb()
      .schema('production')
      .rpc('next_bag_seq' as never, { p_scope: scope } as never)
    if (error) throw error
    const seq = Number(data)
    if (!Number.isFinite(seq) || seq < 1) throw new Error(`next_bag_seq returned ${String(data)}`)
    return { serial: formatBagSerial({ ...parts, seq }), seq, scope, source: 'db' }
  } catch {
    const seq = localMaxWithinScope(scope, localSerials) + 1
    return { serial: formatBagSerial({ ...parts, seq }), seq, scope, source: 'local' }
  }
}

/**
 * Highest number already used within THIS scope, from serials on hand.
 *
 * Filtering by scope matters: a Sieving session holds Fine Leaf and Coarse
 * Leaf bags at once, and they are separate counters. Taking the max across all
 * of them would make one product's numbering jump every time the other was
 * bagged — not a collision, but a sequence that no longer counts anything.
 *
 * The scope is a true prefix of the serial for every work centre including
 * Granule (`GLSG-RSGG-05626` prefixes `GLSG-RSGG-05626-01092026-007`), which
 * is what makes a startsWith test correct here rather than merely convenient.
 */
function localMaxWithinScope(scope: string, serials: readonly string[]): number {
  const mine = serials.filter(s => String(s).toUpperCase().startsWith(scope.toUpperCase()))
  return maxSeq(mine)
}

/**
 * Has the counter for a scope ever been used? Read-only, for diagnostics —
 * never to derive the next number, which is the whole point of the RPC.
 */
export async function peekBagSeq(scope: string): Promise<number | null> {
  try {
    const { data, error } = await getDb()
      .schema('production')
      .from('bag_serial_counters')
      .select('last_seq')
      .eq('scope', scope)
      .maybeSingle()
    if (error) throw error
    return data ? Number((data as { last_seq: number }).last_seq) : 0
  } catch {
    return null
  }
}

/** Re-export so callers need one import to mint a serial, not two. */
export type { BagSerialParts, WorkCentre }
