c# Telegram AI-Assistant Bot

Telegram-бот с 4 ИИ-агентами (Маркетолог, Копирайтер, Директолог (РСЯ), Упаковщик).
Стек: Node.js 20, Telegraf 4.x, Google Gemini 3 Flash, Supabase + pgvector, Render.

## Commands

- `npm install` — установка зависимостей
- `npm run dev` — разработка (nodemon)
- `npm start` — продакшн

## Project Structure

```
src/
  bot/middleware/   # auth.js, session.js
  bot/handlers/     # start.js, admin.js, agent.js, message.js
  agents/           # marketer.js, copywriter.js, ads.js, packager.js
  rag/              # ingest.js, embed.js, retrieve.js
  gemini/           # client.js
  db/               # supabase.js, queries.js
memory-bank/        # activeContext.md, progress.md, tasks.md
.claude/agents/     # bot-planner.md, rag-engineer.md, access-manager.md
.claude/rules/      # telegram-bot.md, rag-pipeline.md, gemini-api.md
.claude/skills/security-review/
```

## Code Style

- ES Modules (`import`/`export`), no CommonJS
- `async/await` everywhere, no raw `.then()` chains
- Every Gemini API call wrapped in try/catch handling 429, 500, timeout
- Gemini model via `process.env.GEMINI_MODEL` (default: `gemini-3-flash-preview`)
- Logging: only `user_id` + action, NEVER message content or PII

## Security Rules

- All tokens/keys in `.env` only, never hardcoded
- Webhook protected via `X-Telegram-Bot-Api-Secret-Token`
- Auth middleware runs before ALL handlers — no exceptions
- Access denied message MUST show user_id: `"Ваш ID: {id}. Отправьте его администратору."`
- Global Gemini API counter in Supabase table `global_api_counter`
- At limit exhaustion: notify owner bot, show stub message to users

## Architecture Rules

1. **File re-upload**: on `/upload` with existing `filename` — first `DELETE FROM chunks WHERE filename = $1`, then ingest new chunks
2. **Gemini global limit**: counter in Supabase `global_api_counter`, at 80% — warning to owner via bot notification
3. **Auth middleware**: validates `user_id` from `ctx.from.id` against DB, shows ID on deny

## Memory Bank

Read before every task: `memory-bank/activeContext.md`, `progress.md`, `tasks.md`
Update at end of session: `activeContext.md`, `progress.md`

## MCP

Use `context7` when writing code with external libraries (Telegraf, Supabase JS, Gemini SDK).

## References

- @.claude/rules/telegram-bot.md
- @.claude/rules/rag-pipeline.md
- @.claude/rules/gemini-api.md
- @.claude/agents/bot-planner.md
- @.claude/agents/rag-engineer.md
- @.claude/agents/access-manager.md
- @.claude/skills/security-review/SKILL.md

## Environment Variables

```
BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET,
GEMINI_API_KEY, GEMINI_MODEL, DAILY_API_LIMIT,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
OWNER_CHAT_ID, USER_RATE_LIMIT, PORT
```
