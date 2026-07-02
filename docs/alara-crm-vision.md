# Alara — CRM & Closed-Loop Vision

> Carry-over spec for building Alara from a **read-only signal feed** into an
> **intelligence organism that acts**: signals → generation → CRM records you work.
> Owner: **Alyssa Krishna**. Status: spec for a fresh build session.

---

## 1. The north star — close the loop

Today the flow dead-ends: **signals arrive → AI generates something → it goes nowhere.**
The whole project is to make it a loop:

```
Signals → Intelligence → GENERATE (campaign | audience | lead | briefing)
   → LANDS as a working CRM record → you work it → outcome feeds back
```

Every "what happens after the AI generates X?" question resolves the same way:
**X becomes a persistent, workable record — not disposable text.**

---

## 2. The CRM already exists in the schema (wire into it, don't rebuild)

Production `sales` schema (Supabase `sxzjjcyuzyfneesnsjna`) already has the tables. The
gap is (a) generation doesn't *write* to them and (b) the UI doesn't let you *work* them.

| Table | Role in the loop |
|---|---|
| `signals` | raw scored intelligence (the engine already fills this) |
| `company_profiles` | relationship dossiers — values, decision-makers, current supplier |
| `accounts` / `customers` | CRM accounts you work |
| `account_interactions` | activity log / touchpoints per account |
| `targets` | target companies & segments (= audiences) |
| `market_scores` | scoring / prioritisation |
| `reports` | saved briefings |
| `research_sessions` / `ai_interactions` | AI generation history |
| `intel_cache` | cached intelligence |
| `vault_documents` | dropped files (trade data, trip reports) |
| `house_style` | brand voice for campaign generation |
| `forecasts` / `forecast_history` / `actuals` / `okrs` | sales targets & goals |
| `alerts` | high-relevance signal alerts |

**Likely new tables to add:** `campaigns`, `audiences`, `leads` (or reuse
`accounts` as the lead pipeline with a `stage` column). Confirm what exists vs.
what's missing before building — introspect the live schema first.

---

## 3. What each generation must write (the linking model)

- **Generate campaign** → row in `campaigns` { title, body, channel, status:
  draft→active→sent, `house_style` used } linked to → the **signals** that inspired it
  (provenance) + the **audience** it targets.
- **Generate audience** → row in `audiences` = a saved segment of `company_profiles` /
  `targets` (by region, segment, values, current-supplier). Reusable across campaigns.
- **Generate lead** → create/update `accounts` (or `company_profiles`) with:
  source signals attached, the signal's **`sales_angle` as the first "next action"**,
  a `stage`, an owner, and notes. Every lead is traceable back to why it exists.
- **Generate briefing** → row in `reports`, rendered as **cited cards** (claim → source
  link), not a wall of text.
- Log every generation in `ai_interactions` / `research_sessions` for history + reuse.

**Rule:** nothing the AI generates is ephemeral. It always lands, always links back to
its source signals, and always carries a next action.

---

## 4. Issue list → concrete specs

### Marketing
- **AI campaigns/audiences → connect the output.** On generate, persist to
  `campaigns`/`audiences` (§3). Show them in a working list with status.
- **Clean up briefing output UI.** Structured, cited cards saved to `reports`.
- **Fix Opportunities & Social Trends cards.** Wire to real `signals` data
  (filter by classification/intelligence_type + recency); apply the polish pass done on
  `SignalCard` (accent rail, badges, recommended-action block).
- **Fix Audience Signals card.** Should surface which `company_profiles`/segments a
  cluster of signals points to → one click to "build audience".
- **After AI generates leads:** they land in the Leads/Accounts pipeline (below).

### Sales
- **Same loop as Marketing**, different outputs: generation → deal/lead records in the
  CRM. Sales Dashboard shows the pipeline (`accounts` by `stage`), next actions
  (`sales_angle`), linked signals + trade data, and forecast tie-in (`forecasts`).

### Shared CRM heart — "the pipeline"
- Leads/Accounts view: assignable, `stage`, next-action, notes,
  `account_interactions` timeline, and **linked source signals + trade shipments**.
- This is the single place both Sales and Marketing generations flow into.

---

## 5. Global Wits trade data — the highest-value lead source

