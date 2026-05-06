-- ─── Telegram: search and edit daily logs ───────────────────────────────────

-- Search foods with same priority as app: user catalog + global catalog.
CREATE OR REPLACE FUNCTION public.bot_search_foods(
  p_chat_id BIGINT,
  p_query   TEXT,
  p_limit   INTEGER DEFAULT 8
)
RETURNS TABLE (
  id               TEXT,
  nombre           TEXT,
  kcal_100g        NUMERIC,
  proteinas_100g   NUMERIC,
  carbohidratos_100g NUMERIC,
  grasas_100g      NUMERIC,
  fibra_100g       NUMERIC,
  source           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.bot_sessions
  WHERE chat_id = p_chat_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH usr AS (
    SELECT
      a.id::TEXT,
      a.nombre,
      a.kcal_100g,
      a.proteinas_100g,
      a.carbohidratos_100g,
      a.grasas_100g,
      COALESCE(a.fibra_100g, 0) AS fibra_100g,
      'usuario'::TEXT AS source,
      1 AS src_order
    FROM public.alimentos_usuario a
    WHERE a.user_id = v_user_id
      AND a.nombre ILIKE '%' || p_query || '%'
    ORDER BY a.nombre
    LIMIT GREATEST(p_limit, 1)
  ),
  glb AS (
    SELECT
      g.id::TEXT,
      g.nombre,
      g.kcal_100g,
      g.proteinas_100g,
      g.carbohidratos_100g,
      g.grasas_100g,
      COALESCE(g.fibra_100g, 0) AS fibra_100g,
      'global'::TEXT AS source,
      2 AS src_order
    FROM public.alimentos_global g
    WHERE g.nombre ILIKE '%' || p_query || '%'
    ORDER BY g.nombre
    LIMIT GREATEST(p_limit, 1)
  ),
  merged AS (
    SELECT * FROM usr
    UNION ALL
    SELECT * FROM glb
  )
  SELECT
    m.id,
    m.nombre,
    m.kcal_100g,
    m.proteinas_100g,
    m.carbohidratos_100g,
    m.grasas_100g,
    m.fibra_100g,
    m.source
  FROM merged m
  ORDER BY m.src_order, m.nombre
  LIMIT GREATEST(p_limit * 2, 1);
END;
$$;

-- List today's entries for quick correction of quantity.
CREATE OR REPLACE FUNCTION public.bot_list_today_consumos(
  p_chat_id BIGINT
)
RETURNS TABLE (
  id              UUID,
  nombre_alimento TEXT,
  cantidad_gr     NUMERIC,
  kcal            NUMERIC,
  proteinas       NUMERIC,
  carbohidratos   NUMERIC,
  grasas          NUMERIC,
  hora_insercion  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.bot_sessions
  WHERE chat_id = p_chat_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.nombre_alimento,
    c.cantidad_gr,
    c.kcal,
    c.proteinas,
    c.carbohidratos,
    c.grasas,
    c.hora_insercion
  FROM public.consumos c
  WHERE c.user_id = v_user_id
    AND c.fecha = CURRENT_DATE
  ORDER BY c.hora_insercion DESC
  LIMIT 20;
END;
$$;

-- Update quantity of a daily consumo and scale its macros proportionally.
CREATE OR REPLACE FUNCTION public.bot_update_consumo_qty(
  p_chat_id     BIGINT,
  p_consumo_id  UUID,
  p_new_qty     NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_old_qty NUMERIC;
BEGIN
  SELECT user_id INTO v_user_id
  FROM public.bot_sessions
  WHERE chat_id = p_chat_id;

  IF v_user_id IS NULL OR p_new_qty IS NULL OR p_new_qty <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT c.cantidad_gr INTO v_old_qty
  FROM public.consumos c
  WHERE c.id = p_consumo_id
    AND c.user_id = v_user_id;

  IF v_old_qty IS NULL OR v_old_qty <= 0 THEN
    RETURN NULL;
  END IF;

  UPDATE public.consumos c
  SET
    cantidad_gr = p_new_qty,
    kcal = ROUND((c.kcal / v_old_qty) * p_new_qty, 2),
    proteinas = ROUND((c.proteinas / v_old_qty) * p_new_qty, 2),
    grasas = ROUND((c.grasas / v_old_qty) * p_new_qty, 2),
    carbohidratos = ROUND((c.carbohidratos / v_old_qty) * p_new_qty, 2),
    fibra = ROUND((COALESCE(c.fibra, 0) / v_old_qty) * p_new_qty, 2)
  WHERE c.id = p_consumo_id
    AND c.user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN p_consumo_id;
END;
$$;
