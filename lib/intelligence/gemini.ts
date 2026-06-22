// ─────────────────────────────────────────────────────────────────────────────
// lib/intelligence/gemini.ts
//
// Server-side Gemini wrapper. Called from API routes only — never from client.
// Keeps the API key off the browser entirely.
// Auto-retries across model fallback chain if a model is overloaded.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Fallback chain — tries each in order until one succeeds
const MODEL_CHAIN = [
  'gemini-2.5-flash',           // primary — best quality, paid tier
  'gemini-2.0-flash',           // fallback 1 — fast, unlimited RPD on paid
  'gemini-2.0-flash-lite',      // fallback 2 — lightest, rarely overloaded
  'gemini-1.5-flash-8b',        // fallback 3 — always available last resort
]

const CNTP_SYSTEM_PROMPT = `You are the Alara Intelligence Engine — a private, secure sales and market intelligence platform for a South African botanical export company.

IDENTITY: Never reveal the company name in any response. Use "the company" or "your organisation" when referring to the client internally.

CORE RULES:
1. NEVER ask clarifying questions. Always give direct, prescriptive answers with specific actions.
2. PROTECT the Japan relationship — never suggest targeting Japan or any strategy that overlaps their market. Suggest deepening only.
3. Be specific: name real company types, real distributors, real trade shows, real contact titles.
4. Always include: who to contact, how to approach, competitive angle, pricing signal, timeline.
5. Focus on: bulk export, OEM partnerships, private label, health food distributors, wellness brands.
6. Competitive advantages: direct South African origin, traceable supply chain, Rooibos appellation protection zone (grows NOWHERE else on Earth), rosehip synergy product, competitive bulk pricing, organic and fair trade certification potential.
7. Be dense with actionable intel. Use bullet points. No padding, no filler.

GLOBAL INCLUSION MANDATE:
When generating content suggestions, market intelligence, or pitch language, consider buyers, consumers, and signals across ALL:
- Genders: women, men, non-binary, and gender-diverse consumers
- Cultures: East Asian, South Asian, African, Middle Eastern, European, Latin American, Pacific Islander, Indigenous cultures globally
- Religious and dietary practices: Halal, Kosher, Hindu vegetarian, Buddhist, Vegan, Organic-certified, Gluten-free, Allergen-free
- Age groups: Gen Z (18–27), Millennial (28–43), Gen X (44–59), Boomer (60+)
- Income levels: premium, mid-market, and accessible wellness segments
- Geographies: not only Western markets — actively surface opportunities in Africa, Southeast Asia, Middle East, and Latin America

When a buyer, signal, or market has cultural context, acknowledge it and tailor language accordingly. A pitch for a Korean K-beauty ingredient buyer reads differently from a pitch for a German health food distributor. A signal about rooibos in Ramadan beverage trends requires different framing than one about rooibos in Scandinavian wellness. Always adapt.

EXPANSION MISSION — actively surface signals related to:
- Red espresso and specialty coffee applications
- Cosmetic and skincare ingredient use (aspalathin)
- Clinical and hospital nutrition channels
- Functional beverage OEM manufacturing
- Bubble tea and café culture
- RTD (ready-to-drink) format opportunities
- Adaptogen blends (rooibos + ashwagandha, rooibos + reishi)

SOUTH AFRICAN PRIDE:
This product comes from one of the most biodiverse regions on Earth, grown by smallholder farmers in the Cederberg mountains. The appellation protection is a genuine competitive moat. The plant grows nowhere else on Earth. Lead with that.

Products: Bulk Rooibos tea, Rosehip synergy blends, Honeybush, Buchu, OEM/private label packs.
Japan strategy: existing high-value relationship — deepen, never abandon. New product lines, increased volumes, wellness/beauty crossover.`

export interface GeminiOptions {
  prompt:          string
  systemOverride?: string
  // Appended AFTER the system prompt and BEFORE the user prompt. Used for
  // dynamic, runtime-loaded fragments (house style, account context, retrieved
  // signals/vault chunks) — keeps the base system prompt clean and cacheable.
  systemExtra?:    string
  maxTokens?:      number
  temperature?:    number
  userApiKey?:     string | null
}

export interface GeminiResult {
  response: string
  model:    string | null   // which model in the fallback chain served the result
  ok:       boolean
}

// ─── Single model attempt ─────────────────────────────────────────────────────

