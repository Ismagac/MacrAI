-- Update bot_add_user_food to support per-unit macros
CREATE OR REPLACE FUNCTION public.bot_add_user_food(
  p_chat_id            BIGINT,
  p_nombre             TEXT,
  p_kcal_100g          NUMERIC,
  p_proteinas_100g     NUMERIC,
  p_grasas_100g        NUMERIC,
  p_carbohidratos_100g NUMERIC,
  p_fibra_100g         NUMERIC DEFAULT 0,
  p_macros_basis       TEXT DEFAULT 'per_100g',
  p_unit_name          TEXT DEFAULT NULL,
  p_kcal_per_unit      NUMERIC DEFAULT NULL,
  p_proteinas_per_unit NUMERIC DEFAULT NULL,
  p_grasas_per_unit    NUMERIC DEFAULT NULL,
  p_carbohidratos_per_unit NUMERIC DEFAULT NULL
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
    fibra_100g,
    macros_basis,
    unit_name,
    kcal_per_unit,
    proteinas_per_unit,
    grasas_per_unit,
    carbohidratos_per_unit
  ) VALUES (
    v_user_id,
    p_nombre,
    GREATEST(COALESCE(p_kcal_100g, 0), 0),
    GREATEST(COALESCE(p_proteinas_100g, 0), 0),
    GREATEST(COALESCE(p_grasas_100g, 0), 0),
    GREATEST(COALESCE(p_carbohidratos_100g, 0), 0),
    GREATEST(COALESCE(p_fibra_100g, 0), 0),
    COALESCE(p_macros_basis, 'per_100g'),
    p_unit_name,
    GREATEST(COALESCE(p_kcal_per_unit, 0), 0),
    GREATEST(COALESCE(p_proteinas_per_unit, 0), 0),
    GREATEST(COALESCE(p_grasas_per_unit, 0), 0),
    GREATEST(COALESCE(p_carbohidratos_per_unit, 0), 0)
  )
  RETURNING id INTO v_food_id;

  RETURN v_food_id;
END;
$$;
