import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const text = 'что это за проект';

async function emb(taskType) {
  const r = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { outputDimensionality: 768, ...(taskType ? { taskType } : {}) },
  });
  return r.embeddings[0].values;
}

const a = await emb(null);
const b = await emb('RETRIEVAL_QUERY');
const c = await emb('RETRIEVAL_DOCUMENT');

console.log('No taskType    first5:', a.slice(0, 5).map((n) => n.toFixed(5)));
console.log('RETRIEVAL_QUERY first5:', b.slice(0, 5).map((n) => n.toFixed(5)));
console.log('RETRIEVAL_DOC   first5:', c.slice(0, 5).map((n) => n.toFixed(5)));

const same = (x, y) => x.every((v, i) => v === y[i]);
console.log('\nNo == QUERY?', same(a, b));
console.log('No == DOC?  ', same(a, c));
console.log('QUERY == DOC?', same(b, c));
