-- ============================================================
-- Labels belong to a customer.
-- Run in: Supabase SQL Editor — STAGING first, then PRODUCTION.
-- ============================================================
--
-- Sales pick a label for a customer, not for a certification scheme. Today the
-- library is named by scheme — EU-ORG, JAS, NOP-USA, EU-NOP-RA-ORG — and a
-- salesperson looking for Lipton's label has to know which union's rules apply
-- to it. That is backwards: the scheme is a consequence of the customer and the
-- market, not the thing a human should search on.
--
-- The seed set is already inconsistent about this, which is the tell: nine
-- templates are named by scheme and one, KUNITARO-RA, by customer. This
-- finishes the model that was started there.
--
-- ── Why TEXT and not a uuid FK ──────────────────────────────────────────────
--
-- There is no customers master table to point at. Checked on staging
-- 2026-09-07:
--
--   public.customers      does not exist
--   logistics.customers   does not exist (the dispatch page references it, but
--                         the table is not deployed — a separate problem)
--   sales.customers       does not exist. The `sales` schema IS exposed
--                         (sales.signals answers), so this is a missing table,
--                         not an unexposed schema.
--
-- What DOES exist, and is populated, is qms.customer_specs.customer — 45 spec
-- rows across 10 customers (Kunitaro, Lipton and Infusion, Lupicia, Tanganda,
-- Alveus, Edelweiss, Entyce, OTG, East West Tea Company, Afri Tea and Coffee's).
-- Alyssa confirmed that is the source to reference.
--
-- So this column holds the CANONICAL CUSTOMER NAME, the same vocabulary
-- qms.customer_specs.customer uses. Not a foreign key, for two reasons:
--
--   1. customer_specs.customer is not unique — one customer legitimately holds
--      many spec rows (45 across 10). There is no key to reference.
--   2. It is in another schema owned by another module. A cross-schema FK from
--      public to qms would couple the label workflow's writes to the quality
--      module's row lifecycle, and deleting a spec would block deleting nothing
--      useful.
--
-- Spelling drift is the obvious objection, and it is already solved:
-- qms.customer_aliases plus resolveCustomerName() in
-- lib/quality/customer-spec-match.ts exist precisely because one customer is
-- spelled several ways. The label editor offers a PICKER of existing names
-- rather than a free-text box, so drift needs deliberate effort.
--
-- If a real customers master arrives later, this becomes a uuid in one
-- migration and a backfill on name — which is why the name is stored
-- canonically rather than as whatever was typed.
--
-- ── Nullable on purpose ─────────────────────────────────────────────────────
--
-- NULL means a generic label available to everyone — LOCAL, plain EXPORT. Those
-- are real and must not be forced to invent a customer.
--
-- One label, one customer, deliberately. Approval is given BY a customer for
-- THEIR label; sharing an approved template across two customers would put
-- customer B's product under an approval only customer A gave. Two customers
-- wanting the same design is two templates, and that is the honest record.
-- ============================================================

ALTER TABLE public.label_templates
  ADD COLUMN IF NOT EXISTS customer text;

COMMENT ON COLUMN public.label_templates.customer IS
  'Canonical customer name, matching qms.customer_specs.customer. NULL = a '
  'generic label available to any customer. Deliberately text and not a FK: '
  'there is no customers master table, and customer_specs.customer is not '
  'unique. Spelling is held canonical via qms.customer_aliases / '
  'resolveCustomerName(); the editor offers a picker, not free text.';

-- The labels library is grouped and filtered by customer on every load of
-- /pasteuriser/labels, and version history is read per family within that.
CREATE INDEX IF NOT EXISTS label_templates_customer_idx
  ON public.label_templates (customer);

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'label_templates'
--     AND column_name = 'customer';
--
-- Expected: one row, text, YES.
--
-- Every existing template keeps customer = NULL and therefore keeps working —
-- it simply shows under "Any customer" until someone assigns it. Nothing is
-- rewritten, and no approval is disturbed.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
--   DROP INDEX IF EXISTS public.label_templates_customer_idx;
--   ALTER TABLE public.label_templates DROP COLUMN IF EXISTS customer;
