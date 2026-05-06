-- ─── Telegram catalog insert helper ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bot_add_user_food(
  p_chat_id            BIGINT,
  p_nombre             TEXT,
  p_kcal_100g          NUMERIC,
  p_proteinas_100g     NUMERIC,
  p_grasas_100g        NUMERIC,
  p_carbohidratos_100g NUMERIC,
  p_fibra_100g         NUMERIC DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_food_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.bot_sessions
  WHERE chat_id = p_chat_id;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.alimentos_usuario (
    user_id,
    nombre,
    kcal_100g,
    proteinas_100g,
    grasas_100g,
    carbohidratos_100g,
    fibra_100g
  ) VALUES (
    v_user_id,
    p_nombre,
    GREATEST(COALESCE(p_kcal_100g, 0), 0),
    GREATEST(COALESCE(p_proteinas_100g, 0), 0),
    GREATEST(COALESCE(p_grasas_100g, 0), 0),
    GREATEST(COALESCE(p_carbohidratos_100g, 0), 0),
    GREATEST(COALESCE(p_fibra_100g, 0), 0)
  )
  RETURNING id INTO v_food_id;

  RETURN v_food_id;
END;
$$;
