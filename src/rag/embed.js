import { GoogleGenAI } from '@google/genai';
import { reserveGlobalApiCall } from '../db/queries.js';

const { GEMINI_API_KEY } = process.env;
if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in environment variables');
}

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const BATCH_SIZE = 10;
const REQUEST_TIMEOUT = 30_000;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function embedBatch(texts, taskType) {
  const gate = await reserveGlobalApiCall();
  if (!gate.allowed) {
    throw new Error('GEMINI_GLOBAL_LIMIT');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: texts,
      config: { outputDimensionality: EMBED_DIM, taskType },
    }, { signal: controller.signal });

    return response.embeddings.map((e) => e.values);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('GEMINI_TIMEOUT');
    if (error.status === 429) throw new Error('GEMINI_RATE_LIMIT');
    if (error.status === 500 || error.status === 503) throw new Error('GEMINI_SERVER_ERROR');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedChunks(chunks) {
  const vectors = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatch(batch, 'RETRIEVAL_DOCUMENT');
    vectors.push(...embeddings);
  }
  return vectors;
}

export async function embedQuery(text) {
  const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY');
  return vector;
}
