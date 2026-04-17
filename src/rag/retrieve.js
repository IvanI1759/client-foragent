import { embedQuery } from './embed.js';
import { matchDocuments } from '../db/queries.js';

const TOP_K = 3;
const MIN_SCORE = 0.55;

export async function retrieveContext(query, agentType) {
  const embedding = await embedQuery(query);
  const rows = await matchDocuments(embedding, agentType, MIN_SCORE, TOP_K);

  if (!rows || rows.length === 0) {
    return { context: '', chunks: [], scores: [], noContext: true };
  }

  const chunks = rows.map((r) => r.content);
  const scores = rows.map((r) => r.score);
  const context = chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n');

  return { context, chunks, scores, noContext: false };
}
