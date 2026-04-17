import 'dotenv/config';
import { supabase } from '../src/db/supabase.js';
import { embedQuery } from '../src/rag/embed.js';

const query = process.argv.slice(2).join(' ') || 'расскажи о проекте';
const agent = process.env.RAG_DEBUG_AGENT || 'consultant';

console.log(`Query: "${query}"`);
console.log(`Agent: ${agent}\n`);

const { data: counts } = await supabase
  .from('documents')
  .select('agent_type, filename');
const byAgent = {};
for (const r of counts || []) {
  byAgent[r.agent_type] = (byAgent[r.agent_type] || 0) + 1;
}
console.log('Chunks in DB by agent:', byAgent);

const filenames = [...new Set((counts || []).map((r) => r.filename))];
console.log('Filenames:', filenames, '\n');

const embedding = await embedQuery(query);
console.log(`Query embedding dim: ${embedding.length} (first 3: ${embedding.slice(0, 3).map((n) => n.toFixed(4)).join(', ')})\n`);

const { data: rows, error } = await supabase.rpc('match_documents', {
  query_embedding: embedding,
  match_threshold: 0,
  match_count: 5,
  filter_agent_type: agent,
});

if (error) {
  console.error('RPC error:', error);
  process.exit(1);
}

console.log(`Top 5 matches for agent="${agent}" (threshold=0):`);
for (const [i, r] of (rows || []).entries()) {
  console.log(`  [${i + 1}] score=${r.score.toFixed(4)}  ${r.content.slice(0, 100).replace(/\s+/g, ' ')}...`);
}

process.exit(0);
