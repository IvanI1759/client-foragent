# Progress

## Completed

### Фаза 1: Фундамент и авторизация

- [x] `package.json` — ES Modules, scripts, dependencies (telegraf, @supabase/supabase-js, @google/genai, express, pdf-parse, mammoth, file-type), node >= 20.
- [x] `.env.example` — шаблон 11 переменных без значений.
- [x] `src/db/supabase.js` — клиент Supabase на service_role_key + проверка env.
- [x] SQL в Supabase: таблицы `access_list`, `sessions`, `rate_limits`, `global_api_counter`, `documents`; индексы; RLS (service_role only); функция `match_documents`; начальные данные (owner + counter row).
- [x] `src/db/queries.js` — полный слой запросов: access, sessions, rate limits, global counter, stats.
- [x] `src/bot/middleware/auth.js` — проверка доступа с кэшем 5 мин + `invalidateCache()`; сообщение отказа с `user_id`.
- [x] `src/bot/middleware/session.js` — загрузка/автосохранение сессии в `ctx.session`.
- [x] `src/bot/handlers/start.js` — `/start` (меню агентов для авторизованных), `/help`.
- [x] `src/bot/handlers/admin.js` — `/grant`, `/revoke`, `/users`, `/status`, `/upload`, `/delete_doc`, `/list_docs` (только OWNER); re-upload через tmp-имя с rollback.
- [x] `index.js` — Express + Telegraf, health check, webhook с `secret_token`, middleware chain (private-фильтр → auth → session), регистрация всех handlers.

### Фаза 2: RAG Pipeline

- [x] `src/gemini/client.js` — @google/genai SDK, `generateResponse()` (systemInstruction отделён от contents, safety settings BLOCK_MEDIUM_AND_ABOVE, timeout 30с через AbortController), `embedText()`, проверка `checkGlobalCounter` перед вызовом + `incrementGlobalCounter` после.
- [x] `src/rag/ingest.js` — парсинг PDF/DOCX/TXT, chunking 500 токенов / overlap 50, валидация MIME по magic bytes + NUL-байт защита для TXT, лимит 10MB, `sanitizeFilename()`.
- [x] `src/rag/embed.js` — batch-embedding по 10 чанков через gemini-embedding-001, инкремент `global_api_counter`, timeout 30с.
- [x] `src/rag/retrieve.js` — vector search через `match_documents` RPC, top-3, min score 0.7, фильтр по `agent_type`.
- [x] `src/db/queries.js` дополнен: `deleteDocumentsByFilename`, `insertDocumentChunks`, `renameDocuments`, `matchDocuments`, `getDocumentStats`, `getSession`, `saveSession`, `clearSessionHistory`, `checkAndIncrementUserRateLimit`.
- [x] SQL: `increment_api_counter()` — атомарная Postgres-функция (UPDATE ... RETURNING) для race-free инкремента счётчика. Файл: `sql/increment_api_counter.sql`.

### Фаза 3: 4 Агента и Rate Limiting

- [x] `src/agents/marketer.js` — маркетолог-стратег: стратегия, ЦА, воронки, unit-экономика. RAG фильтр `agent_type=marketer`.
- [x] `src/agents/copywriter.js` — копирайтер: посты, рассылки, CTA, контент-план. RAG фильтр `agent_type=copywriter`.
- [x] `src/agents/ads.js` — рекламщик РСЯ/Директ: объявления (35/81/300), таргетинг, ставки, ретаргетинг. RAG фильтр `agent_type=ads`.
- [x] `src/agents/packager.js` — упаковщик ТГ-канала: bio (255), закреп, УТП, рубрики, монетизация. RAG фильтр `agent_type=packager`.
- [x] `src/agents/strategist.js` — личный стратег владельца: анализ проекта, слабые места, идеи роста, конкуренты, стратегическое планирование. Доступ только владельцу/админам.
- [x] `src/bot/handlers/agent.js` — callback `agent:{type}` с валидацией, `/switch`, сброс истории при смене.
- [x] `src/bot/handlers/message.js` — роутинг текста → агент, `/reset`, `/new`, лимит 4000 символов, история ограничена последними 10 парами user/model (20 объектов максимум), user rate limit (20/час), уведомление owner при 80% глобального лимита.
- [x] `src/bot/handlers/message.js` — лимит в 5 сообщений у гостевого `consultant` временно снят: `GUEST_RATE_LIMIT` теперь отключает проверку при значении `<= 0`, остальная архитектура (очередь, антиспам, глобальные лимиты Gemini) сохранена.
- [x] Повторные приветствия у всех агентов убраны на уровне кода: после первого успешного ответа пользователю пишется `assistant_response_sent` в `audit_logs`, а все последующие ответы этого пользователя очищаются от стартового приветствия, даже после переключения агента.
- [x] В промпты всех 5 агентов добавлена секция самоидентификации: кто агент в рамках VIPPARTNER.PRO, как отвечать на вопрос о модели (`Google Gemini 3 Flash`), запрет на общие ответы про "я языковая модель Google" и перечисление универсальных возможностей ИИ.
- [x] Секции самоидентификации у всех 5 агентов расширены: на "кто ты / что умеешь / чем можешь помочь / представься" они отвечают развёрнуто 4-5 абзацами с конкретным списком помощи.
- [x] RAG fallback расширен: агенты ищут документы по своему `agent_type` + `all`, а если найдено меньше 2 чанков - добирают из `consultant`; итоговый контекст ограничен top-2.
- [x] `src/gemini/client.js` — timeout Gemini увеличен до 60 секунд, добавлен один повтор generateContent при незавершённом `finishReason` не `STOP`.
- [x] `src/gemini/client.js` — лимиты генерации увеличены: simple 1200, complex 2200, detailed 3200 токенов, чтобы ответы не обрывались из-за `MAX_TOKENS`.
- [x] Все промпты содержат anti-injection инструкцию + перенаправление вне своей зоны через /switch.
- [x] Ошибки 429/500/503/timeout/global-limit → UX-сообщения пользователю, без stack trace.

### Security Review (между Фазами 2 и 3)

- [x] Аудит проведён. 0 критичных уязвимостей.
- [x] Исправлено: MIME bypass для .txt (NUL-байты), race condition в counter (атомарный RPC), re-upload без rollback (tmp-имя), /delete_doc без sanitize.

## In Progress

Нет.

## Pending

- Фаза 4: деплой на Render, финальный security review, smoke tests.

## Known Issues

- `pdf-parse@1.1.1` устарел, потенциальный DoS при парсинге битых PDF — рекомендуется обновить или заменить до деплоя.
- RLS в Supabase — подтвердить включён через Dashboard (service_role bypass'ит RLS, но anon доступ должен быть заблокирован).
