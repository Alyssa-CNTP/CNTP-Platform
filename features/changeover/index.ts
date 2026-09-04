/**
 * Mid-shift grade/variant changeover — the UI.
 *
 * ── The three-way split, and why it is where it is ──────────────────────────
 *
 * | Layer   | Owns                        | Lives in                        |
 * |---------|-----------------------------|---------------------------------|
 * | core    | the RULES                   | lib/core/changeover.ts          |
 * | feature | the PRESENTATION            | here                            |
 * | page    | the SESSION LIFECYCLE       | capture/[section]/page.tsx      |
 *
 * `planChangeover()` in core answers both questions once — may this actor do it
 * (`blockedReason`), and may this material be carried (`carryRefusal`) — and the
 * trigger, the dialog and the handler all read that same object. They cannot
 * disagree, which is the whole point: the earlier code re-decided in three
 * places and they drifted.
 *
 * The HANDLER deliberately stays on the page. It flushes unsaved edits, writes
 * the closing balance snapshot, appends to the bucket-elevator ledger and opens
 * a new session — session lifecycle the page owns and this feature has no
 * business reaching into. Dragging it in here would mean passing six callbacks
 * and would make the feature a second owner of the save path. What moved is the
 * ~150 lines of JSX; what stayed is what the page is for.
 *
 * ── Why the feature is only the UI, and that is not a cop-out ───────────────
 *
 * `main` removed this button because it was BROKEN, not unwanted. The rules were
 * the broken part and they are now core, tested, and shared by all three call
 * sites. The presentation is what is left, and having it behind an index.ts and
 * a flag is what lets it be promoted to production switched OFF, then switched
 * on once a shift has run against it — instead of arriving live on the floor.
 *
 * ── NOT part of this feature ────────────────────────────────────────────────
 *
 * Two other things in the capture page share the word "changeover" and are a
 * different concern — shift HANDOVER, not grade/variant:
 *
 *   • `ChangeoverModal`       — the 16h00 PIN gate for the incoming operator
 *   • `ChangeoverSubmitModal` — the "is there a changeover?" early-submit prompt
 *
 * Neither reads a `ChangeoverPlan`. Folding them in here because the word
 * matches is exactly the duck-typing mistake ARCHITECTURE.md §1A describes,
 * applied to names instead of fields.
 */

export { ChangeoverTrigger } from './ChangeoverTrigger'
export { ChangeoverDialog } from './ChangeoverDialog'