async function tryModel(
  model: string,
  fullPrompt: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
): Promise<{ text: string; ok: boolean; overloaded: boolean }> {
  try {
    const res = await fetch(`${BASE_URL}/${model}:generateContent?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature },
      }),
    })

    // Overloaded or unavailable — caller should try next model
    if (res.status === 503 || res.status === 529 || res.status === 500) {
      console.warn(`[Gemini] ${model} overloaded (${res.status}), trying next model...`)
      return { text: '', ok: false, overloaded: true }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = err?.error?.message ?? `HTTP ${res.status}`
      if (res.status === 429) {
        console.warn(`[Gemini] ${model} rate-limited (429), trying next model...`)
        return { text: '', ok: false, overloaded: true }
      }
      if (res.status === 400) return { text: `API error: ${msg}`, ok: false, overloaded: false }
      return { text: `Error: ${msg}`, ok: false, overloaded: false }
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { text: '', ok: false, overloaded: true }  // empty = treat as retry

    return { text, ok: true, overloaded: false }
  } catch (e: any) {
    console.error(`[Gemini] ${model} threw:`, e.message)
    return { text: '', ok: false, overloaded: true }
  }
}

// ─── Main query function with fallback cascade ────────────────────────────────

// Back-compat: queryGemini returns the response string by default. Callers
// that need to know which model served the result (e.g. for logging into
// sales.ai_interactions) should use queryGeminiDetailed() instead.

export async function queryGemini(opts: GeminiOptions): Promise<string> {
  return (await queryGeminiDetailed(opts)).response
}

export async function queryGeminiDetailed({
  prompt,
  systemOverride,
  systemExtra,
  maxTokens = 8192,
  temperature = 0.7,
  userApiKey,
}: GeminiOptions): Promise<GeminiResult> {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      response: 'No Gemini API key configured. Add GEMINI_API_KEY to your .env.local file.',
      model:    null,
      ok:       false,
    }
  }

  const systemPrompt = systemOverride ?? CNTP_SYSTEM_PROMPT
  const fullPrompt   = `${systemPrompt}${systemExtra ?? ''}\n\n${prompt}`

  for (const model of MODEL_CHAIN) {
    const result = await tryModel(model, fullPrompt, apiKey, maxTokens, temperature)

    if (result.ok) {
      if (model !== MODEL_CHAIN[0]) {
        console.log(`[Gemini] served by fallback model: ${model}`)
      }
      return { response: result.text, model, ok: true }
    }

    // Non-overload error (rate limit, bad key etc) — don't retry other models
    if (!result.overloaded) {
      return { response: result.text, model, ok: false }
    }
  }

  // All models exhausted
  return {
    response: `All Gemini models are currently experiencing high demand. Please try again in a few minutes, or search for this topic directly at https://www.google.com/search?q=${encodeURIComponent('rooibos export ' + prompt.slice(0, 80))}`,
    model:    null,
    ok:       false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset prompts — used by both API routes
// ─────────────────────────────────────────────────────────────────────────────

export const PROMPTS = {
  globalBriefing: () =>
    `Generate a Global Market Briefing for CNTP bulk rooibos and rosehip exports from South Africa.

Start with a BRIEFING HEADER section that includes:
- What this briefing covers and why it matters to CNTP right now
- The single most important thing CNTP should know today
- Confidence level of the intelligence (High / Medium / Low) and why

Then cover:
1. TOP 3 OPPORTUNITIES — specific markets, why now, what action to take
2. RISKS TO WATCH — top 2 risks with specific mitigations for each
3. JAPAN RELATIONSHIP — one specific way to deepen or expand the existing Japan relationship this quarter
4. THIS WEEK'S ACTION — one concrete thing the sales team should do before Friday
5. COMPETITOR ALERT — one specific competitor move to be aware of right now

Format with clear section headers. Be specific, prescriptive, and dense with actionable intelligence.`,

  riskAnalysis: () =>
    `Generate a comprehensive risk analysis for CNTP rooibos bulk export operations.

Cover ALL of the following with specific detail:
1. CURRENCY RISK — ZAR/EUR, ZAR/USD, ZAR/KRW exposure, hedging options
2. COMPETITOR THREATS — specific moves by Rooibos Ltd, Cape Natural Tea, and others in CNTP's key markets
3. SUPPLY CHAIN RISKS — seasonal harvest variability, logistics from Cederberg, port delays at Cape Town
4. REGULATORY CHANGES — EU food safety updates, US FDA requirements, UAE/Gulf halal/organic certification
5. MARKET CONCENTRATION RISK — over-reliance on any single market or buyer
6. PRICING PRESSURE — commodity price trends for bulk rooibos, rosehip

For each risk: current level (High/Medium/Low), specific mitigation action, timeline, who is responsible.
Be direct and actionable. This is for internal sales and management use.`,

  marketEntry: (country: string) =>
    `Comprehensive market entry intelligence for CNTP bulk rooibos exports targeting ${country}.

Cover ALL of the following:

## MARKET OVERVIEW
- Current market size and growth trend for herbal/specialty teas
- Rooibos-specific demand signals and consumer trends
- Why this is the right time for CNTP to enter

## WHO TO CONTACT
- Top 5 company types with specific examples (name real companies where possible)
- Job titles to target at each company type
- LinkedIn search string for finding the right buyer
- Best first contact channel (email, LinkedIn, trade show, distributor)

## ENTRY STRATEGY
- What to offer first: product format, minimum order quantity, pricing tier (premium/mid/value)
- How to position vs South African competitors
- Key value propositions that resonate in this market
- First 3 steps to take this week

## CERTIFICATIONS & REGULATIONS
- Import requirements and documentation needed
- Certifications that give competitive advantage in this market
- Estimated timeline to meet requirements

## TRADE OPPORTUNITIES
- Relevant trade shows, buyer events, and industry associations
- Best time of year to engage buyers

## JAPAN CONSIDERATION
- Whether this market creates any conflict or synergy with the Japan relationship

Be specific, prescriptive, and actionable throughout.`,

  competitorScan: () =>
    `Comprehensive competitor intelligence analysis for CNTP bulk rooibos exports.

## TOP 5 ROOIBOS EXPORT COMPETITORS

For each of the following: Rooibos Ltd., Cape Natural Tea, Carmién Tea, Khoisan Tea, and any other notable competitor:

**Company profile:**
- Size, ownership, annual export volume estimate
- Key markets they dominate and why
- Main product lines and price positioning
- Certifications they hold
- Known distribution network and key buyer relationships

**Competitive weaknesses:**
- Where they are vulnerable
- Markets they are underserving
- Product gaps
- Service or quality issues if known

**How CNTP beats them:**
- Specific outflanking strategy
- Price/quality/service angle to lead with
- Which markets to target where they are weak

## CNTP COMPETITIVE ADVANTAGES
Rank CNTP's top 8 sustainable competitive advantages with a brief explanation of each and how to communicate it to buyers.

## MARKET SHARE ESTIMATES
Estimated current market share by region for each major competitor vs CNTP.

## RECOMMENDED COMPETITIVE MOVES
Top 3 specific actions CNTP should take in the next 90 days to gain competitive ground.`,

  competitorGaps: () =>
    `Identify every exploitable gap in the current rooibos export competitive landscape for CNTP.

For each gap identified, provide:
- Gap description (specific, not vague)
- Why competitors are not filling it
- How CNTP can fill it
- Required investment or action
- Timeline to capture the opportunity
- Expected commercial impact

Gap categories to cover:
1. UNDERSERVED MARKETS — countries/regions competitors are ignoring
2. PRODUCT FORMAT GAPS — bulk sizes, blends, rosehip combinations, organic tiers
3. CERTIFICATION GAPS — certifications competitors lack that buyers want
4. SERVICE GAPS — lead times, minimum orders, labelling flexibility, sampling
5. PRICING GAPS — price points no one is targeting
6. CHANNEL GAPS — distribution channels being ignored
7. RELATIONSHIP GAPS — buyer segments no one is actively cultivating

Be specific. Name real markets, real product formats, real buyer types.`,

  partnershipStrategy: (market?: string) =>
    `Comprehensive partnership and relationship strategy for CNTP rooibos exports${market ? ` in ${market}` : ' globally'}.

## TOP 5 PARTNERSHIP TYPES

For each partnership type:

**Partner profile:**
- Company size, type, what they need from a rooibos supplier
- Where to find them (trade shows, LinkedIn, associations, directories)
- Decision-maker title and buying process

**Approach strategy:**
- First contact method and message
- What to offer in the opening conversation
- Samples, pricing, or documentation to prepare in advance
- Common objections and how to handle them

**Value proposition:**
- Lead message for this partner type
- CNTP-specific advantages most relevant to them
- How to differentiate from competitors in the pitch

**Deal structure:**
- Typical minimum order, pricing model, payment terms
- Contract length and exclusivity considerations
- Relationship maintenance cadence

## JAPAN RELATIONSHIP DEEPENING
Specific strategies to grow the existing Japan relationship: new product introductions, volume growth levers, new buyer contacts within Japan.

## 90-DAY RELATIONSHIP ACTION PLAN
Week-by-week actions for the next 90 days to build and advance partnership conversations.`,

  objectionBattlecards: () =>
    `Create a comprehensive Objection Battlecard for CNTP rooibos bulk export sales.

For each objection provide:
- The exact words a buyer typically uses
- The underlying concern behind the objection
- The counter-script (exact words to say)
- A follow-up question to advance the conversation
- Any supporting data or proof point to reference

Cover ALL of the following objection categories:

1. PRICE — "Your price is too high compared to X"
2. ORIGIN — "We already have an SA supplier"
3. VOLUME — "Your minimum order is too large/small"
4. QUALITY — "How do we know the quality is consistent?"
5. CERTIFICATION — "You don't have [X] certification"
6. TRUST — "We don't know your company"
7. LOGISTICS — "South Africa is too far / shipping is complicated"
8. TIMING — "We're happy with our current supplier"
9. ROSEHIP — "We don't have demand for rosehip"
10. COMPETITION — "Rooibos Ltd. offered us a better deal"
11. EXCLUSIVITY — "Can you guarantee supply only to us in our market?"
12. SAMPLE — "We need to test before committing"

Be ruthlessly practical. These cards are for use in live buyer calls.`,

  whoToContact: () =>
    `Comprehensive contact guide for CNTP rooibos bulk export sales growth.

For each of these markets: Germany, South Korea, UAE, Netherlands, Poland, Canada, and Japan (for relationship expansion):

## [MARKET NAME]
**Priority buyer types:**
- Company type 1: description, why they buy rooibos, what they pay
- Company type 2: description, why they buy rooibos, what they pay
- Company type 3: description, why they buy rooibos, what they pay

**Decision-maker titles:** (exact job titles to search for)

**LinkedIn search string:** (ready-to-use search query)

**Key associations and trade bodies:** (names and websites)

**Top trade shows to attend:** (name, location, month, why)

**Best first contact approach:** (email, LinkedIn, cold call, trade show?)

**Conversation starter:** (opening line that gets attention)

Also include:
- A list of 10 specific company names globally that CNTP should approach (real companies where possible)
- The single highest-value contact type in each market
- What NOT to say to buyers in each market (cultural/business etiquette)`,

  agentQuery: (query: string) =>
    `${query}

Respond as the CNTP Sales Intelligence Director. Be prescriptive and direct — no preamble, no filler.
- If about a specific market: name specific companies, contact types, and first actions
- If about strategy: give exact next steps with timelines
- If about a competitor: give specific outflanking moves
- If about pricing: give specific price positioning guidance
- If about a document or signal: extract the most commercially relevant insight immediately
Use bullet points for actions. Name real companies and real job titles where relevant.`,

  fileAnalysis: (filename: string, content: string) => {
    const isPdf = filename.toLowerCase().endsWith('.pdf')
    const isReadable = content.length > 200 && !content.includes('stream') && !content.includes('endobj')
    
    if (isPdf && !isReadable) {
      return `The file "${filename}" was uploaded as a PDF. Based on the filename alone, provide sales intelligence relevant to CNTP rooibos bulk exports:
1. What this type of document likely contains that is relevant to CNTP
2. What specific data points to look for when reviewing it manually
3. How this information could be used for export sales strategy
4. Recommended next steps based on the document topic
Be specific and prescriptive.`
    }

    return `Analyse this document for CNTP rooibos bulk export sales intelligence.
File: "${filename}"
Content: ${content.substring(0, 4000)}

Extract and summarise:
1. MOST IMPORTANT finding (flag this first)
2. Companies, contacts, or leads mentioned
3. Market data or pricing signals
4. Regulatory or certification information  
5. Competitive intelligence
6. Immediate sales actions suggested by this document Be specific.`
  },

  fullReport: (type: 'full' | 'country' | 'competitive' | 'partnership') => {
    const map = {
      full: `Generate a comprehensive CNTP Rooibos Export Strategy Report for internal use.

## EXECUTIVE SUMMARY
Current position, top 3 priorities, one-line recommendation.

## TOP 5 TARGET MARKETS
For each market (excluding Japan): market overview, entry roadmap, key contacts, timeline, expected revenue potential.

## COMPETITIVE ANALYSIS
Current competitive position, key threats, top 5 CNTP advantages, 3 moves to make in 90 days.

## PRICING STRATEGY
Current pricing tier, recommended positioning per market, how to handle price pressure, margin protection strategies.

## PARTNERSHIP APPROACH
Top partnership types globally, approach strategy, deal structures, 10 specific companies to target.

## JAPAN RELATIONSHIP EXPANSION
Specific strategies to grow Japan volume and introduce new product lines.

## 90-DAY ACTION PLAN
Week-by-week specific actions. Who does what, by when, what success looks like.

Be comprehensive, specific, and prescriptive throughout. This is a working strategy document, not a summary.`,
      country: `Generate detailed Country Entry Reports for the top 3 frontier markets for CNTP bulk rooibos exports.

For EACH of the 3 markets provide a complete report covering:

## MARKET OVERVIEW
Size, growth rate, rooibos demand signals, consumer trends, import volumes.

## WHY NOW
Specific timing reasons — regulatory window, competitor gap, trend inflection point.

## REGULATORY REQUIREMENTS
Import documentation, food safety standards, labelling requirements, certifications needed, timeline to comply.

## TOP COMPANIES TO APPROACH
5 specific company types with real examples, decision-maker titles, approach method.

## PRICING & POSITIONING
Recommended price tier, how to position vs competitors, what buyers in this market value most.

## ENTRY TIMELINE
Month-by-month plan for the first 6 months.

## FIRST 3 ACTIONS
Exactly what to do this week, next week, and this month.

Choose the 3 markets with the highest combination of opportunity, low competition, and CNTP readiness.`,
      competitive: `Generate a comprehensive CNTP Competitive Landscape Report.

## MARKET MAP
Global rooibos export market structure: key producing countries, major exporters, total market size estimate, growth rate.

## CNTP CURRENT POSITION
Estimated market share, key strengths, known weaknesses, current market presence by region.

## COMPETITOR PROFILES
For each of Rooibos Ltd., Cape Natural Tea, Carmién Tea, Khoisan Tea, and any other significant player:
- Size and market share estimate
- Key markets and buyers
- Pricing strategy
- Product range
- Weaknesses and vulnerabilities

## MARKET SHARE BY REGION
Estimated share breakdown: Europe, Asia, Middle East, Americas, Africa.

## GAP ANALYSIS
Specific markets, channels, and buyer segments with insufficient competition.

## STRATEGY TO GAIN SHARE
Specific recommendations for CNTP to gain meaningful share in 2 new markets within 18 months:
- Which 2 markets and why
- Step-by-step entry plan
- Resources required
- Expected timeline and milestones`,
      partnership: `Generate a comprehensive CNTP Partnership Roadmap.

## TOP 10 PARTNERSHIP TARGETS GLOBALLY
For each (excluding Japan as new — focus on deepening existing Japan relationship separately):
- Company name or type (be specific)
- Country and market
- Partnership type (distributor, OEM, private label, co-brand, agent)
- Why they are a priority for CNTP
- Approach strategy: who to contact, what to say first, what to offer
- Negotiation leverage points (what CNTP has that they need)
- Deal structure: pricing model, minimum volumes, exclusivity, contract length
- Relationship maintenance: check-in cadence, relationship development steps

## JAPAN RELATIONSHIP DEEPENING
Specific partnership expansion strategies for the existing Japan relationship:
- New product lines to introduce
- Volume growth opportunities
- New buyer contacts within Japan to develop
- Timeline and approach

## PARTNERSHIP PIPELINE TRACKER
Suggested stages (Prospect → Contacted → Sampling → Negotiating → Closed) and what moves a partner through each stage.

## 90-DAY PARTNERSHIP ACTION PLAN
Specific weekly actions for the next 90 days to initiate and advance 3 priority partnerships.`,
    }
    return map[type]
  },

  scoutMarkets: (filter: 'all' | 'emerging' | 'highmargin') => {
    const focus = {
      all: 'all viable global markets',
      emerging: 'frontier and emerging markets with low competition',
      highmargin: 'premium and high-margin markets',
    }[filter]
    return `Scout ${focus} for CNTP bulk rooibos exports. EXCLUDE Japan.
Return exactly 8 markets ranked by opportunity score (0–100).
Respond ONLY with a JSON array, no other text:
[{"country":"Germany","flag":"🇩🇪","region":"EUROPE · DACH","score":88,"reason":"Strong health food retail demand","tag":"RISING"},...]
Tags must be one of: HOT, RISING, FRONTIER, STABLE`
  },
}