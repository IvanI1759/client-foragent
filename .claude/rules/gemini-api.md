---
description: Rules for Google Gemini API client — initialization, error handling, rate limiting, global counter
globs: src/gemini/**,src/agents/**
---

# Gemini API Rules

## Client Initialization (`client.js`)

```js
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const REQUEST_TIMEOUT = 30_000;

// Генерация текста:
const response = await ai.models.generateContent({
  model: MODEL,
  contents,
  config: {
    systemInstruction: systemPrompt,
    temperature: 0.7,
    maxOutputTokens: 2048,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  },
}, { signal: controller.signal });
// response.text — строка с ответом

// Embeddings:
const embResponse = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: text,
});
// embResponse.embeddings[0].values — float[]
```

- Модель ВСЕГДА из `process.env.GEMINI_MODEL`, default `gemini-3-flash-preview`
- Temperature: `0.7` для баланса креативности и точности
- `maxOutputTokens: 2048` — достаточно для Telegram-ответов
- API key только из `process.env.GEMINI_API_KEY`, никогда хардкод

## Error Handling

Каждый вызов `generateContent` и `embedContent` обёрнут в обработку:

```js
async function callGemini(userMessage, systemPrompt) {
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      config: { systemInstruction: systemPrompt, temperature: 0.7 },
    });
    return response.text;
  } catch (error) {
    if (error.status === 429) {
      // Rate limit от Google — подождать и не ретраить сразу
      throw new GeminiRateLimitError('Слишком много запросов, подождите минуту');
    }
    if (error.status === 500 || error.status === 503) {
      // Server error — можно ретраить 1 раз
      throw new GeminiServerError('Сервис временно недоступен');
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      throw new GeminiTimeoutError('Превышено время ожидания ответа');
    }
    throw error;
  }
}
```

### Сообщения пользователю при ошибках

| Ошибка | Сообщение |
|--------|----------|
| 429 | "Слишком много запросов. Подождите минуту и попробуйте снова." |
| 500/503 | "Сервис временно недоступен. Попробуйте через минуту." |
| Timeout | "Ответ занимает слишком много времени. Попробуйте короче сформулировать вопрос." |
| Global limit | "Сервис временно недоступен. Попробуйте завтра." |

Никогда не показывать: stack trace, error.message от Google, API key fragments.

## Global API Counter

Таблица `global_api_counter` (одна строка, id = 1):

```sql
CREATE TABLE global_api_counter (
  id integer PRIMARY KEY DEFAULT 1,
  daily_count integer DEFAULT 0,
  reset_date date DEFAULT CURRENT_DATE
);
```

### Логика перед каждым вызовом Gemini

> **Атомарность**: при высокой конкурентности (много запросов одновременно) используй
> Supabase RPC с `UPDATE ... SET daily_count = daily_count + 1 ... RETURNING daily_count`
> вместо SELECT → UPDATE, чтобы избежать race condition.

```js
async function checkAndIncrementCounter() {
  // 1. Получить текущий счётчик
  const { data } = await supabase
    .from('global_api_counter')
    .select('daily_count, reset_date')
    .eq('id', 1)
    .single();

  // 2. Если дата сменилась — сбросить счётчик
  const today = new Date().toISOString().split('T')[0];
  if (data.reset_date !== today) {
    await supabase
      .from('global_api_counter')
      .update({ daily_count: 1, reset_date: today })
      .eq('id', 1);
    return { allowed: true, count: 1 };
  }

  const newCount = data.daily_count + 1;

  // 3. Проверить лимиты
  const DAILY_LIMIT = parseInt(process.env.DAILY_API_LIMIT) || 250;
  const WARNING_THRESHOLD = Math.floor(DAILY_LIMIT * 0.8);

  if (newCount > DAILY_LIMIT) {
    return { allowed: false, count: data.daily_count };
  }

  // 4. Инкрементировать
  await supabase
    .from('global_api_counter')
    .update({ daily_count: newCount })
    .eq('id', 1);

  // 5. При 80% — уведомить владельца
  if (newCount >= WARNING_THRESHOLD && data.daily_count < WARNING_THRESHOLD) {
    return { allowed: true, count: newCount, warning: true };
  }

  return { allowed: true, count: newCount };
}
```

### Пороги

| Порог | Значение | Действие |
|-------|---------|----------|
| 80% (200/250) | `count >= 200` | Отправить владельцу: "Использовано {count}/250 запросов API за сегодня" |
| 100% (250/250) | `count >= 250` | Заглушка пользователям: "Сервис временно недоступен, попробуйте завтра" |
| Новый день | `reset_date !== today` | Сбросить `daily_count = 0`, обновить `reset_date` |

Уведомление владельцу через:
```js
await bot.telegram.sendMessage(
  process.env.OWNER_CHAT_ID,
  `Внимание: использовано ${count}/250 запросов Gemini API за сегодня.`
);
```

## Вызов из агентов

Каждый агент вызывает Gemini через единую функцию в `client.js`:

```js
// В агенте:
import { generateResponse } from '../gemini/client.js';

const answer = await generateResponse({
  userMessage,
  systemPrompt,       // промпт роли агента
  ragContext,          // результат retrieve.js (может быть пустым)
  messageHistory       // из сессии
});
```

- Не вызывать `model.generateContent` напрямую из агентов
- Вся логика счётчика, ошибок, форматирования — в `client.js`
- Агенты только формируют `systemPrompt` и передают параметры
