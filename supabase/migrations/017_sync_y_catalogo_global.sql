-- Sincronización de la app Android y catálogo global de productos.
-- Ver docs/migracion-android.md (§4 y §5.2). Requiere las migraciones 015 y 016.

-- ─── updated_at automático en todo lo que se sincroniza ─────────────────────────
-- La app baja "lo que cambió desde la última vez" filtrando por updated_at.

CREATE OR REPLACE FUNCTION public.tocar_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

ALTER TABLE public.consumos
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.dias_cerrados
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.alimentos_usuario SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
UPDATE public.pesajes SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE public.gasto_diario SET updated_at = NOW() WHERE updated_at IS NULL;
UPDATE public.profiles SET updated_at = NOW() WHERE updated_at IS NULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['consumos', 'alimentos_usuario', 'pesajes', 'gasto_diario', 'dias_cerrados', 'profiles']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tocar_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER tocar_updated_at BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at()',
      t
    );
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_consumos_sync ON public.consumos (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_alimentos_usuario_sync ON public.alimentos_usuario (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pesajes_sync ON public.pesajes (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_gasto_diario_sync ON public.gasto_diario (user_id, updated_at);

-- ─── Borrados ───────────────────────────────────────────────────────────────────
-- Los registros se borran de verdad (la web no ve fantasmas) y aquí queda constancia para
-- que los demás móviles de la cuenta también los quiten.

CREATE TABLE IF NOT EXISTS public.sync_borrados (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tabla      TEXT NOT NULL,
  clave      TEXT NOT NULL,
  borrado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tabla, clave)
);

CREATE INDEX IF NOT EXISTS idx_sync_borrados ON public.sync_borrados (user_id, borrado_at);

ALTER TABLE public.sync_borrados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_borrados_all_own" ON public.sync_borrados
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.tocar_borrado_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.borrado_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tocar_borrado_at ON public.sync_borrados;
CREATE TRIGGER tocar_borrado_at BEFORE INSERT OR UPDATE ON public.sync_borrados
  FOR EACH ROW EXECUTE FUNCTION public.tocar_borrado_at();

-- ─── Catálogo global ────────────────────────────────────────────────────────────
-- Productos de supermercado importados por scripts/catalogo (nombre, EAN, formato, foto,
-- precio) con la nutrición de Open Food Facts, y etiquetas aportadas por los usuarios.
-- Lo escribe el importador con la service role; los usuarios solo leen y aportan vía RPC.

ALTER TABLE public.alimentos_global
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS codigo_barras TEXT,
  ADD COLUMN IF NOT EXISTS supermercado TEXT,
  ADD COLUMN IF NOT EXISTS id_externo TEXT,
  ADD COLUMN IF NOT EXISTS formato TEXT,
  ADD COLUMN IF NOT EXISTS foto_url TEXT,
  ADD COLUMN IF NOT EXISTS precio NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT '100g' CHECK (base IN ('100g', '100ml')),
  -- Sin tabla nutricional el producto se conoce, pero no sirve para registrar.
  ADD COLUMN IF NOT EXISTS con_nutricion BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fuente_nutricion TEXT CHECK (fuente_nutricion IN ('off', 'supermercado', 'usuarios')),
  ADD COLUMN IF NOT EXISTS aportaciones INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Índice único sin predicado: PostgREST hace upsert por codigo_barras y no sabe inferir
-- índices parciales. Los NULL no chocan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alimentos_global_barcode ON public.alimentos_global (codigo_barras);

CREATE INDEX IF NOT EXISTS idx_alimentos_global_externo ON public.alimentos_global (supermercado, id_externo);

DROP TRIGGER IF EXISTS tocar_updated_at ON public.alimentos_global;
CREATE TRIGGER tocar_updated_at BEFORE INSERT OR UPDATE ON public.alimentos_global
  FOR EACH ROW EXECUTE FUNCTION public.tocar_updated_at();

-- La app busca productos también sin cuenta.
DROP POLICY IF EXISTS "alimentos_global_select_anon" ON public.alimentos_global;
CREATE POLICY "alimentos_global_select_anon" ON public.alimentos_global
  FOR SELECT TO anon USING (TRUE);

CREATE OR REPLACE FUNCTION public.buscar_alimentos_global(p_query TEXT, p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.alimentos_global
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT g.*
  FROM public.alimentos_global g
  WHERE g.con_nutricion
    AND (
      g.nombre % p_query
      OR (COALESCE(g.marca, '') || ' ' || g.nombre) % p_query
      OR g.nombre ILIKE '%' || p_query || '%'
    )
  ORDER BY GREATEST(
    similarity(g.nombre, p_query),
    similarity(COALESCE(g.marca, '') || ' ' || g.nombre, p_query)
  ) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.buscar_alimentos_global(TEXT, INTEGER) TO anon, authenticated;

-- Etiqueta fotografiada por un usuario: rellena productos sin nutrición o crea uno nuevo.
-- Nunca pisa datos de Open Food Facts ni del supermercado, y descarta valores que no cuadran.
CREATE OR REPLACE FUNCTION public.aportar_etiqueta(
  p_codigo_barras  TEXT,
  p_nombre         TEXT,
  p_marca          TEXT,
  p_kcal           NUMERIC,
  p_proteinas      NUMERIC,
  p_carbohidratos  NUMERIC,
  p_grasas         NUMERIC,
  p_base           TEXT DEFAULT '100g'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Hace falta iniciar sesión';
  END IF;
  IF p_codigo_barras IS NULL OR p_codigo_barras !~ '^[0-9]{8,14}$' THEN RETURN; END IF;
  IF p_kcal IS NULL OR p_kcal < 0 OR p_kcal > 900 THEN RETURN; END IF;
  IF p_proteinas < 0 OR p_carbohidratos < 0 OR p_grasas < 0
     OR p_proteinas + p_carbohidratos + p_grasas > 100 THEN RETURN; END IF;
  -- kcal ≈ 4P + 4C + 9G con un margen algo mayor que el de la app (fibra, polialcoholes).
  IF p_kcal > 0 AND ABS(4 * p_proteinas + 4 * p_carbohidratos + 9 * p_grasas - p_kcal) / p_kcal > 0.15 THEN RETURN; END IF;

  INSERT INTO public.alimentos_global (
    nombre, marca, codigo_barras, kcal_100g, proteinas_100g, carbohidratos_100g, grasas_100g,
    base, con_nutricion, fuente_nutricion, aportaciones, source
  ) VALUES (
    p_nombre, p_marca, p_codigo_barras, p_kcal, p_proteinas, p_carbohidratos, p_grasas,
    CASE WHEN p_base = '100ml' THEN '100ml' ELSE '100g' END, TRUE, 'usuarios', 1, 'usuarios'
  )
  ON CONFLICT (codigo_barras) WHERE codigo_barras IS NOT NULL DO UPDATE SET
    kcal_100g          = EXCLUDED.kcal_100g,
    proteinas_100g     = EXCLUDED.proteinas_100g,
    carbohidratos_100g = EXCLUDED.carbohidratos_100g,
    grasas_100g        = EXCLUDED.grasas_100g,
    base               = EXCLUDED.base,
    con_nutricion      = TRUE,
    fuente_nutricion   = 'usuarios',
    aportaciones       = public.alimentos_global.aportaciones + 1
  WHERE NOT public.alimentos_global.con_nutricion
     OR public.alimentos_global.fuente_nutricion = 'usuarios';
END;
$$;

REVOKE ALL ON FUNCTION public.aportar_etiqueta(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aportar_etiqueta(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ─── Borrar la cuenta (requisito de Google Play) ────────────────────────────────
-- Borra el usuario de Auth; profiles y todos sus datos caen en cascada.

CREATE OR REPLACE FUNCTION public.borrar_mi_cuenta()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Hace falta iniciar sesión';
  END IF;
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.borrar_mi_cuenta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.borrar_mi_cuenta() TO authenticated;
