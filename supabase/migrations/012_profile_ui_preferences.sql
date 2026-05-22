-- Persist UI appearance preferences per user profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_mode TEXT
    CHECK (theme_mode IN ('light', 'dark', 'system'))
    DEFAULT 'system';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accent_theme TEXT
    CHECK (accent_theme IN ('green', 'lilac', 'pink', 'sky', 'amber'))
    DEFAULT 'green';
