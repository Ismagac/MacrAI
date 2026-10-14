-- Modelo de datos de la app Android (docs/migracion-android.md, §5).
-- Todo es aditivo: la web y el bot de Telegram siguen funcionando con las columnas de antes.

-- ─── Catálogo: de dónde sale cada valor y cómo se aplica (§5, §6, §7 del comportamiento) ──

ALTER TABLE public.alimentos_usuario
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS fuente TEXT NOT NULL DEFAULT 'estimacion'
    CHECK (fuente IN ('etiqueta', 'usuario', 'web', 'estimacion')),
  -- Solo las kcal son del usuario o de la etiqueta; P/C/G repartidos por tipo de alimento.
  ADD COLUMN IF NOT EXISTS macros_estimados BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT '100g' CHECK (base IN ('100g', '100ml')),
  ADD COLUMN IF NOT EXISTS columna TEXT NOT NULL DEFAULT 'tal_cual'
    CHECK (columna IN ('tal_cual', 'preparado', 'escurrido')),
  ADD COLUMN IF NOT EXISTS peso_unidad_g NUMERIC(7, 1),
  ADD COLUMN IF NOT EXISTS formato_envase TEXT;

CREATE TABLE IF NOT EXISTS public.alimentos_alias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alimento_id UUID NOT NULL REFERENCES public.alimentos_usuario(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, alias)
);

ALTER TABLE public.alimentos_alias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alimentos_alias_all_own" ON public.alimentos_alias
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Consumos: supuestos visibles y día de registro ─────────────────────────────
-- `fecha` pasa a ser el día de registro, que no cambia a medianoche (§2.11): la app lo
-- calcula y lo envía. `hora_insercion` sigue siendo el instante real.

ALTER TABLE public.consumos
  ADD COLUMN IF NOT EXISTS fuente TEXT CHECK (fuente IN ('etiqueta', 'usuario', 'web', 'estimacion')),
  ADD COLUMN IF NOT EXISTS supuestos TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS solo_kcal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cantidad_dicha_gr NUMERIC(7, 1),
  -- Identificador local de la app para sincronizar sin duplicar.
  ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consumos_user_client_id
  ON public.consumos (user_id, client_id) WHERE client_id IS NOT NULL;

-- ─── Peso en ayunas (§9) ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pesajes (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fecha      DATE NOT NULL,
  peso_kg    NUMERIC(5, 2) NOT NULL CHECK (peso_kg > 0),
  fuente     TEXT NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual', 'health_connect')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, fecha)
);

ALTER TABLE public.pesajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pesajes_all_own" ON public.pesajes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Gasto del reloj (§10) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gasto_diario (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fecha      DATE NOT NULL,
  kcal_total NUMERIC(7, 1) NOT NULL CHECK (kcal_total >= 0),
  pasos      INTEGER,
  fuente     TEXT NOT NULL CHECK (fuente IN ('health_connect', 'captura', 'manual')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, fecha)
);

ALTER TABLE public.gasto_diario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gasto_diario_all_own" ON public.gasto_diario
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Estado del día y contexto personal (§13, §15) ──────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dia_abierto DATE,
  -- NULL = el usuario ha relajado el objetivo y el balance no muestra esas columnas.
  ADD COLUMN IF NOT EXISTS deficit_objetivo_kcal NUMERIC(6, 1) DEFAULT 500,
  ADD COLUMN IF NOT EXISTS proteina_g_por_kg NUMERIC(3, 2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS lesion_activa TEXT;

CREATE TABLE IF NOT EXISTS public.dias_cerrados (
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fecha     DATE NOT NULL,
  cerrado_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, fecha)
);

ALTER TABLE public.dias_cerrados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dias_cerrados_all_own" ON public.dias_cerrados
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
