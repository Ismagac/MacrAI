-- ─── Telegram Integration ────────────────────────────────────────────────────

-- Add Telegram fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id         BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_link_code       TEXT,
  ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at TIMESTAMPTZ;

-- ─── Bot Sessions ─────────────────────────────────────────────────────────────
-- Stores conversation state per Telegram chat (serverless-safe)

CREATE TABLE IF NOT EXISTS public.bot_sessions (
  chat_id     BIGINT      PRIMARY KEY,
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  state       JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;
-- No user-facing policies needed: all access via SECURITY DEFINER functions below

-- ─── SECURITY DEFINER helper functions ───────────────────────────────────────
-- These run with elevated privileges so the bot (anon key) can access data.

-- 1. Verify a link code and associate telegram_chat_id with the profile
CREATE OR REPLACE FUNCTION public.verify_telegram_link(
  p_code    TEXT,
  p_chat_id BIGINT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE telegram_link_code = p_code
    AND telegram_link_code_expires_at > NOW();

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles
  SET
    telegram_chat_id                  = p_chat_id,
    telegram_link_code                = NULL,
    telegram_link_code_expires_at     = NULL
  WHERE id = v_user_id;

  INSERT INTO public.bot_sessions (chat_id, user_id, state)
  VALUES (p_chat_id, v_user_id, '{}')
  ON CONFLICT (chat_id) DO UPDATE
    SET user_id = v_user_id, updated_at = NOW();

  RETURN v_user_id;
END;
$$;

-- 2. Get conversation session state for a chat_id
CREATE OR REPLACE FUNCTION public.bot_get_session(p_chat_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_state JSONB;
BEGIN
  SELECT state INTO v_state FROM public.bot_sessions WHERE chat_id = p_chat_id;
  RETURN COALESCE(v_state, '{}'::JSONB);
END;
$$;

-- 3. Set (upsert) conversation session state
CREATE OR REPLACE FUNCTION public.bot_set_session(
  p_chat_id BIGINT,
  p_state   JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.bot_sessions
  SET state = p_state, updated_at = NOW()
  WHERE chat_id = p_chat_id;
END;
$$;

-- 4. Resolve user_id from chat_id
CREATE OR REPLACE FUNCTION public.bot_get_user_id(p_chat_id BIGINT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  RETURN v_user_id;
END;
$$;

-- 5. Get today's macro totals for a telegram user
CREATE OR REPLACE FUNCTION public.bot_get_macros_today(p_chat_id BIGINT)
RETURNS TABLE (
  kcal          NUMERIC,
  proteinas     NUMERIC,
  carbohidratos NUMERIC,
  grasas        NUMERIC,
  fibra         NUMERIC,
  num_entradas  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ROUND(COALESCE(SUM(c.kcal), 0), 1)          AS kcal,
    ROUND(COALESCE(SUM(c.proteinas), 0), 1)      AS proteinas,
    ROUND(COALESCE(SUM(c.carbohidratos), 0), 1)  AS carbohidratos,
    ROUND(COALESCE(SUM(c.grasas), 0), 1)         AS grasas,
    ROUND(COALESCE(SUM(c.fibra), 0), 1)          AS fibra,
    COUNT(*)                                      AS num_entradas
  FROM public.consumos c
  WHERE c.user_id = v_user_id
    AND c.fecha = CURRENT_DATE;
END;
$$;

-- 6. Log a consumo on behalf of a telegram user
CREATE OR REPLACE FUNCTION public.bot_log_consumo(
  p_chat_id         BIGINT,
  p_nombre          TEXT,
  p_cantidad_gr     NUMERIC,
  p_kcal            NUMERIC,
  p_proteinas       NUMERIC,
  p_grasas          NUMERIC,
  p_carbohidratos   NUMERIC,
  p_fibra           NUMERIC,
  p_tipo_comida     TEXT,
  p_numero_comida   INTEGER,
  p_alimento_source TEXT DEFAULT 'manual'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_new_id   UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.consumos (
    user_id, alimento_source, nombre_alimento, cantidad_gr,
    kcal, proteinas, grasas, carbohidratos, fibra,
    fecha, tipo_comida, numero_comida
  ) VALUES (
    v_user_id, p_alimento_source, p_nombre, p_cantidad_gr,
    p_kcal, p_proteinas, p_grasas, p_carbohidratos, p_fibra,
    CURRENT_DATE, p_tipo_comida, p_numero_comida
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- 7. Get last 7 days daily kcal totals for a telegram user
CREATE OR REPLACE FUNCTION public.bot_get_history(p_chat_id BIGINT)
RETURNS TABLE (
  fecha         DATE,
  kcal          NUMERIC,
  proteinas     NUMERIC,
  carbohidratos NUMERIC,
  grasas        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    c.fecha,
    ROUND(SUM(c.kcal), 0)          AS kcal,
    ROUND(SUM(c.proteinas), 0)     AS proteinas,
    ROUND(SUM(c.carbohidratos), 0) AS carbohidratos,
    ROUND(SUM(c.grasas), 0)        AS grasas
  FROM public.consumos c
  WHERE c.user_id = v_user_id
    AND c.fecha >= CURRENT_DATE - INTERVAL '6 days'
  GROUP BY c.fecha
  ORDER BY c.fecha DESC;
END;
$$;

-- 8. Get user's personal food catalog
CREATE OR REPLACE FUNCTION public.bot_get_user_foods(p_chat_id BIGINT)
RETURNS TABLE (
  id              UUID,
  nombre          TEXT,
  kcal_100g       NUMERIC,
  proteinas_100g  NUMERIC,
  carbohidratos_100g NUMERIC,
  grasas_100g     NUMERIC,
  fibra_100g      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.nombre, a.kcal_100g, a.proteinas_100g,
         a.carbohidratos_100g, a.grasas_100g, a.fibra_100g
  FROM public.alimentos_usuario a
  WHERE a.user_id = v_user_id
  ORDER BY a.nombre
  LIMIT 20;
END;
$$;

-- 9. Unlink telegram account
CREATE OR REPLACE FUNCTION public.bot_unlink_telegram(p_chat_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET telegram_chat_id = NULL
  WHERE telegram_chat_id = p_chat_id;

  DELETE FROM public.bot_sessions WHERE chat_id = p_chat_id;
END;
$$;

-- 10. Get active daily objective for a telegram user
CREATE OR REPLACE FUNCTION public.bot_get_objetivo(p_chat_id BIGINT)
RETURNS TABLE (
  kcal          NUMERIC,
  proteinas     NUMERIC,
  carbohidratos NUMERIC,
  grasas        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.bot_sessions WHERE chat_id = p_chat_id;
  IF v_user_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT o.kcal, o.proteinas, o.carbohidratos, o.grasas
  FROM public.objetivos o
  WHERE o.user_id = v_user_id
    AND o.periodo = 'diario'
    AND o.activo = TRUE
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;
