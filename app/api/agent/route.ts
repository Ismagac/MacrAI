import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseUserIntent, generateAgentReply, type AgentMessage } from '@/lib/api/gemini'
import { searchOpenFoodFacts } from '@/lib/api/openfoodfacts'
import type { FoodItem } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type FoodOptionItem = {
  id: string
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  grasas_100g: number
  carbohidratos_100g: number
  fibra_100g?: number
  macros_basis?: string
  unit_name?: string
  kcal_per_unit?: number
  proteinas_per_unit?: number
  grasas_per_unit?: number
  carbohidratos_per_unit?: number
  source: string
}

type MacroData = {
  kcal: number
  proteinas: number
  carbohidratos: number
  grasas: number
  fibra: number
  objetivo?: {
    kcal_objetivo?: number
    proteinas_objetivo?: number
    grasas_objetivo?: number
    carbohidratos_objetivo?: number
  } | null
}

type HistoryDayData = {
  fecha: string
  kcal: number
  proteinas: number
  carbohidratos: number
  grasas: number
}

export type AgentApiResponse = {
  reply: string
  action?: 'food_options' | 'macros_data' | 'history_data' | 'catalog_data'
  data?: {
    foods?: FoodOptionItem[]
    qty?: number
    mealType?: string
    query?: string
    macros?: MacroData
    days?: HistoryDayData[]
    catalog?: FoodOptionItem[]
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { message?: unknown; history?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { message, history = [] } = body
  if (typeof message !== 'string' || message.length < 1 || message.length > 500) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
  }
  const safeHistory = Array.isArray(history) ? (history as AgentMessage[]).slice(-8) : []

  const today = new Date().toISOString().split('T')[0]

  // Parse intent
  const intent = await parseUserIntent(message)

  let context = ''
  let actionType: AgentApiResponse['action']
  let actionData: AgentApiResponse['data']

  // ── check_macros ──
  if (intent.type === 'check_macros') {
    const [macrosResult, objetivoResult] = await Promise.all([
      supabase
        .from('consumos')
        .select('kcal, proteinas, grasas, carbohidratos, fibra')
        .eq('user_id', user.id)
        .eq('fecha', today),
      supabase
        .from('objetivos')
        .select('kcal_objetivo, proteinas_objetivo, grasas_objetivo, carbohidratos_objetivo')
        .eq('user_id', user.id)
        .single(),
    ])

    const totals = (macrosResult.data ?? []).reduce(
      (acc, c) => ({
        kcal: acc.kcal + (c.kcal ?? 0),
        proteinas: acc.proteinas + (c.proteinas ?? 0),
        grasas: acc.grasas + (c.grasas ?? 0),
        carbohidratos: acc.carbohidratos + (c.carbohidratos ?? 0),
        fibra: acc.fibra + (c.fibra ?? 0),
      }),
      { kcal: 0, proteinas: 0, grasas: 0, carbohidratos: 0, fibra: 0 }
    )

    const rounded: MacroData = {
      kcal: Math.round(totals.kcal),
      proteinas: Math.round(totals.proteinas * 10) / 10,
      grasas: Math.round(totals.grasas * 10) / 10,
      carbohidratos: Math.round(totals.carbohidratos * 10) / 10,
      fibra: Math.round(totals.fibra * 10) / 10,
      objetivo: objetivoResult.data ?? null,
    }

    const obj = objetivoResult.data
    context =
      `Macros de hoy: ${rounded.kcal} kcal, ${rounded.proteinas}g proteínas, ` +
      `${rounded.carbohidratos}g carbohidratos, ${rounded.grasas}g grasas.` +
      (obj ? ` Objetivo: ${obj.kcal_objetivo} kcal.` : ' Sin objetivo configurado.')

    actionType = 'macros_data'
    actionData = { macros: rounded }
  }

  // ── history ──
  else if (intent.type === 'history') {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: rows } = await supabase
      .from('consumos')
      .select('fecha, kcal, proteinas, grasas, carbohidratos')
      .eq('user_id', user.id)
      .gte('fecha', sevenDaysAgo.toISOString().split('T')[0])
      .order('fecha', { ascending: false })

    const grouped: Record<string, { kcal: number; proteinas: number; carbohidratos: number; grasas: number }> = {}
    for (const row of rows ?? []) {
      if (!grouped[row.fecha]) grouped[row.fecha] = { kcal: 0, proteinas: 0, carbohidratos: 0, grasas: 0 }
      grouped[row.fecha].kcal += row.kcal ?? 0
      grouped[row.fecha].proteinas += row.proteinas ?? 0
      grouped[row.fecha].carbohidratos += row.carbohidratos ?? 0
      grouped[row.fecha].grasas += row.grasas ?? 0
    }

    const days: HistoryDayData[] = Object.entries(grouped).map(([fecha, m]) => ({
      fecha,
      kcal: Math.round(m.kcal),
      proteinas: Math.round(m.proteinas * 10) / 10,
      carbohidratos: Math.round(m.carbohidratos * 10) / 10,
      grasas: Math.round(m.grasas * 10) / 10,
    }))

    context = `Historial (últimos 7 días): ${days.map((d) => `${d.fecha}: ${d.kcal} kcal`).join(', ')}`
    actionType = 'history_data'
    actionData = { days }
  }

  // ── catalog ──
  else if (intent.type === 'catalog') {
    const { data: foods } = await supabase
      .from('alimentos_usuario')
      .select(
        'id, nombre, kcal_100g, proteinas_100g, grasas_100g, carbohidratos_100g, fibra_100g, macros_basis, unit_name, kcal_per_unit, proteinas_per_unit, grasas_per_unit, carbohidratos_per_unit'
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    const catalog = (foods ?? []).map((f) => ({ ...f, source: 'usuario' })) as FoodOptionItem[]
    context = `Catálogo personal (${catalog.length} alimentos): ${catalog.map((f) => f.nombre).join(', ')}`
    actionType = 'catalog_data'
    actionData = { catalog }
  }

  // ── log_food ──
  else if (intent.type === 'log_food') {
    const query = intent.query

    const [dbResult, offFoods] = await Promise.all([
      supabase
        .from('alimentos_usuario')
        .select(
          'id, nombre, kcal_100g, proteinas_100g, grasas_100g, carbohidratos_100g, fibra_100g, macros_basis, unit_name, kcal_per_unit, proteinas_per_unit, grasas_per_unit, carbohidratos_per_unit'
        )
        .eq('user_id', user.id)
        .ilike('nombre', `%${query}%`)
        .limit(5),
      searchOpenFoodFacts(query, 5),
    ])

    const userFoods: FoodOptionItem[] = (dbResult.data ?? []).map((f) => ({ ...f, source: 'usuario' }))
    const globalFoods: FoodOptionItem[] = offFoods.map((f: FoodItem) => ({
      id: f.id,
      nombre: f.nombre,
      kcal_100g: f.kcal_100g,
      proteinas_100g: f.proteinas_100g,
      grasas_100g: f.grasas_100g,
      carbohidratos_100g: f.carbohidratos_100g,
      fibra_100g: f.fibra_100g,
      source: f.source,
    }))

    const foods = [...userFoods, ...globalFoods].slice(0, 8)
    context =
      `El usuario quiere registrar "${query}"` +
      (intent.qty ? ` (${intent.qty}g)` : '') +
      (intent.mealType ? ` en ${intent.mealType}` : '') +
      `. Encontré ${foods.length} opciones.`

    actionType = 'food_options'
    actionData = { foods, qty: intent.qty, mealType: intent.mealType, query }
  }

  // ── edit_log ──
  else if (intent.type === 'edit_log') {
    context = 'El usuario quiere editar o borrar un registro del diario de hoy.'
    actionType = undefined
    actionData = undefined
  }

  // Generate conversational reply
  const reply = await generateAgentReply(message, context, safeHistory)

  const response: AgentApiResponse = {
    reply,
    action: actionType,
    data: actionData,
  }

  return NextResponse.json(response)
}
