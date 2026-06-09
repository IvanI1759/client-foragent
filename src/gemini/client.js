import { GoogleGenAI } from '@google/genai';
import { reserveGlobalApiCall } from '../db/queries.js';

const { GEMINI_API_KEY } = process.env;

if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in environment variables');
}

const COMPLEX_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const SIMPLE_MODEL = process.env.GEMINI_SIMPLE_MODEL || 'gemini-2.5-flash-lite';
const REQUEST_TIMEOUT = 60_000;
const SIMPLE_MAX_OUTPUT_TOKENS = 1200;
const COMPLEX_MAX_OUTPUT_TOKENS = 2200;
const DETAILED_MAX_OUTPUT_TOKENS = 3200;
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MAX_RETRIES = 2;
const MAX_INCOMPLETE_RESPONSE_RETRIES = 1;

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
- Добавляй 1-2 подходящих эмодзи в начале смысловых блоков, но не в каждую строку.
- Тон дружелюбный, живой и человеческий: без канцелярита, без сухого делового стиля.
- Не используй шаблонный заголовок "Коротко:". Просто сразу давай суть естественным языком.
- Не начинай каждый ответ с приветствия вроде "Привет", "Здравствуйте", "Добро пожаловать". Приветствие допустимо только если пользователь сам первым поздоровался или это самый первый ответ после команды /start.`;

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

function wantsDetailedAnswer(userMessage = '') {
  return /подроб|разверн|распиш|сделай план|по шагам|детально|с примерами/i.test(userMessage);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withGeminiRetry(task) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_STATUSES.has(error?.status) || attempt === MAX_RETRIES) {
        throw error;
      }
      await sleep(800 * (attempt + 1));
    }
  }

  throw lastError;
}

function getModelCandidates(complexity) {
  const primary = complexity === 'simple' ? SIMPLE_MODEL : COMPLEX_MODEL;
  const fallback = COMPLEX_MODEL;
  return Array.from(new Set([primary, fallback].filter(Boolean)));
}

function getFinishReason(response) {
  return (
    response?.candidates?.[0]?.finishReason ||
    response?.candidates?.[0]?.finish_reason ||
    response?.finishReason ||
    response?.finish_reason ||
    null
  );
}

function isIncompleteResponse(response) {
  const finishReason = getFinishReason(response);
  return finishReason && finishReason !== 'STOP';
}

async function generateContentWithCompletionRetry({
  model,
  contents,
  systemInstruction,
  maxOutputTokens,
  signal,
  tools,
}) {
  let response;

  for (let attempt = 0; attempt <= MAX_INCOMPLETE_RESPONSE_RETRIES; attempt++) {
    response = await withGeminiRetry(() => ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens,
        safetySettings: SAFETY_SETTINGS,
        ...(tools ? { tools } : {}),
      },
    }, { signal }));

    const finishReason = getFinishReason(response);
    console.log(`[GEMINI] model=${model} finishReason=${finishReason || 'UNKNOWN'} completion_attempt=${attempt + 1}`);

    if (!isIncompleteResponse(response) || attempt === MAX_INCOMPLETE_RESPONSE_RETRIES) {
      return response;
    }

    console.log(`[GEMINI] model=${model} incomplete_response finishReason=${finishReason} retry=1`);
  }

  return response;
}

export async function generateResponse({ userMessage, systemPrompt, ragContext, messageHistory = [], complexity = 'complex', maxOutputTokens: maxOutputTokensOverride, useSearch = false }) {
  const gate = await reserveGlobalApiCall();
  if (!gate.allowed) {
    throw new Error('GEMINI_GLOBAL_LIMIT');
  }

  const modelCandidates = getModelCandidates(complexity);
  let activeModel = modelCandidates[0];
  const defaultMaxOutputTokens = wantsDetailedAnswer(userMessage)
    ? DETAILED_MAX_OUTPUT_TOKENS
    : complexity === 'simple'
      ? SIMPLE_MAX_OUTPUT_TOKENS
      : COMPLEX_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = maxOutputTokensOverride ?? defaultMaxOutputTokens;
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

    let response;
    let lastError;

    const tools = useSearch ? [{ googleSearch: {} }] : undefined;

    for (const candidate of modelCandidates) {
      activeModel = candidate;
      try {
        response = await generateContentWithCompletionRetry({
          model: candidate,
          contents,
          systemInstruction: fullSystemPrompt,
          maxOutputTokens,
          signal: controller.signal,
          tools,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.status !== 429 || candidate === modelCandidates[modelCandidates.length - 1]) {
          throw error;
        }
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

    const rawText = response.text;
    if (!rawText) throw new Error('GEMINI_EMPTY_RESPONSE');
    const text = formatForTelegram(rawText);

    return { text, count: gate.count, warning: gate.warning };
  } catch (error) {
    console.error(`[GEMINI] model=${activeModel} status=${error.status} code=${error.code} name=${error.name} message=${error.message}`);
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
  const gate = await reserveGlobalApiCall();
  if (!gate.allowed) {
    throw new Error('GEMINI_GLOBAL_LIMIT');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await withGeminiRetry(() => ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
    }, { signal: controller.signal }));

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
