# Active Context

## Current Focus

Scope команд настраивается через `bot.telegram.setMyCommands` с параметром `scope`: default (4 публичные команды — start/help/reset/new) и chat для владельца + `ADMIN_CHAT_IDS` (расширенный набор с grant/revoke/users/stats/upload). Дальше — локальное тестирование `consultant.js` (гостевой поток + off-topic + CTA), потом загрузка тестового документа через `/upload` для проверки RAG retrieval, финальный шаг — деплой на Render.

## Recent Changes

- `src/bot/handlers/message.js`: история диалога ограничена последними 10 парами user/model (20 объектов максимум) из `sessions.message_history`. Одинаково применяется для гостевого consultant и авторизованных агентов через helper `getRecentHistory()` / `appendToHistory()`.
- `src/rag/retrieve.js`: RAG retrieval теперь сначала собирает top-2 из текущего `agent_type` + `all`, а если найдено меньше 2 чанков - добирает из `consultant`. Итоговый контекст всё равно ограничен 2 чанками, embedding запроса генерируется один раз, добавлены безопасные `[RAG]` логи без содержимого сообщений и документов.
- `src/rag/embed.js`: добавлен параметр `taskType` в `embedBatch`. `embedChunks` использует `RETRIEVAL_DOCUMENT` (для индексации), `embedQuery` - `RETRIEVAL_QUERY` (для поиска). Семантика подсказывает модели роль текста и улучшает качество матчинга.
- `src/rag/retrieve.js`: `MIN_SCORE` снижен с 0.7 до 0.55. На реальных данных при 0.7 retrieve часто возвращал 0 чанков и агент уходил в `noContext: true`.
- `src/bot/admins.js` (новый файл): вынесены `getAdminIds()` и `isAdmin(ctx)`. Раньше дублировались в `index.js` и `admin.js`. Имя env-переменной - `ADMIN_IDS` (не `ADMIN_CHAT_IDS`, как в более ранних заметках).
- `src/bot/middleware/auth.js`: вместо проверки `userId === OWNER_CHAT_ID` теперь `getAdminIds().includes(userId)` и выставляется `ctx.isAdmin = true`. `ctx.isOwner` больше не выставляется.
- `src/bot/handlers/admin.js`: все `isOwner(ctx)` заменены на `isAdmin(ctx)` (импорт из `../admins.js`). Команды `/grant`, `/revoke`, `/users`, `/stats`, `/upload`, `/list_docs`, `/delete_doc`, приём документа и callback `upload_agent:*` теперь доступны всем админам, а не только владельцу.
- `index.js`: дублирующий `getAdminIds()` удалён, импортируется из `src/bot/admins.js`.
- `scripts/` (новая папка): `rag-debug.js` (топ-5 матчей с скорами для запроса), `embed-test.js` (сравнение embeddings с разными taskType), `repro-error.mjs` (полный прогон embed → match → Gemini вне Telegraf для изоляции багов).
- `src/bot/handlers/message.js`: в catch агентов добавлен лог `e.stack` и `e.cause` для диагностики - на тёмных ошибках вроде `Cannot convert argument to a ByteString` без стека невозможно найти источник.
- `src/bot/handlers/message.js`: гостевой лимит для `consultant` сделан отключаемым. Сейчас `GUEST_RATE_LIMIT` по умолчанию = `0`, и при значении `<= 0` проверка `checkAndIncrementUserRateLimit` для гостей пропускается. Очередь запросов, глобальные лимиты Gemini и остальная логика не менялись.
- `src/bot/handlers/message.js` + `src/db/queries.js`: повторные приветствия агентов подавляются на уровне кода, а не только промптом. После первого успешного ответа пользователю пишется audit-событие `assistant_response_sent`; все следующие ответы этого пользователя автоматически очищаются от приветственного префикса (`Привет`, `Здравствуйте`, `Добрый день`, и т.д.), даже если он переключил агента или очистил историю.
- `src/agents/{marketer,copywriter,ads,packager,consultant}.js`: в системные промпты добавлена секция `КТО ТЫ - ОТВЕЧАЙ ИМЕННО ТАК` перед финальным правилом. Агенты должны представляться как AI-специалисты проекта VIPPARTNER.PRO, на вопрос о модели отвечать про Google Gemini 3 Flash, не говорить "я языковая модель Google" и не перечислять общие возможности ИИ вроде стихов, переводов или музыки.
- `src/rag/embed.js`: явно задан `config.outputDimensionality: 768` в `ai.models.embedContent`. Модель `gemini-embedding-001` по умолчанию возвращает 3072 мерности (Matryoshka), а колонка `documents.embedding` в Supabase - `vector(768)`. Без этого config upload падал с `expected 768 dimensions, not 3072`.
- `src/bot/handlers/admin.js`: `downloadFile` теперь ретраит до 3 раз с шагом 1/2/3 сек и логирует каждую попытку (`[DOWNLOAD] attempt=N/3 error=...`). Лечит разовые `fetch failed` на скачивании файла с Telegram-серверов.
- Consultant получил собственный RAG. `src/agents/consultant.js` теперь вызывает `retrieveContext(query, 'consultant')` и пробрасывает `ragContext` в `generateResponse`; системный промпт обновлён («если есть контекст из базы знаний - опирайся на него»). В `src/bot/handlers/admin.js` добавлен отдельный список `UPLOAD_TARGETS = [...VALID_AGENTS, 'consultant']`, в `AGENT_NAMES` - `consultant: 'Консультант'`, в `UPLOAD_AGENT_KEYBOARD` - кнопка «💬 Консультант (о проекте)». `VALID_AGENTS` не тронут (message.js dispatch и «Все агенты» upload охватывают только 4 основных агента). Консультант остаётся не-выбираемым для авторизованных: маршрут только для гостей через `ctx.isGuest`.
- Upload: добавлена кнопка «📚 Все 4 агента» в `UPLOAD_AGENT_KEYBOARD` (admin.js, callback `upload_agent:all`). При выборе embeddings генерируются один раз, затем чанки вставляются в БД 4 раза с разными `agent_type`. Flow re-upload не ломается: `deleteDocumentsByFilename`/`renameDocuments` фильтруют только по filename, без `agent_type`, поэтому мульти-agent запись с общим filename работает как одна группа. Сообщение об успехе: «N чанков × 4 агентов».
- UX: «🤔 Думаю…» placeholder + typing-loop. `message.js` теперь при ответе авторизованного агента и консультанта сразу шлёт сообщение-плейсхолдер, параллельно каждые 4 сек дергает `sendChatAction('typing')`, после получения ответа от Gemini редактирует плейсхолдер через `editMessageText`. Если edit падает (сообщение удалено / текст 4096+ / markup invalid) — плейсхолдер удаляется и шлётся `ctx.reply` как fallback. `CONTROL_KEYBOARD` пробрасывается в `extra`. Снимает ощущение «15-секундной тишины».
- `gemini/client.js`: в catch добавлен подробный лог `[GEMINI] model=... status=... code=... name=... message=...` для диагностики 5xx.
- Агент `ads` переименован с «Рекламщик» на «Директолог (РСЯ)» во всём user-facing слое (кнопки выбора агента, клавиатура `/upload`, HELP_TEXT, приветствие, промпт consultant, упоминание в packager, CLAUDE.md, productContext.md). Внутренний ключ `ads`, `agent_type` в БД, callback_data `agent:ads` / `upload_agent:ads` НЕ менялись - переименование чисто визуальное, данные RAG и сессии не затронуты.
- Команда `/switch` удалена полностью. `/reset` теперь показывает меню выбора агента (было: очистка истории). `/new` остался прежним - очищает `message_history` и начинает заново. Кнопка 🔄 Сменить (callback `action:switch`) работает как раньше - триггерит то же меню.
- Все упоминания `/switch` в системных промптах агентов (`marketer/copywriter/ads/packager`) заменены на `/reset`, чтобы Gemini перенаправлял пользователей на актуальную команду.
- Описания в `setMyCommands`: `reset - Сменить агента`, `new - Начать новый диалог (очистить историю)`.
- Багфикс: агенты (`marketer/copywriter/ads/packager/consultant`) теперь пробрасывают `count` из `generateResponse`; в `message.js` уведомление owner о 80%-лимите показывает реальное число, а не `'~80%'` (раньше `warning.count` был всегда `undefined`, т.к. `warning` - boolean).
- `index.js` пересобран: `setMyCommands` с `scope: default` для 4 публичных команд (start/help/reset/new) и `scope: chat` для владельца + списка `ADMIN_CHAT_IDS` (через запятую) с расширенным набором (grant/revoke/users/stats/upload). Введён helper `getAdminIds()` - дедуплицирует OWNER_CHAT_ID + админов.
- `/stats` добавлен как alias к `/status` в `admin.js` (оба обрабатывают одну функцию), чтобы меню Telegram совпадало с реальной командой.
- UX улучшения выполнены: иконки на кнопках агентов (📊 ✍️ 📣 📦), CONTROL_KEYBOARD (🔄 Сменить / 🧹 Сбросить / 🆕 Новый) под каждым ответом, чистое форматирование без двойных тире, callback-хендлеры `action:switch|reset|new|help`.
- Добавлен 5-й агент `consultant.js` (лид-квалификатор): отвечает только о проекте, отказ off-topic фразой «Я могу рассказать только о нашем проекте», CTA с ID и @Skyter2026 добавляется системой автоматически (а не Gemini).
- `auth.js`: неавторизованные теперь проходят через middleware с `ctx.isGuest=true` (вместо deny-ответа); session middleware работает для всех, консультант имеет свою историю.
- `message.js`: роутинг гостей на `askConsultant`, детектор «не могу помочь / не знаю» в ответах авторизованных агентов → добавляет «По этому вопросу напишите владельцу: @Skyter2026».
- `OWNER_CHAT_ID` в `.env` заполнен.
- Замена `—` на `-` во всех агентских промптах, хендлерах и UI-текстах (в `gemini/client.js` оставлено в регэксе `formatForTelegram` и в описании правила форматирования).
- `start.js`: приветствие переформатировано - добавлены эмодзи (👋 🤖 📊 ✍️ 📣 📦 👇), убраны двойные тире, отдельная ветка для гостя.
- Локальная проверка: `/start` и ответ агента «Упаковщик» работают корректно в polling-режиме.
- `gemini/client.js`: добавлены `FORMATTING_INSTRUCTIONS` (запрет markdown, требование эмодзи и короткого дефиса) и пост-процессор `formatForTelegram` (чистит `**`/`*`/`#`, заменяет `—`/`–` на `-`, нормализует двойные дефисы).
- `sql/schema.sql`: полный скрипт с `CREATE EXTENSION vector`, всеми таблицами и индексами; применить в Supabase идемпотентно.
- `index.js`: polling-фолбэк — если `WEBHOOK_URL` пуст, бот поднимается через `bot.launch()` вместо webhook. В проде переменная задаётся в Render Dashboard, webhook включается автоматически.
- `file-type` обновлён до `^21.3.4` (закрыт GHSA-5v7r-6r5c-r473, Node 20 сохранён).
- `sql/match_documents.sql` — RPC-функция для pgvector поиска (применено).
- Завершена Фаза 3: созданы 4 агента (marketer, copywriter, ads, packager), agent.js (роутинг), message.js (обработка текста + /reset + /new).
- Подключены в index.js: sessionMiddleware, adminHandler, agentHandler, messageHandler.
- gemini/client.js: проверка глобального лимита перед вызовом + инкремент после. Возвращает `{text, count, warning}`.
- queries.js: добавлены getSession/saveSession/clearSessionHistory, checkAndIncrementUserRateLimit, renameDocuments.
- Session middleware (src/bot/middleware/session.js).
- Исправлены 4 критичных проблемы из security review (MIME bypass, race condition counter, re-upload rollback, /delete_doc sanitize).
- Создана SQL-функция increment_api_counter (sql/increment_api_counter.sql) — применить в Supabase перед деплоем.

