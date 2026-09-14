import type { MealType } from '@/types'

// Lógica de "día" del registro de macros, independiente de la superficie
// (chat web, bot de Telegram, o una herramienta expuesta a Gemini).

export const MEAL_ORDER: MealType[] = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro']

// El usuario habla de "media mañana" y "post-cena"; la base de datos guarda
// 'almuerzo' y 'snack'. Las etiquetas viven aquí para no repetirlas.
export const MEAL_LABELS: Record<MealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Media mañana',
  comida: 'Comida',
  merienda: 'Merienda',
  cena: 'Cena',
  snack: 'Post-cena / snack',
  otro: 'Otro',
}

// Ventana en la que un registro reciente mantiene "abierta" su comida.
// Con ella, "añade 50 de pan" tras registrar la comida va a la comida sin preguntar.
export const ACTIVE_MEAL_WINDOW_MS = 90 * 60 * 1000

export type Macros = { kcal: number; proteinas: number; carbohidratos: number; grasas: number }

export type DayEntry = Macros & {
  tipo_comida: MealType
  hora_insercion?: string | null
  created_at?: string | null
}

export type DaySummary = {
  total: Macros
  byMeal: Array<{ meal: MealType; label: string; count: number } & Macros>
  count: number
}

const ZERO: Macros = { kcal: 0, proteinas: 0, carbohidratos: 0, grasas: 0 }

function add(a: Macros, b: Partial<Macros>): Macros {
  return {
    kcal: a.kcal + (b.kcal ?? 0),
    proteinas: a.proteinas + (b.proteinas ?? 0),
    carbohidratos: a.carbohidratos + (b.carbohidratos ?? 0),
    grasas: a.grasas + (b.grasas ?? 0),
  }
}

function round(m: Macros): Macros {
  return {
    kcal: Math.round(m.kcal),
    proteinas: Math.round(m.proteinas * 10) / 10,
    carbohidratos: Math.round(m.carbohidratos * 10) / 10,
    grasas: Math.round(m.grasas * 10) / 10,
  }
}

export function summarizeDay(entries: DayEntry[]): DaySummary {
  const buckets = new Map<MealType, { count: number } & Macros>()
  let total: Macros = ZERO

  for (const e of entries) {
    total = add(total, e)
    const current = buckets.get(e.tipo_comida) ?? { count: 0, ...ZERO }
    buckets.set(e.tipo_comida, { ...add(current, e), count: current.count + 1 })
  }

  const byMeal = MEAL_ORDER.filter((m) => buckets.has(m)).map((meal) => {
    const b = buckets.get(meal)!
    return { meal, label: MEAL_LABELS[meal], count: b.count, ...round(b) }
  })

  return { total: round(total), byMeal, count: entries.length }
}

export type ActiveMeal =
  | { meal: MealType; reason: 'recent' | 'after_reset' }
  | { meal: null; reason: 'none' }

/**
 * Comida activa según la spec: la del último registro si tiene menos de 90 min.
 * Tras un "nuevo día" se ignoran los registros anteriores al corte y se asume
 * desayuno hasta que el usuario diga otra cosa.
 */
export function resolveActiveMeal(
  entries: DayEntry[],
  resetAt?: string | null,
  now: number = Date.now()
): ActiveMeal {
  const resetTs = resetAt ? new Date(resetAt).getTime() : 0

  const latest = entries
    .map((e) => ({ e, ts: new Date(e.hora_insercion ?? e.created_at ?? 0).getTime() }))
    .filter((x) => x.ts > resetTs)
    .sort((a, b) => b.ts - a.ts)[0]

  if (latest && now - latest.ts <= ACTIVE_MEAL_WINDOW_MS) {
    return { meal: latest.e.tipo_comida, reason: 'recent' }
  }

  if (resetTs && now - resetTs <= ACTIVE_MEAL_WINDOW_MS && !latest) {
    return { meal: 'desayuno', reason: 'after_reset' }
  }

  return { meal: null, reason: 'none' }
}

export function describeSummary(summary: DaySummary): string {
  if (summary.count === 0) return 'Hoy no hay nada registrado todavía.'
  const meals = summary.byMeal
    .map((m) => `${m.label}: ${m.kcal} kcal (P ${m.proteinas} / C ${m.carbohidratos} / G ${m.grasas})`)
    .join('; ')
  const t = summary.total
  return `Total del día: ${t.kcal} kcal, ${t.proteinas} g proteína, ${t.carbohidratos} g carbohidratos, ${t.grasas} g grasas. Por comidas — ${meals}.`
}
