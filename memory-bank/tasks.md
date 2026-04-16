# Tasks

---

## Фаза 1: Фундамент и авторизация

### Порядок реализации Фазы 1

```
1. package.json, .env.example          — скелет проекта, зависимости
2. src/db/supabase.js                  — клиент БД (от него зависит всё)
3. SQL: 5 таблиц + RLS + функции      — инфраструктура данных
4. src/db/queries.js                   — слой запросов (зависит от supabase.js)
5. src/bot/middleware/auth.js           — авторизация (зависит от queries.js)
6. src/bot/middleware/session.js        — сессии (зависит от queries.js)
7. src/bot/handlers/start.js            — /start, /help (зависит от auth.js)
8. src/bot/handlers/admin.js            — /grant, /revoke, /users, /status (зависит от queries.js, auth.js)
9. index.js                             — точка входа (зависит от всего выше)
```

### 1.1 Скелет проекта

- [x] **`package.json`** — конфиг проекта
  - `"type": "module"` (ES Modules)
  - scripts: `"dev": "nodemon index.js"`, `"start": "node index.js"`
  - dependencies: `telegraf`, `@supabase/supabase-js`, `@google/generative-ai`, `express`, `pdf-parse`, `mammoth`, `file-type`
  - devDependencies: `nodemon`
  - engine: `"node": ">=20"`

- [x] **`.env.example`** — шаблон переменных (без значений)
  ```
  BOT_TOKEN=
  WEBHOOK_URL=
  WEBHOOK_SECRET=
  GEMINI_API_KEY=
  GEMINI_MODEL=gemini-3-flash-preview
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  OWNER_CHAT_ID=
  DAILY_API_LIMIT=250
  USER_RATE_LIMIT=20
  PORT=3000
  ```

### 1.2 База данных

- [x] **`src/db/supabase.js`** — инициализация Supabase client
  - `export const supabase` — createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  - Одна проверка: если env vars отсутствуют — throw с понятным сообщением

- [x] **SQL: таблицы** (выполнить в Supabase Dashboard → SQL Editor)
  - `access_list` — id uuid PK, user_id bigint UNIQUE, granted_by bigint, granted_at timestamptz, active boolean
  - `sessions` — user_id bigint PK, selected_agent text, message_history jsonb, updated_at timestamptz
  - `rate_limits` — user_id bigint PK, request_count integer, window_start timestamptz
  - `global_api_counter` — id integer PK DEFAULT 1, daily_count integer, reset_date date
  - `documents` — id uuid PK, content text, embedding vector(768), agent_type text, filename text, created_at timestamptz

- [x] **SQL: индексы**
  - `CREATE INDEX ON access_list (user_id) WHERE active = true`
  - `CREATE INDEX ON documents (agent_type)`
  - `CREATE INDEX ON documents (filename)`
  - ivfflat индекс на embedding (Фаза 2, когда будут данные)

- [x] **SQL: RLS политики**
  - Включить RLS на всех таблицах
  - Политика: service_role имеет полный доступ (бот работает через service_role_key)
  - Запретить anon доступ ко всем таблицам

- [x] **SQL: функция `match_documents`** — для vector search (используется в Фазе 2)
  - Принимает: query_embedding vector(768), match_threshold float, match_count int, filter_agent_type text
  - Возвращает: id, content, score

- [x] **SQL: начальные данные**
  - INSERT в `global_api_counter` (id=1, daily_count=0, reset_date=CURRENT_DATE)
  - INSERT в `access_list` владельца (OWNER_CHAT_ID, granted_by=OWNER_CHAT_ID)

### 1.3 Слой запросов

- [x] **`src/db/queries.js`** — все функции работы с БД
  - Зависит от: `supabase.js`
  - Экспорты:
    - `checkAccess(userId)` → boolean — SELECT active FROM access_list WHERE user_id AND active=true
    - `grantAccess(userId, grantedBy)` → void — UPSERT в access_list (active=true)
    - `revokeAccess(userId)` → boolean — UPDATE active=false, return true если найден
    - `listActiveUsers()` → array — SELECT * FROM access_list WHERE active=true
    - `getSession(userId)` → object — SELECT * FROM sessions WHERE user_id
    - `saveSession(userId, data)` → void — UPSERT selected_agent, message_history, updated_at
    - `clearSession(userId)` → void — UPDATE message_history='[]', selected_agent=null
    - `checkUserRateLimit(userId)` → { allowed, remaining } — проверка rate_limits (20/час)
    - `incrementUserRateLimit(userId)` → void — инкремент request_count, сброс если window > 1 час
    - `checkGlobalCounter()` → { allowed, count, warning } — логика из gemini-api.md
    - `incrementGlobalCounter()` → void — daily_count + 1
    - `getStats()` → object — кол-во пользователей, документов, daily API usage

