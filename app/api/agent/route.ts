import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseUserIntent, generateAgentReply, type AgentMessage } from '@/lib/api/ai'
import { getUserLlmKey } from '@/lib/api/byok'
import { searchOpenFoodFacts } from '@/lib/api/openfoodfacts'
import { rankByMatch, bestMatch } from '@/lib/utils/foodMatch'
import { summarizeDay, resolveActiveMeal, describeSummary, MEAL_LABELS, MEAL_ORDER } from '@/lib/domain/day'
import type { MealType } from '@/types'
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
  action?:
    | 'food_options'
    | 'macros_data'
    | 'history_data'
    | 'catalog_data'
    | 'food_saved'
    | 'need_details'
    | 'catalog_changed'
    | 'log_changed'
    | 'day_reset'
  data?: {
    foods?: FoodOptionItem[]
    qty?: number
    mealType?: string
    query?: string
    macros?: MacroData
    days?: HistoryDayData[]
    catalog?: FoodOptionItem[]
    savedFood?: { nombre: string; kcal: number; basis: string; unitName?: string }
    // Cómo se decidió la comida para un registro pendiente de confirmar:
    // 'explicit' la dijo el usuario, 'context' la dio la regla de 90 minutos,
    // 'none' hay que preguntarla con chips (una sola vez).
    mealResolution?: 'explicit' | 'context' | 'none'
  }
}


// ─── Helpers ───────────────────────────────────────────────────────────────────

type CatalogRow = {
  id: string
  nombre: string
  macros_basis?: string | null
}

// Fila completa del catálogo tal y como vive en la tabla.
type CatalogFood = CatalogRow & Record<string, unknown>

// El usuario escribe "pollo" y en el catálogo está "Pechuga de pollo": se busca
// primero coincidencia exacta y se cae a coincidencia por inclusión.
function findCatalogMatch<T extends CatalogRow>(catalog: T[], name: string): T | undefined {
  const needle = name.trim().toLowerCase()
  if (!needle) return undefined

  const exact = catalog.find((f) => f.nombre.toLowerCase() === needle)
  return exact ?? bestMatch(catalog, name)
}

const PATCH_LABELS: Record<string, string> = {
  nombre: 'nombre',
  kcal_100g: 'kcal',
  kcal_per_unit: 'kcal',
  proteinas_100g: 'proteínas',
  proteinas_per_unit: 'proteínas',
  carbohidratos_100g: 'carbohidratos',
  carbohidratos_per_unit: 'carbohidratos',
  grasas_100g: 'grasas',
  grasas_per_unit: 'grasas',
  fibra_100g: 'fibra',
}

