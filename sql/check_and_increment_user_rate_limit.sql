CREATE OR REPLACE FUNCTION check_and_increment_user_rate_limit(
  p_user_id bigint,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
) AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
  v_window_start timestamptz;
  v_reset_at timestamptz;
BEGIN
  INSERT INTO rate_limits (user_id, request_count, window_start)
  VALUES (p_user_id, 0, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT request_count, window_start
  INTO v_count, v_window_start
  FROM rate_limits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_window_start IS NULL OR v_now - v_window_start > make_interval(secs => p_window_seconds) THEN
    UPDATE rate_limits
    SET request_count = 1,
        window_start = v_now
    WHERE user_id = p_user_id;

    RETURN QUERY
    SELECT true, GREATEST(p_limit - 1, 0), v_now + make_interval(secs => p_window_seconds);
    RETURN;
  END IF;

  v_reset_at := v_window_start + make_interval(secs => p_window_seconds);

  IF v_count >= p_limit THEN
    RETURN QUERY
    SELECT false, 0, v_reset_at;
    RETURN;
  END IF;

  UPDATE rate_limits
  SET request_count = request_count + 1
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT true, p_limit - (v_count + 1), v_reset_at;
END;
$$ LANGUAGE plpgsql;
