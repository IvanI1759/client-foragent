-- Атомарный инкремент дневного счётчика Gemini API.
-- Устраняет race condition: SELECT→UPDATE заменяется на один UPDATE с RETURNING
-- в рамках одной транзакции. При смене даты счётчик сбрасывается в 1.
CREATE OR REPLACE FUNCTION increment_api_counter()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE global_api_counter
  SET
    daily_count = CASE
      WHEN reset_date = CURRENT_DATE THEN daily_count + 1
      ELSE 1
    END,
    reset_date = CURRENT_DATE
  WHERE id = 1
  RETURNING daily_count INTO new_count;

  RETURN new_count;
END;
$$;