Files like `BUBBLE TEA 0902.xlsx` are **real customs/shipment records** (HS 0902 tea).
Columns: `No., DATASOURCE, DATES, HS CODE, SITC, PRODUCT DESCRIPTION, SUPPLIER,
PURCHASER, COUNTRY OF ORIGIN, PURCHASING COUNTRY, …` (16 cols); sheets:
`hscode 0902 / US / global shipping / rooibos`.

Each **`PURCHASER`** is a **named buyer** = a warm lead or a competitor's customer to
win. Build a **file-drop** (like the vault):

1. Drop an `.xlsx` → parse each shipment row.
2. Create/update `company_profiles`/`accounts` for each `PURCHASER` (+ their supplier,
   origin, purchasing country, product).
3. Emit trade `signals` (`source_type: 'trade'`) so they flow through the same feed.
4. Store the raw file in `vault_documents`.

This is the Panjiva layer — actual buyers, not social buzz. Reusable drop-zone for any
future trade file.

---

## 6. Sources — remove LinkedIn for now
Drop LinkedIn scraping. Lean on the live engine's sources (news + TikTok + Instagram +
X/web via Exa + YouTube) plus the **trade-data file drop**. Revisit LinkedIn later.

---

## 7. About Alara (identity section)

Give the platform a face — an "About Alara" section:

- **Name.** "Ala" is drawn from ***Aspalathus linearis*** — the botanical name of
  rooibos (asp‑**ala**‑thus). _[TODO — Alyssa to confirm the personal half of the name:
  the "...ra"/relating-to-me part. Best guess: **Al**yssa + **Ala** (Aspalathus) →
  **Alara**. Do not publish until confirmed.]_
- **Creator.** Built by **Alyssa Krishna**.
- **Intended use.** A living sales- & market-intelligence organism for CNTP — not a
  report generator. It watches the world for rooibos/red-espresso/white-space signals,
  scores them, and turns them into action.
- **Where she's headed.** From signal feed → closed-loop CRM → trade-data-driven lead
  generation → global white-space discovery (entering markets before they know rooibos).

---

## 8. Build order (do #1 first or nothing sticks)

1. **CRM data model + linking** — introspect live schema; add `campaigns`/`audiences`/
   lead-`stage`; wire foreign keys back to `signals`/`company_profiles`.
2. **Wire generation → CRM** (Sales + Marketing): generate now *creates records*.
3. **Polish + wire the cards** (Opportunities, Social Trends, Audience Signals) + cited
   briefing output.
4. **Global Wits file-drop** → trade leads.
5. **About Alara** section.

---

## 9. Schema introspection — DONE (2026-07-02)

Live `sales` schema (prod `sxzjjcyuzyfneesnsjna`) introspected via PostgREST OpenAPI. Findings:
- **`accounts` is already the lead/account pipeline** — has `stage`, `signal_ids`,
  `assigned_to`, `sales_angle` (+ name, country, region, account_type, size_tier,
  primary_contact_*, status, pricing_tier, certifications_required, tags,
  is_japan_sensitive). **No new leads table needed.**
- `company_profiles` — dossiers: company_name, country, sector, values_tags,
  decision_makers, `panjiva_data`, vault_mentions, pitch_angle, raw_profile, `account_id`.
- `account_interactions` — timeline: account_id, interaction_type, summary, sentiment,
  ai_assisted, ai_interaction_id, next_step, next_step_due, occurred_at, logged_by.
- `ai_interactions` — generation log WITH `verdict`/`edited_response` feedback loop.
- `reports` (briefings), `house_style` (brand voice), `vault_documents`, `intel_cache`,
  `market_scores`, `forecasts`/`targets`/`okrs` all present.
- **Only gap:** `campaigns` + `audiences` — added by `supabase/migrations/20260702_001_crm_campaigns_audiences.sql`.

Remaining open questions:
- Confirm the personal half of the "Alara" etymology (§7).
- Audit which UI pages host the Opportunities / Social Trends / Audience Signals cards
  (marketing vs intelligence) before the polish pass.

## 10. Phase-2 build order (app wiring)
1. **Lead loop first** (`accounts` is ready): pipeline-by-stage view + account detail
   (dossier + timeline + linked signals + trade data + sales_angle) + "promote signal → lead".
2. **Marketing loop:** wire campaign/audience generators to persist to the new tables;
   campaign list + audience builder.
3. **Card fixes + cited briefing output.**