### 1.4 Middleware

- [x] **`src/bot/middleware/auth.js`** — проверка доступа
  - Зависит от: `queries.js`
  - `export default` — middleware function(ctx, next)
  - `authCache` = new Map(), TTL = 5 мин
  - Логика: OWNER → next() | кэш → use | queries.checkAccess → кэш → next()/deny
  - При отказе: `"Доступ запрещён.\n\nВаш ID: ${ctx.from.id}\nОтправьте его администратору для получения доступа."`
  - `export function invalidateCache(userId)` — удалить запись из кэша (вызывается из admin.js)

- [x] **`src/bot/middleware/session.js`** — загрузка сессии в ctx
  - Зависит от: `queries.js`
  - `export default` — middleware function(ctx, next)
  - Загружает сессию: `ctx.session = await getSession(ctx.from.id)`
  - Если нет сессии — создаёт пустую: `{ selected_agent: null, message_history: [] }`
  - После обработки (next) — автосохранение через `saveSession()`

### 1.5 Handlers

- [x] **`src/bot/handlers/start.js`** — /start и /help
  - Зависит от: `auth.js` (косвенно, через middleware chain)
  - `export function startHandler(bot)` — регистрирует bot.start()
  - `/start` для авторизованных: приветствие + inline-клавиатура выбора агента (2x2 кнопки)
  - `/start` для неавторизованных: обрабатывается в auth.js (показывает user_id) — handler не вызывается
  - `/help` — список команд, краткое описание 4 агентов
  - Inline-кнопки: callback_data = `agent:marketer`, `agent:copywriter`, `agent:ads`, `agent:packager`

- [x] **`src/bot/handlers/admin.js`** — команды владельца
  - Зависит от: `queries.js`, `auth.js` (invalidateCache)
  - `export function adminHandler(bot)` — регистрирует команды
  - Все команды проверяют `ctx.from.id == OWNER_CHAT_ID` в начале
  - `/grant {user_id}` → grantAccess() → invalidateCache(userId) → "Доступ выдан пользователю {id}"
  - `/revoke {user_id}` → revokeAccess() → invalidateCache(userId) → "Доступ отозван у пользователя {id}"
  - `/users` → listActiveUsers() → форматированный список с датами
  - `/status` → getStats() → кол-во пользователей, документов, API usage за сегодня

### 1.6 Точка входа

- [x] **`index.js`** — запуск бота
  - Зависит от: всех файлов выше
  - Создать Express app + Telegraf bot
  - Health check: `app.get('/health', (req, res) => res.sendStatus(200))`
  - Webhook: `app.use(bot.webhookCallback('/webhook', { secretToken: process.env.WEBHOOK_SECRET }))`
  - Middleware chain (строгий порядок):
    1. Фильтр: только private чаты (`ctx.chat.type === 'private'`)
    2. auth middleware
    3. session middleware
  - Handlers:
    1. startHandler(bot)
    2. adminHandler(bot)
    3. agentHandler(bot) — заглушка, реализация в Фазе 2-3
    4. messageHandler(bot) — заглушка, реализация в Фазе 3
  - Запуск: `bot.telegram.setWebhook(WEBHOOK_URL, { secret_token: WEBHOOK_SECRET })`
  - `app.listen(PORT)`

---

## Фаза 2: RAG Pipeline

> Зависит от: Фаза 1 полностью завершена (supabase.js, queries.js, index.js работают)

### Порядок реализации Фазы 2

```
1. src/gemini/client.js         — Gemini SDK init + embedContent (нужен для embed.js)
2. src/rag/ingest.js            — парсинг и chunking (независим от Gemini)
3. src/rag/embed.js             — embedding через client.js (зависит от 1)
4. src/rag/retrieve.js          — vector search (зависит от 1, SQL function)
5. src/bot/handlers/message.js  — /upload команда (зависит от 2, 3)
6. src/bot/handlers/agent.js    — выбор агента callback (независим)
```

### 2.1 Gemini Client (базовая версия)

