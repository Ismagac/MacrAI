-- ─── Objetivos (nutrition goals) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.objetivos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  periodo               TEXT NOT NULL CHECK (periodo IN ('diario', 'semanal', 'mensual')),
  fecha_inicio          DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin             DATE,
  kcal_objetivo         NUMERIC(8, 2) NOT NULL DEFAULT 2000,
  proteinas_objetivo    NUMERIC(7, 2) NOT NULL DEFAULT 150,
  grasas_objetivo       NUMERIC(7, 2) NOT NULL DEFAULT 65,
  carbohidratos_objetivo NUMERIC(7, 2) NOT NULL DEFAULT 250,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objetivos_user_activo
  ON public.objetivos (user_id, activo, periodo);

ALTER TABLE public.objetivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objetivos_select_own" ON public.objetivos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "objetivos_insert_own" ON public.objetivos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "objetivos_update_own" ON public.objetivos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "objetivos_delete_own" ON public.objetivos
  FOR DELETE USING (auth.uid() = user_id);
