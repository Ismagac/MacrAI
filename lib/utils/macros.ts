import type { ActivityLevel, FoodItem, MacrosSummary, Profile, Sexo, TDEEResult } from '@/types'

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentario: 1.2,
  ligero: 1.375,
  moderado: 1.55,
  activo: 1.725,
  muy_activo: 1.9,
}

export function calcBMR(
  peso_kg: number,
  altura_cm: number,
  edad: number,
  sexo: Sexo
): number {
  // Mifflin-St Jeor
  const base = 10 * peso_kg + 6.25 * altura_cm - 5 * edad
  return sexo === 'hombre' ? base + 5 : base - 161
}

export function calcTDEE(profile: Profile): TDEEResult | null {
  const { peso_kg, altura_cm, edad, sexo, nivel_actividad } = profile
  if (!peso_kg || !altura_cm || !edad || !sexo || !nivel_actividad) return null

  const bmr = calcBMR(peso_kg, altura_cm, edad, sexo)
  const factorActividad = ACTIVITY_FACTORS[nivel_actividad]
  const tdee = Math.round(bmr * factorActividad)

  return { bmr: Math.round(bmr), tdee, factorActividad }
}

export function calcMacrosFromGrams(
  food: FoodItem,
  cantidad_gr: number
): MacrosSummary {
  const factor = cantidad_gr / 100
  return {
    kcal: Math.round(food.kcal_100g * factor * 10) / 10,
    proteinas: Math.round(food.proteinas_100g * factor * 10) / 10,
    grasas: Math.round(food.grasas_100g * factor * 10) / 10,
    carbohidratos: Math.round(food.carbohidratos_100g * factor * 10) / 10,
    fibra: Math.round((food.fibra_100g ?? 0) * factor * 10) / 10,
  }
}

export function calcMacroPercentages(macros: MacrosSummary) {
  const total =
    macros.proteinas * 4 + macros.carbohidratos * 4 + macros.grasas * 9
  if (total === 0) return { proteinas: 0, carbohidratos: 0, grasas: 0 }
  return {
    proteinas: Math.round((macros.proteinas * 4 * 100) / total),
    carbohidratos: Math.round((macros.carbohidratos * 4 * 100) / total),
    grasas: Math.round((macros.grasas * 9 * 100) / total),
  }
}

export function sumMacros(items: MacrosSummary[]): MacrosSummary {
  return items.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      proteinas: acc.proteinas + m.proteinas,
      grasas: acc.grasas + m.grasas,
      carbohidratos: acc.carbohidratos + m.carbohidratos,
      fibra: acc.fibra + (m.fibra ?? 0),
    }),
    { kcal: 0, proteinas: 0, grasas: 0, carbohidratos: 0, fibra: 0 }
  )
}

export function formatMacro(value: number, decimals = 1): string {
  return value.toFixed(decimals)
}
