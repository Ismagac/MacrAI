-- Align per-unit macro column names with the application code.
-- Earlier migrations created these columns in English, while the app and bot
-- read and write the Spanish names below.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_usuario'
      AND column_name = 'proteins_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_usuario
      RENAME COLUMN proteins_per_unit TO proteinas_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_usuario'
      AND column_name = 'fats_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_usuario
      RENAME COLUMN fats_per_unit TO grasas_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_usuario'
      AND column_name = 'carbs_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_usuario
      RENAME COLUMN carbs_per_unit TO carbohidratos_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_usuario'
      AND column_name = 'calories_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_usuario
      RENAME COLUMN calories_per_unit TO kcal_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_global'
      AND column_name = 'proteins_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_global
      RENAME COLUMN proteins_per_unit TO proteinas_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_global'
      AND column_name = 'fats_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_global
      RENAME COLUMN fats_per_unit TO grasas_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_global'
      AND column_name = 'carbs_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_global
      RENAME COLUMN carbs_per_unit TO carbohidratos_per_unit;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alimentos_global'
      AND column_name = 'calories_per_unit'
  ) THEN
    ALTER TABLE public.alimentos_global
      RENAME COLUMN calories_per_unit TO kcal_per_unit;
  END IF;
END $$;