## Next Steps

1. [x] Scope команд настраивается через `setMyCommands` (default + chat для владельца/ADMIN_CHAT_IDS)
2. [ ] Протестировать `consultant.js` локально: гость → ответ по проекту + CTA с ID и @Skyter2026; off-topic → фиксированный отказ «Я могу рассказать только о нашем проекте»
3. [ ] Загрузить тестовый документ через `/upload` (PDF/DOCX/TXT) для проверки RAG retrieval (score ≥ 0.7, фильтр по agent_type)
4. [ ] Деплой на Render: env vars (включая `ADMIN_CHAT_IDS`), health check `/health`, webhook-режим (активируется автоматически при заполненном `WEBHOOK_URL`)

## Completed

- [x] `/start` под OWNER_CHAT_ID — приветствие + меню агентов
- [x] Ответ агента «Упаковщик» (без RAG-контекста, форматирование чистое)

## Active Decisions

- Каждый агент делает RAG retrieval самостоятельно (фильтр по agent_type) и вызывает generateResponse из client.js.
- История диалога: последние 10 пар user/model (20 объектов максимум) хранятся в таблице sessions как JSONB.
- User rate limit: 20 запросов/час, данные в таблице rate_limits (общий лимит и для гостей).
- Re-upload: embed+insert под tmp-именем → delete старых → rename, с rollback при ошибке.
- Неавторизованные не блокируются: auth middleware выставляет `ctx.isGuest=true`, `message.js` роутит их на consultant без RAG.
- CTA с ID + @Skyter2026 добавляется кодом (после текста Gemini), не самим Gemini — гарантирует формат.
- Off-topic у consultant: системный промпт инструктирует отвечать ровно «Я могу рассказать только о нашем проекте.»
- Команды упрощены до 4 публичных: `/start`, `/help`, `/reset` (сменить агента), `/new` (новый диалог). `/switch` удалена - дублировала `/reset`. Кнопочная UX-панель (🔄/🧹/🆕) сохранена для тех же действий через callback.

## Pre-Deploy Checklist

- [ ] Применить `sql/increment_api_counter.sql` в Supabase SQL Editor
- [ ] Подтвердить RLS включён на всех таблицах через Supabase Dashboard
- [x] Создать `.env` с реальными значениями (`OWNER_CHAT_ID` заполнен)
- [ ] Проверить `npm audit` на critical/high
- [ ] Настроить Render Web Service: build=`npm install`, start=`npm start`, health=/health
- [ ] Задать все 11 env vars в Render Dashboard
- [ ] Smoke tests после деплоя (включая гостевой поток через consultant)

## Blockers

Нет.
