-- BYOK: clave LLM propia por usuario (cifrada en la app, nunca en claro)

CREATE TABLE IF NOT EXISTS public.user_llm_keys (
  user_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('groq', 'gemini', 'openrouter', 'xai')),
  api_key_enc TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_llm_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_llm_keys_select_own" ON public.user_llm_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_llm_keys_insert_own" ON public.user_llm_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_llm_keys_update_own" ON public.user_llm_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_llm_keys_delete_own" ON public.user_llm_keys
  FOR DELETE USING (auth.uid() = user_id);

-- El bot de Telegram opera con anon key: resuelve la clave del usuario vinculado vía RPC
CREATE OR REPLACE FUNCTION public.bot_get_llm_key(p_chat_id BIGINT)
RETURNS TABLE (provider TEXT, api_key_enc TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT k.provider, k.api_key_enc
  FROM public.user_llm_keys k
  JOIN public.bot_sessions s ON s.user_id = k.user_id
  WHERE s.chat_id = p_chat_id;
END;
$$;
