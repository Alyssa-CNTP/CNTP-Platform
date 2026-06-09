-- ══════════════════════════════════════════════════════════════════════════════
-- CNTP Ops — sales intelligence migrations
-- Adds: house-style prompt store, AI interaction feedback log,
--       accounts + account_interactions scaffold (Phase 3).
--
-- Run in the Supabase SQL editor against the production database, in order.
-- Idempotent — safe to re-run. RLS policies use shared.app_roles for access.
-- ══════════════════════════════════════════════════════════════════════════════

-- The `sales` schema already exists (per sales.signals). Ensure it's there.
CREATE SCHEMA IF NOT EXISTS sales;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. HOUSE STYLE — versioned voice/tone document, one active at a time.
--    Injected into every Gemini call as a system-prompt fragment.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales.house_style (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version     int         NOT NULL,
  content     text        NOT NULL,
  notes       text,                                  -- changelog: why this version
  is_active   boolean     NOT NULL DEFAULT false,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Only one active row at a time
CREATE UNIQUE INDEX IF NOT EXISTS house_style_one_active_idx
  ON sales.house_style (is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS house_style_version_idx
  ON sales.house_style (version DESC);

-- ── Seed v1 — a structured scaffold for Alyssa to fill in ─────────────────────
-- Edit the [PLACEHOLDER] fields via the admin UI (or directly here) and re-run.
INSERT INTO sales.house_style (version, content, notes, is_active)
SELECT
  1,
$HS$# CNTP House Style — Voice, Tone & Conduct
*Injected into every Gemini call. Treat as binding for the AI.*

## VOICE
- Register: formal, sophisticated, precise. No exclamation marks. No emoji.
- Sentence rhythm: short clauses, decisive verbs, no hedging ("would", "perhaps", "might consider" → cut).
- Posture: senior insider, not vendor. We are a heritage producer, not a hopeful supplier.
- Never use the words: [PLACEHOLDER — e.g. "leverage", "exciting", "synergy", "amazing"].
- Always prefer: [PLACEHOLDER — e.g. "we observe", "the data indicates", "we propose"].

## OPENING LINES BY CHANNEL
- Cold email: lead with a fact about THEIR market in the first sentence. Never start with "I hope this finds you well."
- LinkedIn DM: under 60 words. Reference something they posted or a verifiable buyer signal.
- Re-engage (lapsed buyer): name the last touchpoint and what's changed since.
- Sample follow-up: assume they brewed it. Ask one specific sensory question.

## ASKING FOR WHAT WE WANT
- One ask per message. Never two.
- The ask is always a calendar invite, a sample request form, or a price confirmation — never "let me know your thoughts."
- Time-bound: "by Friday", "before the next shipment", "ahead of [trade show]".

## SIGN-OFFS
- Formal markets (DE, JP, KR, GCC): "With regards," then full name + role + direct line.
- Anglophone informal (US/UK/AU/CA): "Best," then first name + role.
- Existing relationships: drop the role. First name only.

## OBJECTION LANGUAGE
- Price: never apologise for it. Frame as "the price reflects the appellation."
- Origin ("we have an SA supplier already"): "We are not asking you to switch. We are asking you to dual-source." — that's it.
- Volume: offer split shipments before discounting.
- Quality: never claim "the best." Claim "audited" and offer the COA.

## CULTURAL ADAPTATIONS
- Japan: defer to seniority in salutation. Never propose changes to existing arrangements in a first message — only additions.
- Germany / Netherlands: technical specs in the opener. Lead with COA, certifications, batch traceability.
- GCC / Saudi Arabia: Halal-certified framing, founder-to-founder tone, longer relationship ramp.
- Korea: K-beauty / functional angle, not heritage angle. Aspalathin, not Cederberg.
- Latin America: warmth + Spanish/Portuguese salutation if confirmed.
- USA: ROI, shelf velocity, certification stack. Skip the heritage paragraph.

## RELATIONSHIP ETIQUETTE
- We never disparage competitors by name in writing.
- We never promise exclusivity in a first conversation.
- We never quote a price in an unsolicited cold message.
- We never claim certifications we don't hold. If a cert is in-progress, say "targeted for Q[X]".

## CADENCE
- New prospect: touch 1 → +3 days → +7 days → +14 days → pause. No more than 4 contacts unsolicited.
- Active negotiation: response within one working day in the buyer's timezone.
- Sampled buyer: 5-day follow-up window after estimated arrival, then 2-week pause.

## NEVER SAY
- The company's full name in any outbound message (use "the company" or "we").
- The word "exclusive" without legal review.
- A specific price without confirming the current FOB rate sheet.
- Anything about the Japan account to any other buyer.

## RECENT PATTERNS TO MIMIC
*Fill this in as you accumulate wins. Each entry: market, what worked, exact phrasing.*
- [PLACEHOLDER — example: "DE/health-food, Apr 2026: opener referencing EU organic regulation update converted 3/5 cold messages to reply."]

## RECENT PATTERNS TO AVOID
*Fill this in from losses or ignored outreach.*
- [PLACEHOLDER]

## ESCALATION
- Anything that could affect the Japan account → flag, do not auto-respond.
- Pricing below the floor sheet → flag, do not auto-respond.
- New market with no precedent → flag and request a vault check before drafting outbound.
$HS$,
  'Initial scaffold — Alyssa to fill placeholders',
  true
WHERE NOT EXISTS (SELECT 1 FROM sales.house_style WHERE is_active = true);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. AI INTERACTIONS — feedback log for every Gemini call.
--    Foundation for future fine-tuning datasets.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales.ai_interactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id),
  action            text        NOT NULL,
  request_body      jsonb,                                -- the original POST body (PII-scrubbed at call site)
  full_prompt       text,                                 -- final prompt that hit the model (system + extras + user)
  response          text,                                 -- model output, verbatim
  model             text,                                 -- which model in the fallback chain served it
  house_style_v     int,                                  -- which house-style version was in force
  retrieved_chunks  jsonb,                                -- {vault: [...], signals: [...]} — which RAG hits were injected
  verdict           text CHECK (verdict IN ('accepted','edited','discarded')),
  edited_response   text,                                 -- if verdict='edited', the user's final version
  verdict_notes     text,                                 -- free-form feedback ("too verbose", "wrong tone")
  created_at        timestamptz NOT NULL DEFAULT now(),
  verdict_at        timestamptz
);

