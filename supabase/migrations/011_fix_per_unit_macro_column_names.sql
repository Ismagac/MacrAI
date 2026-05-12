-- Align per-unit macro column names with the application code.
-- Earlier migrations created these columns in English, while the app and bot
-- read and write the Spanish names below.

ALTER TABLE public.alimentos_usuario
  RENAME COLUMN IF EXISTS proteins_per_unit TO proteinas_per_unit;

ALTER TABLE public.alimentos_usuario
  RENAME COLUMN IF EXISTS fats_per_unit TO grasas_per_unit;

ALTER TABLE public.alimentos_usuario
  RENAME COLUMN IF EXISTS carbs_per_unit TO carbohidratos_per_unit;

ALTER TABLE public.alimentos_usuario
  RENAME COLUMN IF EXISTS calories_per_unit TO kcal_per_unit;

ALTER TABLE public.alimentos_global
  RENAME COLUMN IF EXISTS proteins_per_unit TO proteinas_per_unit;

ALTER TABLE public.alimentos_global
  RENAME COLUMN IF EXISTS fats_per_unit TO grasas_per_unit;

ALTER TABLE public.alimentos_global
  RENAME COLUMN IF EXISTS carbs_per_unit TO carbohidratos_per_unit;

ALTER TABLE public.alimentos_global
  RENAME COLUMN IF EXISTS calories_per_unit TO kcal_per_unit;