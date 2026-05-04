-- ─── Global food database (admin-managed) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.alimentos_global (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  kcal_100g       NUMERIC(7, 2) NOT NULL DEFAULT 0,
  proteinas_100g  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  grasas_100g     NUMERIC(6, 2) NOT NULL DEFAULT 0,
  carbohidratos_100g NUMERIC(6, 2) NOT NULL DEFAULT 0,
  fibra_100g      NUMERIC(6, 2) DEFAULT 0,
  categoria       TEXT,
  source          TEXT DEFAULT 'supabase',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- GIN trigram index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_alimentos_global_nombre_trgm
  ON public.alimentos_global USING GIN (nombre gin_trgm_ops);

-- RLS: anyone authenticated can read; only service role can write
ALTER TABLE public.alimentos_global ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alimentos_global_select" ON public.alimentos_global
  FOR SELECT TO authenticated USING (true);


-- ─── User private food catalogue ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.alimentos_usuario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  kcal_100g       NUMERIC(7, 2) NOT NULL DEFAULT 0,
  proteinas_100g  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  grasas_100g     NUMERIC(6, 2) NOT NULL DEFAULT 0,
  carbohidratos_100g NUMERIC(6, 2) NOT NULL DEFAULT 0,
  fibra_100g      NUMERIC(6, 2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- GIN trigram index for user foods too
CREATE INDEX IF NOT EXISTS idx_alimentos_usuario_nombre_trgm
  ON public.alimentos_usuario USING GIN (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_alimentos_usuario_user_id
  ON public.alimentos_usuario (user_id);

ALTER TABLE public.alimentos_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alimentos_usuario_select_own" ON public.alimentos_usuario
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "alimentos_usuario_insert_own" ON public.alimentos_usuario
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "alimentos_usuario_update_own" ON public.alimentos_usuario
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "alimentos_usuario_delete_own" ON public.alimentos_usuario
  FOR DELETE USING (auth.uid() = user_id);
