# Tech Context

## Стек

| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Node.js | 20 LTS | Runtime |
| Telegraf | 4.x | Telegram Bot Framework |
| Google Gemini | gemini-3-flash-preview | LLM + Embeddings |
| @google/genai | latest | Gemini SDK (new) |
| Supabase JS | 2.x | БД клиент |
| Supabase + pgvector | - | Векторное хранилище |
| Render | Free tier | Хостинг (→ Railway при росте) |
| pdf-parse | latest | Парсинг PDF |
| mammoth | latest | Парсинг DOCX |

## Схема БД (Supabase)

```sql
-- Управление доступом
CREATE TABLE access_list (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint UNIQUE NOT NULL,
  granted_by bigint NOT NULL,
  granted_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

-- Документы и embeddings для RAG
CREATE TABLE documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  embedding vector(768),
  agent_type text NOT NULL,       -- marketer | copywriter | ads | packager
  filename text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Сессии пользователей
CREATE TABLE sessions (
  user_id bigint PRIMARY KEY,
  selected_agent text,            -- текущий выбранный агент
  message_history jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Пользовательский rate limit
CREATE TABLE rate_limits (
  user_id bigint PRIMARY KEY,
  request_count integer DEFAULT 0,
  window_start timestamptz DEFAULT now()
);

-- Глобальный счётчик API (одна строка)
CREATE TABLE global_api_counter (
  id integer PRIMARY KEY DEFAULT 1,
  daily_count integer DEFAULT 0,
  reset_date date DEFAULT CURRENT_DATE
);
```

### Индексы

```sql
-- Для малого объёма данных (<1000 строк) использовать HNSW; при росте можно перейти на ivfflat
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON documents (agent_type);
CREATE INDEX ON documents (filename);
CREATE INDEX ON access_list (user_id) WHERE active = true;
```

## Переменные окружения

```
BOT_TOKEN            # Telegram Bot Token
WEBHOOK_URL          # https://<app>.onrender.com/webhook
WEBHOOK_SECRET       # secret_token для X-Telegram-Bot-Api-Secret-Token
GEMINI_API_KEY       # Google Gemini API Key
GEMINI_MODEL         # gemini-3-flash-preview (default)
SUPABASE_URL         # https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY  # Supabase service role key
OWNER_CHAT_ID        # Telegram user_id владельца бота
DAILY_API_LIMIT      # дневной лимит Gemini API (default: 250)
USER_RATE_LIMIT      # лимит на пользователя в час (default: 20)
PORT                 # порт для webhook (default: 3000)
```

## Деплой

- **Render Free**: Web Service, auto-deploy из main, 512MB RAM
- Webhook mode (не polling) — обязателен для Render
- Health check: `GET /health` → 200
- При sleep (15 мин) — первый запрос медленный (cold start ~5-10 сек)
- Миграция на Railway: изменить только env vars и URL webhook
