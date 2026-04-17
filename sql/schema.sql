-- 1. Расширение pgvector (для типа vector и операторов <=>, <->)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Таблицы

CREATE TABLE IF NOT EXISTS access_list (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint UNIQUE NOT NULL,
  granted_by bigint NOT NULL,
  granted_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  embedding vector(768),
  agent_type text NOT NULL,
  filename text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id bigint PRIMARY KEY,
  selected_agent text,
  message_history jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id bigint PRIMARY KEY,
  request_count integer DEFAULT 0,
  window_start timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_api_counter (
  id integer PRIMARY KEY DEFAULT 1,
  daily_count integer DEFAULT 0,
  reset_date date DEFAULT CURRENT_DATE
);

INSERT INTO global_api_counter (id, daily_count, reset_date)
VALUES (1, 0, CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

-- 3. Индексы

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS documents_agent_type_idx ON documents (agent_type);
CREATE INDEX IF NOT EXISTS documents_filename_idx ON documents (filename);
CREATE INDEX IF NOT EXISTS access_list_active_idx
  ON access_list (user_id) WHERE active = true;
