// intelligence.ts
// ✅ FIXED: Added error handling, timeouts, and graceful fallback for ChromaDB being offline.
// Previously: if ChromaDB was down, the entire function threw an uncaught error that
// crashed the API route. Now: ChromaDB is treated as "optional enrichment" — if it's
// offline, we proceed with just Ollama (still useful, never broken).

const CHROMA_BASE = 'http://localhost:8000';
const OLLAMA_BASE = 'http://localhost:11434';

// ✅ FIX: Replace the hardcoded '...' collection ID with an env var.
// Set CHROMA_COLLECTION_ID in your .env.local file.
// If not set, ChromaDB lookup is skipped gracefully.
const COLLECTION_ID = process.env.CHROMA_COLLECTION_ID ?? '';

interface ChromaResult {
  documents?: string[][];
  metadatas?: object[][];
}

/**
 * Step A: Query ChromaDB for relevant stored facts.
 * Returns empty array if ChromaDB is offline, misconfigured, or has no collection set.
 * This prevents ChromaDB downtime from taking down the entire intelligence pipeline.
 */
async function queryMemory(query: string): Promise<string[]> {
  // ✅ FIX: Skip silently if no collection ID is configured
  if (!COLLECTION_ID) {
    console.warn('[CNTP-OPS] CHROMA_COLLECTION_ID not set — skipping memory lookup.');
    return [];
  }

  try {
    const controller = new AbortController();
    // ✅ FIX: 5s timeout on ChromaDB — fast local service, shouldn't need more
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `${CHROMA_BASE}/api/v1/collections/${COLLECTION_ID}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_texts: [query], n_results: 3 }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[CNTP-OPS] ChromaDB returned ${res.status} — proceeding without memory.`);
      return [];
    }

    const data: ChromaResult = await res.json();
    // Flatten the nested documents array ChromaDB returns
    return data.documents?.flat().filter(Boolean) ?? [];

  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[CNTP-OPS] ChromaDB timeout — proceeding without memory.');
    } else {
      console.warn('[CNTP-OPS] ChromaDB offline or error:', err.message);
    }
    return [];
  }
}

/**
 * Main exported function.
 * Used by any component or route that needs the full RAG pipeline (Memory + Brain).
 * 
 * Note: The /api/research route calls Ollama directly for speed (bypassing ChromaDB).
 * Use this function when you need context-enriched answers (e.g., Innovation Vault queries).
 */
export async function askRooibosAgent(query: string): Promise<{ response: string }> {
  // Step A: Try to get relevant facts from memory
  const memoryDocs = await queryMemory(query);

  const contextBlock = memoryDocs.length > 0
    ? `Relevant facts from the CNTP knowledge base:\n${memoryDocs.join('\n---\n')}\n\n`
    : ''; // No context = no hallucinated context block

  // Step B: Send to Ollama with optional context
  try {
    const controller = new AbortController();
    // ✅ FIX: was no timeout at all — could hang forever
    const timeoutId = setTimeout(() => controller.abort(), 75000);

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3',
        prompt: `[INST] You are the CNTP-OPS Research Director.
${contextBlock}Question: ${query}

Respond in 3 concise, professional paragraphs focused on Rooibos manufacturing and Rosehip market dynamics. [/INST]`,
        stream: false,
        options: {
          num_predict: 400,
          temperature: 0.4,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json();
    return { response: data.response ?? 'No response generated.' };

  } catch (err: any) {
    const message = err.name === 'AbortError'
      ? 'BRAIN TIMEOUT: Ollama took too long. Try a shorter query or switch to phi3.'
      : `BRAIN ERROR: ${err.message}`;
    return { response: message };
  }
}