- [x] **`src/gemini/client.js`** — инициализация + embedding
  - `export const genAI` — new GoogleGenerativeAI(GEMINI_API_KEY)
  - `export const model` — getGenerativeModel с temperature 0.7, maxOutputTokens 2048
  - `export async function embedText(text)` → float[768] — через text-embedding-004
  - `export async function generateResponse({ userMessage, systemPrompt, ragContext, messageHistory })` — заглушка, полная реализация в Фазе 3
  - Обработка ошибок: 429, 500/503, timeout

### 2.2 Ingestion

- [x] **`src/rag/ingest.js`** — парсинг и chunking документов
  - `export async function parseDocument(buffer, mimeType)` → string — PDF/DOCX/TXT парсинг
  - `export function chunkText(text)` → string[] — разбивка на чанки (500 токенов, overlap 50)
  - Алгоритм: абзацы → предложения → по размеру → merge коротких → overlap
  - Валидация: MIME через `file-type` пакет, размер <= 10MB
  - `ALLOWED_MIME` = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']

### 2.3 Embedding

- [x] **`src/rag/embed.js`** — генерация embeddings
  - `export async function embedChunks(chunks)` → float[768][] — batch по 10
  - Вызывает `embedText()` из gemini/client.js
  - Каждый batch инкрементирует `global_api_counter`
  - `export async function embedQuery(text)` → float[768] — один embedding для поиска

### 2.4 Retrieval

- [x] **`src/rag/retrieve.js`** — vector search
  - `export async function retrieveContext(query, agentType)` → { chunks: string[], scores: float[] }
  - Вызывает `embedQuery()` → supabase.rpc('match_documents', ...) → top-3, score >= 0.7
  - Форматирует контекст: `[1] chunk_1\n[2] chunk_2\n[3] chunk_3`
  - Если 0 результатов — возвращает пустой контекст + флаг `noContext: true`

### 2.5 Upload Handler

- [x] **`src/bot/handlers/message.js`** (начальная версия — только /upload)
  - `export function messageHandler(bot)` — регистрирует обработчик документов
  - `/upload` (только OWNER): принять файл → скачать через Telegram API → валидация MIME + размер
  - **Filename sanitization**: `filename.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_').slice(0, 100)`
  - **Re-upload**: DELETE FROM documents WHERE filename = $1 → ingest → embed → insert
  - Спросить agent_type через inline-кнопки: "Для какого агента этот документ?"
  - Подтверждение: "Документ '{filename}' загружен: {N} чанков для агента {type}"

### 2.6 Agent Selection

- [x] **`src/bot/handlers/agent.js`** — обработка выбора агента
  - `export function agentHandler(bot)` — регистрирует callback_query handler
  - Callback: `agent:{type}` → валидация против VALID_AGENTS → сохранить в session.selected_agent
  - Ответ: "Агент: **{название}**. Задайте вопрос."
  - `/switch` — показать inline-клавиатуру выбора агента заново

### 2.7 Обновить queries.js

- [x] **Добавить в `src/db/queries.js`** функции для RAG:
  - `deleteDocumentsByFilename(filename)` → void — DELETE FROM documents WHERE filename
  - `insertDocumentChunks(chunks)` → void — batch INSERT в documents (content, embedding, agent_type, filename)
  - `matchDocuments(embedding, agentType)` → array — rpc('match_documents', ...)
  - `getDocumentStats()` → { total, byAgent } — COUNT GROUP BY agent_type

---

## Фаза 3: 4 Агента и Rate Limiting

> Зависит от: Фаза 2 (gemini/client.js, retrieve.js работают)

### Порядок реализации Фазы 3

```
1. Дополнить src/gemini/client.js      — полная generateResponse + глобальный счётчик
2. Дополнить src/db/queries.js          — rate limit функции
3. src/agents/marketer.js               — первый агент (шаблон для остальных)
4. src/agents/copywriter.js             — по шаблону marketer
5. src/agents/ads.js                    — по шаблону marketer
6. src/agents/packager.js               — по шаблону marketer
7. Дополнить src/bot/handlers/message.js — роутинг текста → агент → ответ
8. Обновить index.js                    — подключить всё в middleware chain
```

### 3.1 Gemini Client (полная версия)

- [x] **Дополнить `src/gemini/client.js`**
  - Полная `generateResponse()`: systemInstruction + contents[] (разделены!)
  - **Таймаут 30 сек**: AbortController на каждый запрос generateContent/embedContent
  - **Safety settings**: BLOCK_MEDIUM_AND_ABOVE для всех 4 категорий
  - Перед вызовом: checkGlobalCounter() → если !allowed → throw GlobalLimitError
  - После вызова: incrementGlobalCounter()
  - При warning (80%) — вернуть флаг `{ text, warning: true }` для уведомления owner
  - message_history → contents[] (чередование user/model)

