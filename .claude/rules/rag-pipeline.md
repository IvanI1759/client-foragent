---
description: Rules for RAG pipeline — document ingestion, chunking, embedding, and retrieval
globs: src/rag/**,src/db/**
---

# RAG Pipeline Rules

## Chunking (`ingest.js`)

| Параметр | Значение |
|----------|---------|
| Chunk size | 500 токенов |
| Overlap | 50 токенов |
| Разделитель | По абзацам → по предложениям → по размеру |

```js
// Алгоритм:
// 1. Разбить текст по абзацам (\n\n)
// 2. Если абзац > 500 токенов — разбить по предложениям
// 3. Если предложение > 500 токенов — разбить по размеру
// 4. Объединять короткие фрагменты до ~500 токенов
// 5. Каждый чанк перекрывается с предыдущим на 50 токенов
```

Приблизительная оценка токенов: `text.length / 4` (для русского текста).

## Embedding (`embed.js`)

| Параметр | Значение |
|----------|---------|
| Модель | `gemini-embedding-001` |
| Размерность | 768 |
| Batch size | до 100 строк за запрос (SDK поддерживает массив) |

```js
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Один текст:
const response = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: text,
});
// response.embeddings[0].values → float[768]

// Batch (массив строк):
const response = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: ['chunk1', 'chunk2', 'chunk3'],
});
// response.embeddings → array of { values: float[768] }
```

- Батчить чанки по 10 для снижения количества API-вызовов
- Каждый embedding вызов инкрементирует `global_api_counter`

## Retrieval (`retrieve.js`)

| Параметр | Значение |
|----------|---------|
| Top-K | 3 |
| Min score | 0.7 |
| Фильтр | `agent_type` |

```sql
SELECT content, 1 - (embedding <=> $1) AS score
FROM documents
WHERE agent_type = $2
  AND 1 - (embedding <=> $1) >= 0.7
ORDER BY embedding <=> $1
LIMIT 3;
```

- Всегда фильтровать по `agent_type` — каждый агент ищет только в своей базе
- Если 0 результатов с score >= 0.7 — агент отвечает без RAG-контекста и сообщает об этом
- Контекст передаётся в промпт как нумерованный список:

```
Контекст из базы знаний:
[1] {chunk_1}
[2] {chunk_2}
[3] {chunk_3}
```

## File Upload и Re-Upload

### Валидация файла

```js
import { fileTypeFromBuffer } from 'file-type';

// Допустимые MIME-типы
const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain'
];

// Проверка:
// 1. Размер файла <= 10MB
// 2. MIME-тип через file-type (magic bytes), НЕ по расширению
// 3. Если MIME не в списке → отклонить с сообщением
// 4. Sanitize filename: заменить небезопасные символы, ограничить длину
//    const safeName = filename.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_').slice(0, 100);
```

### Re-Upload (КРИТИЧНО)

При загрузке файла с `filename`, который уже есть в `documents`:

```js
// ШАГ 1: Удалить старые чанки
await supabase
  .from('documents')
  .delete()
  .eq('filename', filename);

// ШАГ 2: Инжестировать новые чанки
await ingestDocument(fileBuffer, filename, agentType);
```

**Порядок обязателен**: сначала DELETE, потом INSERT. Не наоборот, не параллельно.

## Парсинг документов

```js
// PDF
import pdf from 'pdf-parse';
const data = await pdf(buffer);
const text = data.text;

// DOCX
import mammoth from 'mammoth';
const result = await mammoth.extractRawText({ buffer });
const text = result.value;

// TXT
const text = buffer.toString('utf-8');
```

- Временные файлы: скачать через Telegram API → обработать в памяти → не сохранять на диск
- Если парсинг упал — вернуть пользователю понятную ошибку, не stack trace

## Supabase Queries (`queries.js`)

Все запросы к `documents` — через Supabase JS client или `rpc()` для pgvector:

```js
// Для vector search использовать rpc
const { data } = await supabase.rpc('match_documents', {
  query_embedding: embedding,
  match_threshold: 0.7,
  match_count: 3,
  filter_agent_type: agentType
});
```

SQL-функция `match_documents` создаётся в Supabase:

```sql
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_agent_type text
) RETURNS TABLE (id uuid, content text, score float) AS $$
  SELECT id, content, 1 - (embedding <=> query_embedding) AS score
  FROM documents
  WHERE agent_type = filter_agent_type
    AND 1 - (embedding <=> query_embedding) >= match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
```
