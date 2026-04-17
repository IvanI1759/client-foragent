import 'dotenv/config';
import { embedQuery } from '../src/rag/embed.js';
import { matchDocuments } from '../src/db/queries.js';
import { generateResponse } from '../src/gemini/client.js';

const SYSTEM_PROMPT = `Ты - упаковщик Telegram-каналов. Твоя задача - превращать канал в продающий актив.`;

try {
  console.log('1) Embedding query...');
  const emb = await embedQuery('как упаковать канал');
  console.log('   embed.length=', emb.length, 'first=', emb[0]);

  console.log('2) matchDocuments...');
  const rows = await matchDocuments(emb, 'packager', 0.55, 3);
  console.log('   rows=', rows.length);

  console.log('3) generateResponse...');
  const r = await generateResponse({
    userMessage: 'как упаковать канал',
    systemPrompt: SYSTEM_PROMPT,
    ragContext: rows.length ? rows.map(r=>r.content).join('\n') : null,
    messageHistory: [],
  });
  console.log('   answer:', r.text.slice(0, 100));
} catch (e) {
  console.error('ERROR.message:', e.message);
  console.error('ERROR.name:', e.name);
  console.error('ERROR.code:', e.code);
  console.error('ERROR.cause:', e.cause);
  console.error('STACK:', e.stack);
}
