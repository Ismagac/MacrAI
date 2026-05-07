-- Add support for per-unit macros in user catalog
ALTER TABLE alimentos_usuario ADD COLUMN macros_basis TEXT DEFAULT 'per_100g' CHECK (macros_basis IN ('per_100g', 'per_unit'));
ALTER TABLE alimentos_usuario ADD COLUMN unit_name TEXT;

-- When per_unit is selected, store per-unit values
ALTER TABLE alimentos_usuario ADD COLUMN proteins_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_usuario ADD COLUMN fats_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_usuario ADD COLUMN carbs_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_usuario ADD COLUMN calories_per_unit DECIMAL(7, 1);

-- Add support in global food database
ALTER TABLE alimentos_global ADD COLUMN macros_basis TEXT DEFAULT 'per_100g' CHECK (macros_basis IN ('per_100g', 'per_unit'));
ALTER TABLE alimentos_global ADD COLUMN unit_name TEXT;
ALTER TABLE alimentos_global ADD COLUMN proteins_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_global ADD COLUMN fats_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_global ADD COLUMN carbs_per_unit DECIMAL(5, 1);
ALTER TABLE alimentos_global ADD COLUMN calories_per_unit DECIMAL(7, 1);

-- Track macro basis in consumos for accurate calculations
ALTER TABLE consumos ADD COLUMN macros_basis TEXT DEFAULT 'per_100g' CHECK (macros_basis IN ('per_100g', 'per_unit'));
ALTER TABLE consumos ADD COLUMN cantidad_unit INTEGER DEFAULT 1; -- For per_unit basis, qty of units (e.g., 2 = 2 ice creams)

-- Helper function to calculate macros based on basis type
CREATE OR REPLACE FUNCTION calculate_macros_from_consumo(
  p_proteins_per_100 DECIMAL,
  p_fats_per_100 DECIMAL,
  p_carbs_per_100 DECIMAL,
  p_quantity_grams DECIMAL,
  p_proteins_per_unit DECIMAL,
  p_fats_per_unit DECIMAL,
  p_carbs_per_unit DECIMAL,
  p_cantidad_unit INTEGER,
  p_macros_basis TEXT
) RETURNS TABLE (proteins DECIMAL, fats DECIMAL, carbs DECIMAL) AS $$
BEGIN
  IF p_macros_basis = 'per_unit' THEN
    RETURN QUERY SELECT
      p_proteins_per_unit * p_cantidad_unit,
      p_fats_per_unit * p_cantidad_unit,
      p_carbs_per_unit * p_cantidad_unit;
  ELSE
    -- per_100g basis
    RETURN QUERY SELECT
      (p_proteins_per_100 * p_quantity_grams) / 100,
      (p_fats_per_100 * p_quantity_grams) / 100,
      (p_carbs_per_100 * p_quantity_grams) / 100;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
