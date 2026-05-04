-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends auth.users with physical profile data used for TDEE calculation.

CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT,
  avatar_url    TEXT,
  peso_kg       NUMERIC(5, 2),
  altura_cm     NUMERIC(5, 1),
  edad          INTEGER,
  sexo          TEXT CHECK (sexo IN ('hombre', 'mujer', 'otro')),
  nivel_actividad TEXT CHECK (nivel_actividad IN (
    'sedentario', 'ligero', 'moderado', 'activo', 'muy_activo'
  )),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile row on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
