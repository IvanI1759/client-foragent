CREATE OR REPLACE FUNCTION reserve_global_api_call(
  p_limit integer
) RETURNS TABLE (
  allowed boolean,
  count integer,
  reset_date date
) AS $$
DECLARE
  v_count integer;
  v_reset_date date;
BEGIN
  UPDATE global_api_counter AS g
  SET daily_count = CASE
        WHEN g.reset_date = CURRENT_DATE THEN g.daily_count
        ELSE 0
      END,
      reset_date = CURRENT_DATE
  WHERE g.id = 1;

  UPDATE global_api_counter AS g
  SET daily_count = g.daily_count + 1
  WHERE g.id = 1
    AND g.daily_count < p_limit
  RETURNING g.daily_count, g.reset_date
  INTO v_count, v_reset_date;

  IF v_count IS NULL THEN
    RETURN QUERY
    SELECT false, g.daily_count, g.reset_date
    FROM global_api_counter AS g
    WHERE g.id = 1;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, v_count, v_reset_date;
END;
$$ LANGUAGE plpgsql;
