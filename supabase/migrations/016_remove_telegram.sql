-- Telegram deja de existir: el registro se hace desde la app Android.
-- Borra el bot (sesiones, funciones SECURITY DEFINER y vínculos del perfil).
-- Las funciones bot_* tienen varias sobrecargas según la migración que las creó,
-- así que se eliminan todas por nombre en lugar de firma a firma.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'bot\_%' OR p.proname = 'verify_telegram_link')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END;
$$;

DROP TABLE IF EXISTS public.bot_sessions;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS telegram_chat_id,
  DROP COLUMN IF EXISTS telegram_link_code,
  DROP COLUMN IF EXISTS telegram_link_code_expires_at;
