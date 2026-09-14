import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcMacros } from '@/lib/utils/macros'
import { summarizeDay, MEAL_ORDER, type DaySummary } from '@/lib/domain/day'
import type { FoodItem, MealType } from '@/types'

// Registro de una entrada en el diario desde el chat.
// Devuelve lo que exige la spec tras cada registro: qué se añadió, total de esa
// comida y total del día por comidas. Es también la futura herramienta
// "log_food" para agentes externos.

export type LogEntryResponse = {
  entry: {
    id: string
    nombre: string
    qty: number
    unit: string
    kcal: number
    proteinas: number
    carbohidratos: number
    grasas: number
    source: string
    confidence: 'alta' | 'media' | 'baja'
  }
  mealType: MealType
  mealTotal: DaySummary['byMeal'][number] | null
  day: DaySummary
  goal: { kcal?: number; proteinas?: number; carbohidratos?: number; grasas?: number } | null
}

function confidenceFor(source: string): LogEntryResponse['entry']['confidence'] {
  if (source === 'usuario' || source === 'etiqueta') return 'alta'
  if (source === 'openfoodfacts' || source === 'global') return 'media'
  return 'baja'
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { food?: Partial<FoodItem> & { source?: string }; qty?: unknown; mealType?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const food = body.food
  const qty = Number(body.qty)
  const mealType = body.mealType as MealType

  if (!food || typeof food.nombre !== 'string' || !Number.isFinite(qty) || qty <= 0 || qty > 5000) {
    return NextResponse.json({ error: 'Invalid entry' }, { status: 400 })
  }
  if (!MEAL_ORDER.includes(mealType)) {
    return NextResponse.json({ error: 'Invalid mealType' }, { status: 400 })
  }

  const perUnit = food.macros_basis === 'per_unit'
  const item: FoodItem = {
    id: food.id ?? 'chat',
    nombre: food.nombre,
    kcal_100g: Number(food.kcal_100g ?? 0),
    proteinas_100g: Number(food.proteinas_100g ?? 0),
    grasas_100g: Number(food.grasas_100g ?? 0),
    carbohidratos_100g: Number(food.carbohidratos_100g ?? 0),
    fibra_100g: Number(food.fibra_100g ?? 0),
    macros_basis: perUnit ? 'per_unit' : 'per_100g',
    unit_name: food.unit_name ?? undefined,
    kcal_per_unit: food.kcal_per_unit ?? undefined,
    proteinas_per_unit: food.proteinas_per_unit ?? undefined,
    grasas_per_unit: food.grasas_per_unit ?? undefined,
    carbohidratos_per_unit: food.carbohidratos_per_unit ?? undefined,
    source: (food.source as FoodItem['source']) ?? 'manual',
  }

  const macros = calcMacros(item, qty, perUnit ? qty : undefined)
  const today = new Date().toISOString().split('T')[0]
  const source = String(food.source ?? 'manual')

  const { data: inserted, error } = await supabase
    .from('consumos')
    .insert({
      user_id: user.id,
      alimento_source: source === 'etiqueta' ? 'usuario' : source,
      nombre_alimento: item.nombre,
      cantidad_gr: qty,
      cantidad_unit: perUnit ? qty : undefined,
      macros_basis: item.macros_basis,
      kcal: macros.kcal,
      proteinas: macros.proteinas,
      grasas: macros.grasas,
      carbohidratos: macros.carbohidratos,
      fibra: macros.fibra,
      fecha: today,
      tipo_comida: mealType,
      numero_comida: 1,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('No se pudo registrar la entrada:', error?.message)
    return NextResponse.json({ error: 'Could not log entry' }, { status: 500 })
  }

  const [{ data: rows }, { data: goal }] = await Promise.all([
    supabase
      .from('consumos')
      .select('tipo_comida, kcal, proteinas, carbohidratos, grasas, hora_insercion, created_at')
      .eq('user_id', user.id)
      .eq('fecha', today),
    supabase
      .from('objetivos')
      .select('kcal_objetivo, proteinas_objetivo, carbohidratos_objetivo, grasas_objetivo')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const day = summarizeDay((rows ?? []) as Parameters<typeof summarizeDay>[0])

  const response: LogEntryResponse = {
    entry: {
      id: inserted.id,
      nombre: item.nombre,
      qty,
      unit: perUnit ? item.unit_name || 'ud' : 'g',
      kcal: macros.kcal,
      proteinas: macros.proteinas,
      carbohidratos: macros.carbohidratos,
      grasas: macros.grasas,
      source,
      confidence: confidenceFor(source),
    },
    mealType,
    mealTotal: day.byMeal.find((m) => m.meal === mealType) ?? null,
    day,
    goal: goal
      ? {
          kcal: goal.kcal_objetivo ?? undefined,
          proteinas: goal.proteinas_objetivo ?? undefined,
          carbohidratos: goal.carbohidratos_objetivo ?? undefined,
          grasas: goal.grasas_objetivo ?? undefined,
        }
      : null,
  }

  return NextResponse.json(response)
}
