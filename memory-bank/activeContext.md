# Active Context

## Current Focus

Фаза 4: Деплой на Render. Фазы 1-3 завершены — бот полностью функционален: авторизация, 4 агента с RAG, rate limiting, session management. Следующие шаги: настройка Render Web Service, env vars, smoke tests, финальный security review.

## Recent Changes

- Завершена Фаза 3: созданы 4 агента (marketer, copywriter, ads, packager), agent.js (роутинг), message.js (обработка текста + /reset + /new).
- Подключены в index.js: sessionMiddleware, adminHandler (ранее отсутствовал), agentHandler, messageHandler.
- gemini/client.js: добавлена проверка глобального лимита перед вызовом + инкремент после. Возвращает {text, count, warning}.
- queries.js: добавлены getSession/saveSession/clearSessionHistory, checkAndIncrementUserRateLimit, renameDocuments.
- Создан session middleware (src/bot/middleware/session.js).
- Исправлены 4 критичных проблемы из security review (MIME bypass, race condition counter, re-upload rollback, /delete_doc sanitize).
- Создана SQL-функция increment_api_counter (sql/increment_api_counter.sql) — применить в Supabase перед деплоем.

## Active Decisions

- Каждый агент делает RAG retrieval самостоятельно (фильтр по agent_type) и вызывает generateResponse из client.js.
- История диалога: 10 пар (user + model) хранятся в таблице sessions как JSONB.
- User rate limit: 20 запросов/час, данные в таблице rate_limits.
- Re-upload: embed+insert под tmp-именем → delete старых → rename, с rollback при ошибке.

## Pre-Deploy Checklist

- [ ] Применить `sql/increment_api_counter.sql` в Supabase SQL Editor
- [ ] Подтвердить RLS включён на всех таблицах через Supabase Dashboard
- [ ] Создать `.env` с реальными значениями
- [ ] Проверить `npm audit` на critical/high
- [ ] Настроить Render Web Service: build=`npm install`, start=`npm start`, health=/health
- [ ] Задать все 11 env vars в Render Dashboard
- [ ] Smoke tests после деплоя

## Blockers

Нет.
