// lib/internal-sales-intelligence.ts
// Alara Intelligence Engine — server-side prompt builders and response types.
// This module extends lib/intelligence/gemini.ts with vault-aware intelligence actions.
// Never imported from client components — server-side only.

export { queryGemini, PROMPTS } from '@/lib/intelligence/gemini'

// ─── Extended action types ─────────────────────────────────────────────────

export type ExtendedSalesAction =
  | 'briefing' | 'risk' | 'market_entry'
  | 'competitor_scan' | 'competitor_gaps' | 'competitor_advantages'
  | 'partnerships' | 'objections' | 'contacts'
  | 'agent' | 'file_analysis' | 'report' | 'scout' | 'alerts'
  | 'company_profile' | 'pitch_builder' | 'expansion_briefing'
  | 'contradiction_check' | 'cultural_scout' | 'audience_signals'

// ─── Extended prompt builders ─────────────────────────────────────────────

export const EXTENDED_PROMPTS = {

  companyProfile: (companyName: string, vaultContext: string) =>
    `Generate a complete company dossier for: ${companyName}

${vaultContext ? `INTERNAL CONTEXT (from vault):\n${vaultContext}\n\n` : ''}
## COMPANY PROFILE
- Company type, size, and market focus
- Sustainability stance and certifications they value
- Buyer/decision-maker title and department
- LinkedIn search string to find the right contact

## PRODUCT GAPS
- What they currently sell vs what they are likely missing
- Where rooibos, rosehip, or honeybush would fit their range

## APPROACH STRATEGY
- Best opening line tailored to their values and product mix
- What to offer first (product format, min order, price tier)
- Cultural communication style for this company's home market

## PANJIVA / TRADE DATA SIGNALS
- Any known import patterns or supplier relationships (if publicly available)
- Markets they serve that overlap with our expansion targets

## RECOMMENDED NEXT STEP
- Single most important action to take with this company this week

Be specific. Name the actual company throughout. Use bullet points.`,

  pitchBuilder: (
    targetMarket: string,
    buyerType: string,
    productFormat: string,
    culturalContext: string,
    vaultContext: string,
  ) =>
    `Build a complete personalised sales pitch for:
Target market: ${targetMarket}
Buyer type: ${buyerType}
Product format: ${productFormat}
Cultural context: ${culturalContext}

${vaultContext ? `INTERNAL VAULT CONTEXT (pricing, past interactions, relevant docs):\n${vaultContext}\n\n` : ''}
## SUBJECT LINE
(For email outreach — compelling, under 60 chars)

## OPENING (2 sentences)
Hook tailored to this buyer's world. Reference something real about their market.

## VALUE PROPOSITION (3 bullet points)
Specific to this buyer type and cultural context. Not generic.

## PRODUCT OFFER
- Specific product format and grade
- Suggested minimum order (calibrated to buyer size)
- Pricing tier framing (not exact numbers — frame as competitive, premium, or value)
- Lead time and logistics note

## CULTURAL NOTES
- Communication style for this market (formal/informal, relationship/transactional)
- What to emphasise vs de-emphasise based on cultural context
- Relevant certifications or claims that matter in this market (halal, kosher, organic, fair trade)

## CALL TO ACTION
Specific next step — sample request, video call, trade show meeting

## FOLLOW-UP SEQUENCE
3-step follow-up plan if no response within 5 days

Keep the pitch tight, confident, and culturally intelligent.`,

  expansionBriefing: (vector: string) => {
    const vectorDescriptions: Record<string, string> = {
      red_espresso:    'Red espresso and specialty coffee bar applications',
      k_beauty:        'K-beauty and J-beauty cosmetic ingredient (aspalathin, rooibos extract)',
      clinical:        'Clinical nutrition, hospital channel, caffeine-free medical dietary products',
      functional_oem:  'Functional beverage OEM — manufacturers seeking a South African hero ingredient',
      bubble_tea:      'Bubble tea and café-culture ingredient applications',
      rtd:             'Ready-to-drink (RTD) product format opportunities',
      adaptogens:      'Adaptogen blends (rooibos + ashwagandha, rooibos + reishi)',
    }
    const desc = vectorDescriptions[vector] ?? vector

    return `Generate an expansion briefing for this specific rooibos industry growth vector:
VECTOR: ${desc}

## CURRENT STATE
Where is this channel/application right now globally? Size, growth rate, key players.

## ROOIBOS OPPORTUNITY
Why does rooibos fit this vector specifically? What properties make it compelling?

## TOP 5 COMPANIES TO TARGET
Real company names, their role in this channel, and why they would buy rooibos.

## CERTIFICATIONS / CLAIMS NEEDED
What does the company need to sell into this channel? (e.g. COSMOS organic for K-beauty, HACCP for clinical)

## ENTRY STRATEGY
First 3 steps. Specific actions with timelines.

## RECOMMENDED PITCH ANGLE
How to frame rooibos for this buyer type — what to lead with, what to avoid.

## MARKET SIZE SIGNAL
Best estimate of addressable market in this vector for a bulk rooibos supplier.`
  },

  contradictionCheck: (market: string, vaultContext: string, signalContext: string) =>
    `Check for contradictions between internal vault data and live market intelligence for: ${market}

VAULT DATA (internal documents):
${vaultContext || 'No vault data available for this market.'}

LIVE SIGNALS (recent market intelligence):
${signalContext || 'No recent signals available for this market.'}

## CONTRADICTION ANALYSIS
Identify any conflicts between the two data sources:
- Pricing discrepancies (vault pricing vs current market signals)
- Demand direction conflicts (vault says growing, signals say declining, or vice versa)
- Competitor status changes (vault says X is a threat, but signals show X has left the market)
- Regulatory conflicts (vault has old compliance info, signals show new requirements)

For each conflict: describe the discrepancy, assess which source is more likely current, and recommend how to resolve it.

If no contradictions: confirm data consistency and note the most recent signal date.`,

  culturalScout: (country: string) =>
    `Generate a cultural intelligence brief for selling to buyers in: ${country}

## BUYER COMMUNICATION STYLE
- Formal vs informal: how to address a buyer for the first time
- Relationship vs transactional: how many touchpoints before they buy
- Direct vs indirect: how they give feedback and say no
- Email vs in-person vs LinkedIn: preferred contact channel

## KEY CULTURAL NOTES FOR PITCHING
- What they value most in a supplier relationship
- What signals trust and credibility in this culture
- What to avoid saying or doing in a first meeting

## CERTIFICATIONS THAT MATTER HERE
- Required: what you cannot sell without
- Advantageous: what gives you an edge over competitors
- Halal/Kosher/Organic/Vegan: which labels carry weight in this market

## TRADE EVENTS
- Top 2–3 trade shows or buyer events in this market relevant to herbal ingredients/beverages
- When they occur and who attends

## PRICING EXPECTATION
- Premium, mid-market, or value market? What price sensitivity looks like here.
- How buyers negotiate and what they expect in terms of samples

## APPROACH STRATEGY
- Best first contact method and message
- What to put in the subject line of a first email to a ${country} buyer`,

  audienceSignals: (audienceTag: string, recentSignals: string) =>
    `Analyse market signals specifically for the audience segment: ${audienceTag}

RECENT SIGNALS TAGGED FOR THIS AUDIENCE:
${recentSignals || 'No recent signals for this audience tag.'}

## TREND SUMMARY
What is this audience segment doing with herbal tea and botanical ingredients right now?
What formats, claims, and channels are they responding to?

## PRODUCT ANGLES FOR THIS AUDIENCE
What specific rooibos or rosehip product formats and claims resonate with ${audienceTag} consumers?
- Formats: loose leaf, RTD, concentrate, cosmetic extract, capsule, functional blend
- Claims: antioxidant, caffeine-free, adaptogen, anti-inflammatory, skin-brightening, etc.

## PITCH LANGUAGE
How to describe rooibos to a ${audienceTag} audience — specific words and phrases that land.
What to emphasise: origin story, certifications, functional benefits, cultural connection.

## TOP DISTRIBUTION CHANNELS FOR THIS AUDIENCE
Where does ${audienceTag} buy wellness/herbal products? (Online, specialty retail, pharmacy, subscription)

## RECOMMENDED NEXT ACTION
One specific step to reach this audience segment this month.`,

  // ── Gap Finder ─────────────────────────────────────────────────────────────
  gapFinder: (market: string, product: string, vaultCtx: string, signalCtx: string) =>
    `You are a market intelligence analyst for a South African rooibos and herbal tea bulk exporter (CNTP).

TASK: Map the intermediary/distributor landscape for "${product}" in "${market}" and identify structural gaps CNTP can exploit.

${vaultCtx ? `INTERNAL VAULT DATA:\n${vaultCtx}\n\n` : ''}${signalCtx ? `RECENT MARKET SIGNALS:\n${signalCtx}\n\n` : ''}
## WHO IS IN THIS SPACE RIGHT NOW
Name the actual distributors, middlemen, and suppliers currently serving "${product}" buyers in "${market}".
For each: company name, approximate market position, what they supply, who they supply to.

## WHAT THEY CANNOT DO
For each intermediary: specific structural limitations.
- Volume ceiling (can't scale beyond X kg/month)
- Certification gaps (no halal, no organic, no appellation protection)
- Origin limitations (blended, not single-origin; can't verify provenance)
- Format gaps (only loose leaf, no extracts; only bulk, no private label)
- Service gaps (no custom blends, no small MOQ, long lead times)
- Brand credibility gaps (generic, no story, no sustainability claims)

## WHAT CNTP CAN DO THAT THEY CANNOT
Specific advantages that directly address those gaps.
Be concrete — not "we have better quality" but "we hold the only EU-certified appellation-protected rooibos at scale".

## THE LOOPHOLE
The single clearest market entry angle: a specific buyer type, need, and reason why the current middleman cannot serve it.
One paragraph. Actionable.

## FIRST MOVE
The exact first step — who to contact, what to say, what to offer.`,

  // ── Variance Finder ────────────────────────────────────────────────────────
  varianceFinder: (market: string, vaultCtx: string) =>
    `You are a product innovation analyst for a South African rooibos and herbal tea exporter.

TASK: Identify whitespace in the "${market}" market — product formats, positions, or claims that do NOT yet exist but would fit.

${vaultCtx ? `INTERNAL VAULT DATA:\n${vaultCtx}\n\n` : ''}
## CURRENT MARKET LANDSCAPE
What rooibos and herbal tea products currently exist in "${market}"?
What formats, price tiers, and claims are already saturated?

## THE GAPS (what doesn't exist yet)
5–8 specific product/format/positioning gaps. For each:
- What is missing
- Why it is missing (regulatory, supply chain, no one has tried, market not ready)
- Why rooibos fits this gap
- Which buyer type would want it
- Rough market readiness (ready now / 1–2 years / emerging)

## HIGHEST PRIORITY VARIANCE
The single strongest opportunity: specific format, specific claim, specific buyer, specific reason CNTP is positioned to fill it.

## NEW PRODUCT ANGLES TO EXPLORE
Adjacent categories, crossover products, or innovations that aren't on the radar yet:
(e.g. rooibos kombucha base, red espresso in K-beauty cafés, rooibos + ashwagandha OEM blend)

## RECOMMENDED PITCH TO A BUYER IN THIS SPACE
One paragraph — how you introduce this variance concept to a category buyer.`,

  // ── Source Analysis ────────────────────────────────────────────────────────
  sourceAnalysis: (sourceTitle: string, sourceDomain: string, sourceText: string, question: string) =>
    `You are analysing a specific source on behalf of a South African rooibos exporter (CNTP).

SOURCE: "${sourceTitle}" (${sourceDomain})
---
${sourceText}
---

QUESTION: ${question}

Answer the question specifically from the content of this source.
- Quote or reference specific claims from the source where relevant.
- Identify what the source reveals about: market trends, competitor activity, buyer behaviour, regulatory changes, or pricing.
- Note any gaps, contradictions, or implications the source doesn't explicitly state but strongly implies.
- End with: one concrete action CNTP should take based on this source.

Keep your answer focused and under 350 words.`,

  // ── Loophole Scan ──────────────────────────────────────────────────────────
  loopholeScan: (signalCtx: string, vaultCtx: string) =>
    `You are a competitive intelligence analyst. Your job is to find exploitable gaps and windows of opportunity in the rooibos and herbal tea export market.

RECENT MARKET SIGNALS:
${signalCtx || 'No recent signals available.'}

${vaultCtx ? `INTERNAL VAULT DATA:\n${vaultCtx}\n\n` : ''}
## COMPETITOR WEAKNESSES IN THE NEWS
Any signals of: quality complaints, supply disruptions, price instability, brand credibility issues, or market exits among rooibos/herbal tea competitors.
For each: what the weakness is, who is affected, and how CNTP can use it.

## SUPPLY CHAIN GAPS
Any disruptions, shortages, or volatility in competing origins (China, Argentina, Sri Lanka for herbal teas).
How does this create a window for SA-origin rooibos?

## REGULATORY OPENINGS
New standards, certification requirements, or novel food approvals that competitors aren't yet meeting — but CNTP could.

## DEMAND SIGNALS WITHOUT A SUPPLIER
Buyers or markets publicly looking for something no current supplier is offering well.

## TIME-SENSITIVE WINDOWS
Any of the above that are time-limited — a window that will close within 3–6 months.
Prioritise these.

## TOP 3 LOOPHOLES RIGHT NOW
The three most actionable gaps, ranked by urgency and CNTP's ability to move on them.
For each: the gap, the window, the move.`,
}
