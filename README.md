# client-foragent

Telegram-бот с AI-агентами для партнёрской работы: маркетолог, копирайтер, директолог и упаковщик. Для гостей есть отдельный агент `consultant`.  
Стек: `Node.js 20`, `Telegraf 4`, `Google Gemini`, `Supabase`, `pgvector`, `Render`.

## Что уже есть

- 4 основных агента + `consultant` для гостевого режима
- Supabase-сессии и история диалога
- RAG по документам через `documents` и `match_documents`
- admin-flow для `/grant`, `/revoke`, `/upload`, `/list_docs`, `/delete_doc`
- аудит событий в `audit_logs`
- глобальный лимит Gemini и пользовательский rate limit
- long polling локально и webhook-режим для продакшна

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` на основе `.env.example`

3. Запустить бота:

```bash
npm run dev
```

Для прод-старта:

```bash
npm start
```

## Переменные окружения

Обязательные:

- `BOT_TOKEN`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_CHAT_ID`

Используемые переменные:

- `BOT_TOKEN`
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_SIMPLE_MODEL`
- `DAILY_API_LIMIT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_CHAT_ID`
- `ADMIN_IDS`
- `USER_RATE_LIMIT`
- `GUEST_RATE_LIMIT`
- `PORT`

Примечания:

- `GUEST_RATE_LIMIT=0` временно отключает лимит сообщений у `consultant`
- `WEBHOOK_URL` можно оставить пустым локально, тогда бот пойдёт в `long polling`
- для Render `WEBHOOK_URL` должен указывать на ваш сервис, например `https://your-app.onrender.com`

## SQL, которые должны быть применены в Supabase

Нужно применить эти файлы:

- `sql/schema.sql`
- `sql/match_documents.sql`
- `sql/check_and_increment_user_rate_limit.sql`
- `sql/reserve_global_api_call.sql`

Дополнительно в репозитории есть:

- `sql/increment_api_counter.sql`

Если база уже переведена на `reserve_global_api_call`, проверьте, что схема в Supabase соответствует текущему коду.

## Деплой на Render

Минимальные настройки сервиса:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

В Render Environment Variables задайте все переменные из `.env.example`.

Для webhook-режима:

- заполните `WEBHOOK_URL`
- задайте `WEBHOOK_SECRET`

Если `WEBHOOK_URL` пустой, приложение запускается в `long polling`, что удобно локально, но не рекомендуется для Render.

## Быстрая проверка перед пушем

1. Убедиться, что `.env` не попал в git
2. Проверить `git status`
3. Прогнать хотя бы синтаксическую проверку ключевых файлов
4. Проверить, что в Supabase есть:
   - `pending_uploads`
   - `audit_logs`
   - `check_and_increment_user_rate_limit(...)`
   - `reserve_global_api_call(...)`
5. Убедиться, что `BOT_TOKEN`, `GEMINI_API_KEY` и `SUPABASE_SERVICE_ROLE_KEY` не засвечены в коммите

## Полезные команды

```bash
npm install
npm run dev
npm start
git status
```
