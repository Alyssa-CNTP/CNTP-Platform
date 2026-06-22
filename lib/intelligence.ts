// lib/intelligence.ts
// RAG pipeline: ChromaDB signals + ChromaDB vault + Ollama brain.
// ChromaDB is optional enrichment — if offline, continues gracefully.

const CHROMA_BASE    = 'http://localhost:8000'
const OLLAMA_BASE    = 'http://localhost:11434'

const COLLECTION_ID       = process.env.CHROMA_COLLECTION_ID       ?? ''
const VAULT_COLLECTION_ID = process.env.CHROMA_VAULT_COLLECTION_ID ?? ''

interface ChromaResult {
  documents?: string[][]
  metadatas?: Record<string, string>[][]
}

// ─── Query helpers ────────────────────────────────────────────────────────────

async function queryChromaCollection(
  collectionId: string,
  query: string,
  nResults = 5,
): Promise<{ docs: string[]; metadatas: Record<string, string>[] }> {
  if (!collectionId) return { docs: [], metadatas: [] }

  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(
      `${CHROMA_BASE}/api/v1/collections/${collectionId}/query`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query_texts: [query], n_results: nResults }),
        signal:  controller.signal,
      }
    )

    clearTimeout(timeoutId)

    if (!res.ok) {
      console.warn(`[intelligence] ChromaDB ${collectionId} returned ${res.status}`)
      return { docs: [], metadatas: [] }
    }

    const data: ChromaResult = await res.json()
    return {
      docs:      data.documents?.flat().filter(Boolean) ?? [],
      metadatas: data.metadatas?.flat() ?? [],
    }

  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.warn('[intelligence] ChromaDB offline or error:', err.message)
    }
    return { docs: [], metadatas: [] }
  }
}

async function queryMemory(query: string): Promise<string[]> {
  const { docs } = await queryChromaCollection(COLLECTION_ID, query, 3)
  return docs
}

async function queryVault(query: string): Promise<{ text: string; docType: string }[]> {
  if (!VAULT_COLLECTION_ID) return []
  const { docs, metadatas } = await queryChromaCollection(VAULT_COLLECTION_ID, query, 5)
  return docs.map((text, i) => ({
    text,
    docType: metadatas[i]?.doc_type ?? 'unknown',
  }))
}

// ─── Contradiction detection ──────────────────────────────────────────────────
// Simple heuristic: look for opposing numeric signals across web and vault.
// e.g. web signal says "demand up 20%" but vault doc says "demand down 15%"

function detectContradictions(signalDocs: string[], vaultDocs: { text: string; docType: string }[]): string[] {
  if (!signalDocs.length || !vaultDocs.length) return []

  const contradictions: string[] = []
  const numericRx = /(\d+(?:\.\d+)?)\s*%/g

  const signalNums  = signalDocs.join(' ').match(numericRx) ?? []
  const vaultNums   = vaultDocs.map(d => d.text).join(' ').match(numericRx) ?? []

  const upSignals   = signalDocs.join(' ').match(/\b(up|increas|grow|rise|surge)\w*\s+\d+\s*%/gi) ?? []
  const downSignals = signalDocs.join(' ').match(/\b(down|declin|drop|fall|decreas)\w*\s+\d+\s*%/gi) ?? []
  const upVault     = vaultDocs.map(d => d.text).join(' ').match(/\b(up|increas|grow|rise|surge)\w*\s+\d+\s*%/gi) ?? []
  const downVault   = vaultDocs.map(d => d.text).join(' ').match(/\b(down|declin|drop|fall|decreas)\w*\s+\d+\s*%/gi) ?? []

  if (upSignals.length > 0 && downVault.length > 0) {
    contradictions.push(
      `Live signals suggest positive movement (${upSignals[0]}) but vault documents show negative trend (${downVault[0]}). Verify with current data.`
    )
  }
  if (downSignals.length > 0 && upVault.length > 0) {
    contradictions.push(
      `Live signals show negative movement (${downSignals[0]}) but vault documents indicate positive trend (${upVault[0]}). Intelligence may be stale.`
    )
  }

  return contradictions
}

// ─── Main exported functions ──────────────────────────────────────────────────

export async function askRooibosAgent(query: string): Promise<{ response: string }> {
  const memoryDocs = await queryMemory(query)

  const contextBlock = memoryDocs.length > 0
    ? `Relevant facts from the knowledge base:\n${memoryDocs.join('\n---\n')}\n\n`
    : ''

  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 75000)

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  'phi3',
        prompt: `[INST] You are the Meridian Intelligence Director — expert in rooibos, rosehip, and herbal botanical exports from South Africa.
${contextBlock}Question: ${query}

Respond in 3 concise, professional paragraphs focused on rooibos manufacturing and herbal export market dynamics. [/INST]`,
        stream:  false,
        options: { num_predict: 400, temperature: 0.4 },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = await res.json()
    return { response: data.response ?? 'No response generated.' }

  } catch (err: any) {
    const message = err.name === 'AbortError'
      ? 'BRAIN TIMEOUT: Ollama took too long. Try a shorter query or switch to phi3.'
      : `BRAIN ERROR: ${err.message}`
    return { response: message }
  }
}

export async function askRooibosAgentWithVault(query: string): Promise<{
  response:     string
  vaultSources: string[]
  contradictions: string[]
}> {
  const [signalDocs, vaultResults] = await Promise.all([
    queryMemory(query),
    queryVault(query),
  ])

  const contradictions = detectContradictions(signalDocs, vaultResults)

  const signalBlock = signalDocs.length > 0
    ? `Live market signals:\n${signalDocs.join('\n---\n')}\n\n`
    : ''

  const vaultBlock = vaultResults.length > 0
    ? `Internal knowledge base (${vaultResults.map(v => v.docType).join(', ')}):\n${vaultResults.map(v => v.text).join('\n---\n')}\n\n`
    : ''

  const contradictionBlock = contradictions.length > 0
    ? `⚠️ DATA CONFLICTS DETECTED:\n${contradictions.join('\n')}\n\n`
    : ''

  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 75000)

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  'phi3',
        prompt: `[INST] You are the Meridian Intelligence Director. Answer using both internal vault knowledge and live market intelligence.
${signalBlock}${vaultBlock}${contradictionBlock}Question: ${query}

Synthesise internal and external sources. Flag any conflicts. Be specific and prescriptive. [/INST]`,
        stream:  false,
        options: { num_predict: 600, temperature: 0.4 },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = await res.json()
    return {
      response:       data.response ?? 'No response generated.',
      vaultSources:   vaultResults.map(v => v.docType),
      contradictions,
    }

  } catch (err: any) {
    return {
      response:       `BRAIN ERROR: ${err.message}`,
      vaultSources:   [],
      contradictions: [],
    }
  }
}