function describePatch(patch: Record<string, unknown>): string {
  return Object.entries(patch)
    .map(([key, value]) => `${PATCH_LABELS[key] ?? key} = ${value}`)
    .join(', ')
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

  const userKey = await getUserLlmKey(supabase, user.id)

  // El catálogo personal viaja al parser: así reconoce los alimentos del usuario
  // por su nombre real en vez de tratarlos como texto libre.
  // Se piden todas las columnas: los nombres per-unit se renombraron en una
  // migración condicional y pedirlos explícitamente rompe la consulta entera
  // en bases donde el renombrado no llegó a aplicarse.
  const { data: catalogRows, error: catalogError } = await supabase
    .from('alimentos_usuario')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (catalogError) {
    // Silenciar esto hacía que un fallo de lectura se contase como "catálogo vacío".
    console.error('No se pudo leer el catálogo del usuario:', catalogError.message)
  }

  const userCatalog = (catalogRows ?? []) as CatalogFood[]
  const catalogNames = userCatalog.map((f) => f.nombre)

  // El diario de hoy y el corte de "nuevo día" alimentan la comida activa y los
  // totales que acompañan a cada respuesta.
  const [{ data: todayRows }, { data: profileRow }] = await Promise.all([
    supabase
      .from('consumos')
      .select('id, nombre_alimento, tipo_comida, kcal, proteinas, carbohidratos, grasas, cantidad_gr, hora_insercion, created_at')
      .eq('user_id', user.id)
      .eq('fecha', today)
      .order('hora_insercion', { ascending: false }),
    supabase.from('profiles').select('chat_day_reset_at').eq('id', user.id).maybeSingle(),
  ])

  const todayEntries = (todayRows ?? []) as Array<{
    id: string
    nombre_alimento: string
    tipo_comida: MealType
    kcal: number
    proteinas: number
    carbohidratos: number
    grasas: number
    cantidad_gr: number
    hora_insercion: string | null
    created_at: string | null
  }>
  const dayResetAt = (profileRow?.chat_day_reset_at as string | null | undefined) ?? null
  const activeMeal = resolveActiveMeal(todayEntries, dayResetAt)

  const intent = await parseUserIntent(message, userKey, catalogNames)

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
    const catalog = userCatalog.slice(0, 20).map((f) => ({ ...f, source: 'usuario' })) as FoodOptionItem[]
    context = catalogError
      ? 'No he podido leer el catálogo por un error de base de datos. Dilo claramente, sin afirmar que esté vacío.'
      : catalog.length === 0
        ? 'El catálogo personal del usuario está vacío de verdad.'
        : `Catálogo personal (${userCatalog.length} alimentos): ${catalog.map((f) => f.nombre).join(', ')}`
    actionType = 'catalog_data'
    actionData = { catalog }
  }

  // ── log_food ──
  else if (intent.type === 'log_food') {
    const query = intent.query

    // El catálogo ya está en memoria: se empareja aquí, tolerando erratas y
    // palabras de más. Se prueba con lo que extrajo el clasificador y, si no da
    // nada, con el mensaje completo por si recortó de menos.
    const matched = rankByMatch(userCatalog, query)
    const userFoods: FoodOptionItem[] = (matched.length > 0 ? matched : rankByMatch(userCatalog, message))
      .slice(0, 5)
      .map((f) => ({ ...f, source: 'usuario' })) as FoodOptionItem[]

    // Sólo se sale a buscar fuera si el usuario no lo tiene ya fichado.
    const offFoods = userFoods.length > 0 ? [] : await searchOpenFoodFacts(query, 5)
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

    if (foods.length === 0) {
      context =
        `El usuario quiere registrar "${query}" pero no encontré ese alimento en ninguna base de datos. ` +
        `Pídele que te mande una foto de la etiqueta nutricional, o que te dicte los macros ` +
        `(kcal, proteínas, carbohidratos y grasas por 100g o por unidad) para guardarlo en su catálogo.`
      actionType = 'need_details'
      actionData = { query, qty: intent.qty, mealType: intent.mealType }
    } else {
      // Prioridad (spec §4): lo que diga el mensaje > comida abierta hace <90 min > preguntar una vez.
      const explicitMeal = MEAL_ORDER.includes(intent.mealType as MealType) ? (intent.mealType as MealType) : undefined
      const mealType = explicitMeal ?? activeMeal.meal ?? undefined
      const mealResolution: NonNullable<AgentApiResponse['data']>['mealResolution'] = explicitMeal
        ? 'explicit'
        : activeMeal.meal
          ? 'context'
          : 'none'

      context =
        `El usuario quiere registrar "${query}"` +
        (intent.qty ? ` (${intent.qty})` : '') +
        (mealType ? ` en ${MEAL_LABELS[mealType]}${mealResolution === 'context' ? ' (asumido por contexto)' : ''}` : ' (sin comida asignada: la elegirá en la tarjeta)') +
        `. Encontré ${foods.length} opciones; se confirman en la tarjeta. Responde en una frase, sin repetir la lista.`

      actionType = 'food_options'
      actionData = { foods, qty: intent.qty, mealType, mealResolution, query }
    }
  }

  // ── add_catalog_food ──
  else if (intent.type === 'add_catalog_food') {
    const isPerUnit = intent.macros_basis === 'per_unit'
    const { data: saved, error: saveError } = await supabase
      .from('alimentos_usuario')
      .insert({
        user_id: user.id,
        nombre: intent.nombre,
        macros_basis: intent.macros_basis,
        unit_name: intent.unit_name ?? null,
        kcal_100g: isPerUnit ? 0 : intent.kcal,
        proteinas_100g: isPerUnit ? 0 : intent.proteinas,
        grasas_100g: isPerUnit ? 0 : intent.grasas,
        carbohidratos_100g: isPerUnit ? 0 : intent.carbohidratos,
        fibra_100g: isPerUnit ? 0 : (intent.fibra ?? 0),
        kcal_per_unit: isPerUnit ? intent.kcal : null,
        proteinas_per_unit: isPerUnit ? intent.proteinas : null,
        grasas_per_unit: isPerUnit ? intent.grasas : null,
        carbohidratos_per_unit: isPerUnit ? intent.carbohidratos : null,
      })
      .select('nombre')
      .single()

    if (saveError || !saved) {
      context = `Intenté guardar "${intent.nombre}" en el catálogo del usuario pero falló. Discúlpate brevemente.`
    } else {
      context =
        `Guardado en el catálogo del usuario: "${intent.nombre}" ` +
        `(${intent.kcal} kcal, ${intent.proteinas}g proteínas, ${intent.carbohidratos}g carbohidratos, ${intent.grasas}g grasas ` +
        `${isPerUnit ? `por ${intent.unit_name ?? 'unidad'}` : 'por 100g'}). Confírmaselo en una frase.`
      actionType = 'food_saved'
      actionData = {
        savedFood: {
          nombre: intent.nombre,
          kcal: intent.kcal,
          basis: intent.macros_basis,
          unitName: intent.unit_name,
        },
      }
    }
  }

  // ── update_catalog_food ──
  else if (intent.type === 'update_catalog_food') {
    const target = findCatalogMatch(userCatalog, intent.nombre)

    if (!target) {
      context = `El usuario quiere corregir "${intent.nombre}" pero no está en su catálogo. Díselo y ofrécele crearlo.`
    } else {
      const isPerUnit = target.macros_basis === 'per_unit'
      const patch: Record<string, unknown> = {}
      if (intent.nuevo_nombre) patch.nombre = intent.nuevo_nombre
      if (intent.kcal !== undefined) patch[isPerUnit ? 'kcal_per_unit' : 'kcal_100g'] = intent.kcal
      if (intent.proteinas !== undefined) patch[isPerUnit ? 'proteinas_per_unit' : 'proteinas_100g'] = intent.proteinas
      if (intent.carbohidratos !== undefined) patch[isPerUnit ? 'carbohidratos_per_unit' : 'carbohidratos_100g'] = intent.carbohidratos
      if (intent.grasas !== undefined) patch[isPerUnit ? 'grasas_per_unit' : 'grasas_100g'] = intent.grasas
      if (intent.fibra !== undefined) patch.fibra_100g = intent.fibra

      if (Object.keys(patch).length === 0) {
        context = `El usuario quiere cambiar "${target.nombre}" pero no dijo qué valor. Pregúntaselo en una frase.`
      } else {
        const { error } = await supabase
          .from('alimentos_usuario')
          .update(patch)
          .eq('id', target.id)
          .eq('user_id', user.id)

        // Spec §5.1: la corrección actualiza el catálogo, no sólo la entrada.
        // Y las entradas de hoy de ese alimento se recalculan con el perfil corregido.
        let recomputed = 0
        if (!error) {
          const merged = { ...target, ...patch } as Record<string, number | string | null>
          const affected = todayEntries.filter((e) => bestMatch([target], e.nombre_alimento))
          for (const e of affected) {
            const qty = Number(e.cantidad_gr) || 0
            const factor = isPerUnit ? qty : qty / 100
            const pick = (base: string, unit: string) => Number(merged[isPerUnit ? unit : base] ?? 0)
            const { error: upErr } = await supabase
              .from('consumos')
              .update({
                nombre_alimento: intent.nuevo_nombre ?? e.nombre_alimento,
                kcal: Math.round(pick('kcal_100g', 'kcal_per_unit') * factor),
                proteinas: Math.round(pick('proteinas_100g', 'proteinas_per_unit') * factor * 10) / 10,
                carbohidratos: Math.round(pick('carbohidratos_100g', 'carbohidratos_per_unit') * factor * 10) / 10,
                grasas: Math.round(pick('grasas_100g', 'grasas_per_unit') * factor * 10) / 10,
              })
              .eq('id', e.id)
              .eq('user_id', user.id)
            if (!upErr) recomputed++
          }
        }

        context = error
          ? `Fallo al actualizar "${target.nombre}". Discúlpate brevemente.`
          : `Actualizado "${target.nombre}" en el catálogo: ${describePatch(patch)}.` +
            (recomputed > 0 ? ` Recalculadas ${recomputed} entradas de hoy con el perfil corregido.` : '') +
            ' Confírmaselo en una frase diciendo qué cambió.'
        if (!error) actionType = 'catalog_changed'
      }
    }
  }

  // ── delete_catalog_food ──
  else if (intent.type === 'delete_catalog_food') {
    const target = findCatalogMatch(userCatalog, intent.nombre)

    if (!target) {
      context = `El usuario quiere borrar "${intent.nombre}" del catálogo pero no lo encuentro. Díselo.`
    } else {
      const { error } = await supabase
        .from('alimentos_usuario')
        .delete()
        .eq('id', target.id)
        .eq('user_id', user.id)

      context = error
        ? `No pude borrar "${target.nombre}". Discúlpate brevemente.`
        : `Borrado "${target.nombre}" del catálogo del usuario. Confírmaselo en una frase.`
      if (!error) actionType = 'catalog_changed'
    }
  }

  // ── delete_log ──
  else if (intent.type === 'delete_log') {
    let q = supabase.from('consumos').select('id, nombre_alimento, kcal').eq('user_id', user.id).eq('fecha', today)
    if (intent.mealType) q = q.eq('tipo_comida', intent.mealType)
    if (intent.query) q = q.ilike('nombre_alimento', `%${intent.query}%`)

    const { data: matches } = await q.order('created_at', { ascending: false })

    if (!matches || matches.length === 0) {
      context = 'No encontré ese registro en el diario de hoy. Díselo al usuario en una frase.'
    } else {
      const victim = matches[0]
      const { error } = await supabase.from('consumos').delete().eq('id', victim.id).eq('user_id', user.id)

      context = error
        ? `No pude borrar "${victim.nombre_alimento}" del diario. Discúlpate brevemente.`
        : `Borrado del diario de hoy: "${victim.nombre_alimento}" (${Math.round(victim.kcal ?? 0)} kcal).` +
          (matches.length > 1 ? ` Había ${matches.length} coincidencias, borré la más reciente.` : '') +
          ' Confírmaselo en una frase.'
      if (!error) actionType = 'log_changed'
    }
  }

  // ── update_log ──
  else if (intent.type === 'update_log') {
    // Spec §8: sin alimento nombrado, la corrección apunta a la última entrada.
    let q = supabase
      .from('consumos')
      .select('id, nombre_alimento, cantidad_gr, kcal, proteinas, grasas, carbohidratos, fibra, macros_basis')
      .eq('user_id', user.id)
      .eq('fecha', today)
    if (intent.query) q = q.ilike('nombre_alimento', `%${intent.query}%`)
    const { data: matches } = await q.order('hora_insercion', { ascending: false }).limit(1)

    const target = matches?.[0]
    if (!target) {
      context = intent.query
        ? `No encontré "${intent.query}" en el diario de hoy. Díselo al usuario.`
        : 'No hay ningún registro hoy que corregir. Díselo al usuario.'
    } else {
      // Las macros guardadas corresponden a la cantidad antigua: se reescalan.
      const oldQty = Number(target.cantidad_gr) || 0
      const factor = oldQty > 0 ? intent.qty / oldQty : 1
      const round1 = (n: number) => Math.round((n ?? 0) * factor * 10) / 10

      const { error } = await supabase
        .from('consumos')
        .update({
          cantidad_gr: intent.qty,
          kcal: Math.round((target.kcal ?? 0) * factor),
          proteinas: round1(target.proteinas),
          grasas: round1(target.grasas),
          carbohidratos: round1(target.carbohidratos),
          fibra: round1(target.fibra),
        })
        .eq('id', target.id)
        .eq('user_id', user.id)

      context = error
        ? `No pude actualizar "${target.nombre_alimento}". Discúlpate brevemente.`
        : `Actualizado "${target.nombre_alimento}" de ${oldQty} a ${intent.qty}. Confírmaselo en una frase.`
      if (!error) actionType = 'log_changed'
    }
  }

  // ── move_log ──
  else if (intent.type === 'move_log') {
    const dest = MEAL_ORDER.includes(intent.mealType as MealType) ? (intent.mealType as MealType) : null
    const target = intent.query
      ? todayEntries.find((e) => bestMatch([{ nombre: e.nombre_alimento }], intent.query!))
      : todayEntries[0]

    if (!dest) {
      context = `El usuario quiere mover un registro a "${intent.mealType}" pero no reconozco esa comida. Pregúntale cuál.`
    } else if (!target) {
      context = 'No encontré ese registro en el diario de hoy. Díselo al usuario.'
    } else {
      // Se mueve, nunca se duplica (spec §4).
      const { error } = await supabase
        .from('consumos')
        .update({ tipo_comida: dest })
        .eq('id', target.id)
        .eq('user_id', user.id)

      context = error
        ? `No pude mover "${target.nombre_alimento}". Discúlpate brevemente.`
        : `Movido "${target.nombre_alimento}" de ${MEAL_LABELS[target.tipo_comida]} a ${MEAL_LABELS[dest]}. Confírmaselo en una frase.`
      if (!error) actionType = 'log_changed'
    }
  }

  // ── new_day ──
  else if (intent.type === 'new_day') {
    const { error } = await supabase
      .from('profiles')
      .update({ chat_day_reset_at: new Date().toISOString() })
      .eq('id', user.id)

    context = error
      ? 'No pude marcar el nuevo día. Discúlpate brevemente.'
      : 'Marcado un nuevo día: lo siguiente que registre irá al desayuno salvo que diga otra cosa. Confírmaselo en una frase.'
    if (!error) actionType = 'day_reset'
  }

  // ── edit_log ──
  else if (intent.type === 'edit_log') {
    context = 'El usuario quiere editar o borrar un registro del diario de hoy.'
    actionType = undefined
    actionData = undefined
  }

  // Sin esto, una pregunta clasificada como charla general llega al modelo sin
  // datos y termina inventándose el estado del usuario (p. ej. "tu catálogo está vacío").
  const baseContext = catalogError
    ? 'No se ha podido leer el catálogo del usuario en esta petición.'
    : userCatalog.length > 0
      ? `El usuario tiene ${userCatalog.length} alimentos en su catálogo personal: ` +
        `${userCatalog.slice(0, 30).map((f) => f.nombre).join(', ')}` +
        `${userCatalog.length > 30 ? ', …' : ''}.`
      : 'El catálogo personal del usuario está vacío.'

  const daySummary = describeSummary(summarizeDay(todayEntries))
  const activeMealNote =
    activeMeal.meal ? `Comida activa ahora mismo: ${MEAL_LABELS[activeMeal.meal]}.` : 'No hay comida activa.'

  const fullContext = [baseContext, daySummary, activeMealNote, context].filter(Boolean).join('\n')

  const reply = await generateAgentReply(message, fullContext, safeHistory, userKey)

  const response: AgentApiResponse = {
    reply,
    action: actionType,
    data: actionData,
  }

  return NextResponse.json(response)
}
