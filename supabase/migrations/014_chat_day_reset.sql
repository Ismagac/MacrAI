-- "Nuevo día" desde el chat: corta el contexto de comida activa en ese instante.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chat_day_reset_at TIMESTAMPTZ;