CREATE INDEX IF NOT EXISTS ai_interactions_user_idx
  ON sales.ai_interactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_interactions_verdict_idx
  ON sales.ai_interactions (verdict, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_interactions_action_idx
  ON sales.ai_interactions (action, created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ACCOUNTS + INTERACTIONS — Phase 3 scaffold.
--    No UI yet. Tables ready so retrieval can layer in once data is entered.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales.accounts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  country               text,                              -- ISO-2 preferred for join with signals
  region                text,                              -- e.g. 'EUROPE · DACH'
  account_type          text,                              -- 'distributor' | 'oem' | 'private_label' | 'retailer' | 'broker'
  size_tier             text,                              -- 'enterprise' | 'mid' | 'small'
  primary_contact_name  text,
  primary_contact_role  text,
  primary_contact_email text,
  preferred_channel     text,                              -- 'whatsapp' | 'email' | 'linkedin' | 'in_person'
  status                text DEFAULT 'prospect',           -- 'prospect' | 'contacted' | 'sampling' | 'negotiating' | 'active' | 'dormant' | 'lost'
  payment_terms         text,                              -- 'net30' | 'net60' | 'cad' | etc
  pricing_tier          text,                              -- 'premium' | 'standard' | 'value'
  certifications_required text[],                          -- e.g. {'organic','halal'}
  notes                 text,
  tags                  text[],
  is_japan_sensitive    boolean     DEFAULT false,         -- flag accounts that touch the Japan relationship
  created_by            uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounts_name_idx
  ON sales.accounts USING gin(to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS accounts_status_idx
  ON sales.accounts (status);

CREATE INDEX IF NOT EXISTS accounts_country_idx
  ON sales.accounts (country);

CREATE TABLE IF NOT EXISTS sales.account_interactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid        NOT NULL REFERENCES sales.accounts(id) ON DELETE CASCADE,
  interaction_type  text        NOT NULL,                  -- 'email' | 'call' | 'meeting' | 'sample_sent' | 'quote' | 'order' | 'note' | 'objection'
  summary           text        NOT NULL,
  sentiment         text,                                  -- 'positive' | 'neutral' | 'negative'
  ai_assisted       boolean     DEFAULT false,             -- did Gemini draft this?
  ai_interaction_id uuid        REFERENCES sales.ai_interactions(id) ON DELETE SET NULL,
  next_step         text,
  next_step_due     date,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  logged_by         uuid        REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_interactions_account_idx
  ON sales.account_interactions (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS account_interactions_next_step_idx
  ON sales.account_interactions (next_step_due) WHERE next_step_due IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. RLS — gate by shared.app_roles, matching the existing pattern.
--    READ: IT / Sales / Management / Marketing.
--    WRITE: IT / Sales (Management read-only, Marketing read-only).
--    The `is_admin_or_sales()` helper mirrors how /api/sales already gates.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE sales.house_style          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.ai_interactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.account_interactions ENABLE ROW LEVEL SECURITY;

-- Helper: returns true if the caller has sales-engine access.
CREATE OR REPLACE FUNCTION sales.has_sales_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, shared
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shared.app_roles
    WHERE user_id = auth.uid()
      AND (
        department IN ('IT','Sales','Management','Marketing')
        OR (permissions->>'can_access_sales')::boolean = true
        OR (permissions->>'can_access_intelligence')::boolean = true
      )
  );
$$;

-- Helper: returns true if the caller can MUTATE sales-engine state.
CREATE OR REPLACE FUNCTION sales.can_mutate_sales()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, shared
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shared.app_roles
    WHERE user_id = auth.uid()
      AND (
        department IN ('IT','Sales')
        OR (permissions->>'can_access_sales')::boolean = true
      )
  );
$$;

-- ── house_style policies ──
DROP POLICY IF EXISTS house_style_read   ON sales.house_style;
DROP POLICY IF EXISTS house_style_write  ON sales.house_style;
CREATE POLICY house_style_read  ON sales.house_style FOR SELECT USING (sales.has_sales_access());
CREATE POLICY house_style_write ON sales.house_style FOR ALL    USING (sales.can_mutate_sales()) WITH CHECK (sales.can_mutate_sales());

-- ── ai_interactions policies ──
-- Read: any sales-access user can read their own; IT can read all.
-- Write: any sales-access user can insert their own; IT can update verdicts on any.
DROP POLICY IF EXISTS ai_interactions_read   ON sales.ai_interactions;
DROP POLICY IF EXISTS ai_interactions_insert ON sales.ai_interactions;
DROP POLICY IF EXISTS ai_interactions_update ON sales.ai_interactions;
CREATE POLICY ai_interactions_read   ON sales.ai_interactions FOR SELECT USING (
  sales.has_sales_access() AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM shared.app_roles WHERE user_id = auth.uid() AND department = 'IT')
  )
);
CREATE POLICY ai_interactions_insert ON sales.ai_interactions FOR INSERT WITH CHECK (
  sales.has_sales_access() AND user_id = auth.uid()
);
CREATE POLICY ai_interactions_update ON sales.ai_interactions FOR UPDATE USING (
  sales.has_sales_access() AND (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM shared.app_roles WHERE user_id = auth.uid() AND department = 'IT')
  )
);

