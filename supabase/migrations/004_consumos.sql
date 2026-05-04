-- ─── Consumos (daily food log) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.consumos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alimento_ref_id   UUID,       -- optional FK to alimentos_global or alimentos_usuario
  alimento_source   TEXT NOT NULL CHECK (alimento_source IN (
    'usuario', 'global', 'openfoodfacts', 'manual'
  )),
  nombre_alimento   TEXT NOT NULL,
  cantidad_gr       NUMERIC(7, 1) NOT NULL,
  kcal              NUMERIC(8, 2) NOT NULL,
  proteinas         NUMERIC(7, 2) NOT NULL,
  grasas            NUMERIC(7, 2) NOT NULL,
  carbohidratos     NUMERIC(7, 2) NOT NULL,
  fibra             NUMERIC(7, 2) DEFAULT 0,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  hora_insercion    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo_comida       TEXT NOT NULL DEFAULT 'otro' CHECK (tipo_comida IN (
    'desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro'
  )),
  numero_comida     INTEGER NOT NULL DEFAULT 1 CHECK (numero_comida BETWEEN 1 AND 10),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_consumos_user_fecha
  ON public.consumos (user_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_consumos_user_fecha_range
  ON public.consumos (user_id, fecha);

ALTER TABLE public.consumos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumos_select_own" ON public.consumos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "consumos_insert_own" ON public.consumos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumos_update_own" ON public.consumos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "consumos_delete_own" ON public.consumos
  FOR DELETE USING (auth.uid() = user_id);
