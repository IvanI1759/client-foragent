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
