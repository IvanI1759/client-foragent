import { embedQuery } from './embed.js';
import { matchDocuments } from '../db/queries.js';

const TOP_K = 2;
const MIN_SCORE = 0.55;
const SHARED_AGENT_TYPE = 'all';
const CONSULTANT_AGENT_TYPE = 'consultant';

function uniqueAgentTypes(agentTypes) {
  return Array.from(new Set(agentTypes.filter(Boolean)));
}

function mergeTopRows(rows, limit) {
  const seen = new Set();

  return rows
    .filter((row) => {
      const key = row.id || row.content;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function matchForAgentTypes(embedding, agentTypes) {
  const types = uniqueAgentTypes(agentTypes);
  const results = await Promise.all(
    types.map(async (type) => ({
      type,
      rows: await matchDocuments(embedding, type, MIN_SCORE, TOP_K),
    }))
  );

  return {
    results,
    rows: mergeTopRows(results.flatMap((result) => result.rows), TOP_K),
  };
}

export async function retrieveContext(query, agentType) {
  console.log(
    `[RAG] retrieve_start agent=${agentType} query_length=${query?.length ?? 0} top_k=${TOP_K} min_score=${MIN_SCORE}`
  );

  let embedding;
  try {
    embedding = await embedQuery(query);
  } catch (error) {
    console.log(`[RAG] embed_failed agent=${agentType} error=${error?.message}`);
    if (
      error?.message === 'GEMINI_RATE_LIMIT' ||
      error?.message === 'GEMINI_SERVER_ERROR' ||
      error?.message === 'GEMINI_TIMEOUT'
    ) {
      return { context: '', chunks: [], scores: [], noContext: true };
    }
    throw error;
  }

  const primaryMatch = await matchForAgentTypes(embedding, [agentType, SHARED_AGENT_TYPE]);
  for (const result of primaryMatch.results) {
    console.log(
      `[RAG] match_source requested_agent=${agentType} source=${result.type} rows=${result.rows?.length ?? 0} ` +
      `scores=${(result.rows || []).map((r) => Number(r.score).toFixed(3)).join(',') || 'none'}`
    );
  }

  let rows = primaryMatch.rows;

  if (rows.length < TOP_K && agentType !== CONSULTANT_AGENT_TYPE) {
    const consultantRows = await matchDocuments(embedding, CONSULTANT_AGENT_TYPE, MIN_SCORE, TOP_K);
    console.log(
      `[RAG] match_source requested_agent=${agentType} source=${CONSULTANT_AGENT_TYPE} fallback=true rows=${consultantRows?.length ?? 0} ` +
      `scores=${(consultantRows || []).map((r) => Number(r.score).toFixed(3)).join(',') || 'none'}`
    );
    rows = mergeTopRows([...rows, ...consultantRows], TOP_K);
  }

  console.log(
    `[RAG] match_result agent=${agentType} rows=${rows?.length ?? 0} ` +
    `scores=${(rows || []).map((r) => Number(r.score).toFixed(3)).join(',') || 'none'}`
  );

  if (!rows || rows.length === 0) {
    console.log(`[RAG] no_context agent=${agentType} min_score=${MIN_SCORE} top_k=${TOP_K}`);
    return { context: '', chunks: [], scores: [], noContext: true };
  }

  const chunks = rows.map((r) => r.content);
  const scores = rows.map((r) => r.score);
  const context = chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n');
  console.log(`[RAG] context_ready agent=${agentType} chunks=${chunks.length} context_length=${context.length}`);

  return { context, chunks, scores, noContext: false };
}
