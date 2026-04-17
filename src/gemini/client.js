import { GoogleGenAI } from '@google/genai';
import { checkGlobalCounter, incrementGlobalCounter } from '../db/queries.js';

const { GEMINI_API_KEY } = process.env;

if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in environment variables');
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const REQUEST_TIMEOUT = 30_000;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

const FORMATTING_INSTRUCTIONS = `

Оформление ответа:
- Не используй markdown-разметку: ни **жирного**, ни *курсива*, ни заголовков с #.
- Используй обычный дефис "-" вместо длинного тире "—" или среднего "–".
- Для списков используй дефис с пробелом: "- пункт".
- Добавляй 1-2 подходящих эмодзи в начале смысловых блоков (вступление, список, итог), но не переусердствуй и не ставь эмодзи в каждую строку.`;

function formatForTelegram(text) {
  if (!text) return text;
  return text
    .replace(/\*\*/g, '')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[—–]/g, '-')
    .replace(/-{2,}/g, '-');
}

export async function generateResponse({ userMessage, systemPrompt, ragContext, messageHistory = [] }) {
  const gate = await checkGlobalCounter();
  if (!gate.allowed) {
    throw new Error('GEMINI_GLOBAL_LIMIT');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const contents = [];

    for (const msg of messageHistory) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    let fullSystemPrompt = systemPrompt;
    if (ragContext) {
      fullSystemPrompt += `\n\nКонтекст из базы знаний:\n${ragContext}`;
    }
    fullSystemPrompt += FORMATTING_INSTRUCTIONS;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: fullSystemPrompt,
        temperature: 0.7,
        maxOutputTokens: 2048,
        safetySettings: SAFETY_SETTINGS,
      },
    }, { signal: controller.signal });

    const rawText = response.text;
    if (!rawText) throw new Error('GEMINI_EMPTY_RESPONSE');
    const text = formatForTelegram(rawText);

    const count = await incrementGlobalCounter().catch(() => null);
    const limit = parseInt(process.env.DAILY_API_LIMIT, 10) || 250;
    const warning = count !== null && count >= Math.floor(limit * 0.8);
    return { text, count, warning };
  } catch (error) {
    console.error(`[GEMINI] model=${MODEL} status=${error.status} code=${error.code} name=${error.name} message=${error.message}`);
    if (error.name === 'AbortError') {
      throw new Error('GEMINI_TIMEOUT');
    }
    if (error.status === 429) {
      throw new Error('GEMINI_RATE_LIMIT');
    }
    if (error.status === 500 || error.status === 503) {
      throw new Error('GEMINI_SERVER_ERROR');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedText(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
    }, { signal: controller.signal });

    return response.embeddings[0].values;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('GEMINI_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