### 3.2 Агенты

- [x] **`src/agents/marketer.js`** — Маркетолог
  - `export async function askMarketer(userMessage, ragContext, messageHistory)` → string
  - Системный промпт: роль маркетолога, правила ответа, anti-injection, русский язык
  - Вызывает `generateResponse()` из client.js

- [x] **`src/agents/copywriter.js`** — Копирайтер
  - `export async function askCopywriter(...)` — аналогично marketer
  - Промпт: роль копирайтера, стиль текстов, форматирование для Telegram

- [x] **`src/agents/ads.js`** — Рекламщик
  - `export async function askAds(...)` — аналогично marketer
  - Промпт: роль рекламщика, форматы объявлений, платформы

- [x] **`src/agents/packager.js`** — Упаковщик
  - `export async function askPackager(...)` — аналогично marketer
  - Промпт: роль упаковщика, офферы, УТП, структура страниц

### 3.3 Rate Limiting

- [x] **Пользовательский лимит** (в queries.js — checkAndIncrementUserRateLimit)
  - 20 запросов/час на пользователя (из `process.env.USER_RATE_LIMIT`)
  - Таблица `rate_limits`: проверить window_start, если > 1 час — сбросить
  - При превышении: "Лимит запросов исчерпан. Попробуйте через час."

- [x] **Глобальный лимит** (в gemini/client.js — checkGlobalCounter + incrementGlobalCounter)
  - При count >= 200 (80%): уведомление OWNER_CHAT_ID
  - При count >= 250 (100%): заглушка "Сервис временно недоступен, попробуйте завтра"
  - Сброс daily_count при смене даты

### 3.4 Message Handler (полная версия)

- [x] **Дополнить `src/bot/handlers/message.js`**
  - Текстовые сообщения: проверить session.selected_agent → retrieve context → ask agent → reply
  - Если агент не выбран: "Сначала выберите агента" + inline-клавиатура
  - `/reset` — clearSession() → "Контекст диалога очищен"
  - `/new` — очистить message_history, сохранить selected_agent → "Новый диалог начат"
  - Сохранять message_history (последние 10 пар user/assistant)
  - Фильтр: длина > 4000 символов → "Сообщение слишком длинное"

---

## Фаза 4: Деплой, безопасность, тесты

> Зависит от: Фазы 1-3 полностью работают локально

### 4.1 Render Setup

- [ ] Создать Web Service в Render Dashboard
- [ ] Build command: `npm install`
- [ ] Start command: `npm start`
- [ ] Environment Variables: все 11 переменных из .env.example
- [ ] Health check path: `/health`
- [ ] Auto-deploy: из ветки `main`
- [ ] **Graceful shutdown** в `index.js`: обработка SIGTERM/SIGINT
  - Остановить приём новых webhook-запросов
  - Дождаться завершения текущих обработок (timeout 5 сек)
  - `process.on('SIGTERM', () => { server.close(); bot.stop('SIGTERM'); })`

### 4.2 Безопасность (pre-deploy)

- [ ] Запустить `/security-review` — полный аудит по чеклисту
- [ ] `npm audit` — нет critical/high уязвимостей
- [ ] Проверить: `.env` в `.gitignore`, не в git history
- [ ] Проверить: webhook secret_token настроен и проверяется
- [ ] Проверить: BOT_TOKEN, GEMINI_API_KEY не в логах/ответах
- [ ] Проверить: RLS включён на всех таблицах Supabase

### 4.3 Smoke Tests (ручные)

- [ ] `/start` от авторизованного → приветствие + меню агентов
- [ ] Сообщение от неавторизованного → "Доступ запрещён. Ваш ID: ..."
- [ ] `/grant {id}` от owner → "Доступ выдан", пользователь может работать
- [ ] `/revoke {id}` → доступ отозван (проверить через 5+ мин, после кэша)
- [ ] Выбор агента → вопрос → ответ (с RAG если есть документы)
- [ ] `/upload` PDF → "Документ загружен: N чанков"
- [ ] Повторный `/upload` того же файла → старые чанки удалены, новые загружены
- [ ] Превышение rate limit (20 запросов) → "Лимит исчерпан"
- [ ] `/status` → статистика пользователей, документов, API
- [ ] `/reset` → "Контекст очищен", новый вопрос без предыдущей истории
- [ ] Health check: `curl https://<app>.onrender.com/health` → 200