-- ── accounts policies ──
DROP POLICY IF EXISTS accounts_read  ON sales.accounts;
DROP POLICY IF EXISTS accounts_write ON sales.accounts;
CREATE POLICY accounts_read  ON sales.accounts FOR SELECT USING (sales.has_sales_access());
CREATE POLICY accounts_write ON sales.accounts FOR ALL    USING (sales.can_mutate_sales()) WITH CHECK (sales.can_mutate_sales());

-- ── account_interactions policies ──
DROP POLICY IF EXISTS account_interactions_read  ON sales.account_interactions;
DROP POLICY IF EXISTS account_interactions_write ON sales.account_interactions;
CREATE POLICY account_interactions_read  ON sales.account_interactions FOR SELECT USING (sales.has_sales_access());
CREATE POLICY account_interactions_write ON sales.account_interactions FOR ALL    USING (sales.can_mutate_sales()) WITH CHECK (sales.can_mutate_sales());

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. UPDATED-AT TRIGGER on accounts
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sales.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_set_updated_at ON sales.accounts;
CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON sales.accounts
  FOR EACH ROW EXECUTE FUNCTION sales.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- DONE. Verify with:
--   SELECT version, is_active, length(content) FROM sales.house_style;
--   SELECT count(*) FROM sales.ai_interactions;
-- ──────────────────────────────────────────────────────────────────────────────
