/**
 * MacrAI Telegram Bot Service
 *
 * Uses node-telegram-bot-api in webhook mode (no polling).
 * All Supabase operations go through SECURITY DEFINER RPC functions
 * so only the anon key is required — no service role key needed.
 *
 * Conversation state is persisted in the `bot_sessions` table.
 */

import TelegramBot from 'node-telegram-bot-api'
import { createClient } from '@supabase/supabase-js'
import { searchOpenFoodFacts } from '@/lib/api/openfoodfacts'
import { detectMacrosFromImage, type MacroDetectionResult } from '@/lib/api/gemini'
import type { FoodItem, MacrosBasis } from '@/types'

// ─── Singleton bot instance (no polling) ─────────────────────────────────────

let _bot: TelegramBot | null = null

export function getBot(): TelegramBot {
  if (!_bot) {
    _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: false })
  }
  return _bot
}

// ─── Supabase anon client (all data access via SECURITY DEFINER RPCs) ─────────

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ─── Session state types ──────────────────────────────────────────────────────

type MealType = 'desayuno' | 'almuerzo' | 'comida' | 'merienda' | 'cena' | 'snack' | 'otro'

type CatalogDraft = {
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  carbohidratos_100g: number
  grasas_100g: number
  fibra_100g: number
  // Per-unit macros
  macros_basis: MacrosBasis
  unit_name?: string
  proteinas_per_unit?: number
  carbohidratos_per_unit?: number
  grasas_per_unit?: number
  kcal_per_unit?: number
}

type BotSearchFood = {
  id: string
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  carbohidratos_100g: number
  grasas_100g: number
  fibra_100g: number
  source: 'usuario' | 'global' | 'openfoodfacts' | 'manual'
}

type TodayEntry = {
  id: string
  nombre_alimento: string
  cantidad_gr: number
  kcal: number
  proteinas: number
  carbohidratos: number
  grasas: number
}

type BotSession =
  | { step: 'idle' }
  | { step: 'selecting_meal_type' }
  | { step: 'awaiting_food_query'; mealType: MealType; mealNumber: number }
  | {
      step: 'selecting_food'
      mealType: MealType
      mealNumber: number
      foods: FoodItem[]
      proposedQty?: number
    }
  | { step: 'awaiting_food_qty'; mealType: MealType; mealNumber: number; food: FoodItem }
  | { step: 'awaiting_catalog_photo' }
  | { step: 'awaiting_catalog_basis'; detected: MacroDetectionResult; draft: CatalogDraft }
  | { step: 'awaiting_catalog_name'; draft: CatalogDraft }
  | { step: 'awaiting_catalog_macro_edit'; draft: CatalogDraft }
  | { step: 'awaiting_catalog_confirm'; draft: CatalogDraft }
  | { step: 'selecting_today_entry'; entries: TodayEntry[] }
  | { step: 'awaiting_edit_qty'; entry: TodayEntry }

// ─── Session helpers ──────────────────────────────────────────────────────────

async function getSession(chatId: number): Promise<BotSession> {
  const db = getDb()
  const { data } = await db.rpc('bot_get_session', { p_chat_id: chatId })
  if (!data || Object.keys(data).length === 0) return { step: 'idle' }
  return data as BotSession
}

async function setSession(chatId: number, state: BotSession): Promise<void> {
  const db = getDb()
  await db.rpc('bot_set_session', { p_chat_id: chatId, p_state: state })
}

// ─── Keyboard templates ───────────────────────────────────────────────────────

const MAIN_MENU_KEYBOARD: TelegramBot.InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📝 Registrar comida', callback_data: 'lf' },
      { text: '📊 Macros de hoy', callback_data: 'mr' },
    ],
    [
      { text: '📅 Historial semanal', callback_data: 'hs' },
      { text: '🍎 Mi catálogo', callback_data: 'ct' },
    ],
    [{ text: '✏️ Corregir registro de hoy', callback_data: 'ed' }],
    [{ text: '📸 Añadir alimento por foto', callback_data: 'ca' }],
    [{ text: 'ℹ️ Ayuda', callback_data: 'help' }],
  ],
}

const MEAL_TYPE_KEYBOARD: TelegramBot.InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '🌅 Desayuno', callback_data: 'mt:desayuno:1' },
      { text: '🥗 Almuerzo', callback_data: 'mt:almuerzo:1' },
    ],
    [
      { text: '🍽️ Comida', callback_data: 'mt:comida:1' },
      { text: '🍫 Merienda', callback_data: 'mt:merienda:1' },
    ],
    [
      { text: '🌙 Cena', callback_data: 'mt:cena:1' },
      { text: '🍎 Snack', callback_data: 'mt:snack:1' },
    ],
    [{ text: '« Menú principal', callback_data: 'menu' }],
  ],
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

async function sendMainMenu(chatId: number, text = '¿Qué quieres hacer?') {
  await getBot().sendMessage(chatId, text, {
    reply_markup: MAIN_MENU_KEYBOARD,
    parse_mode: 'Markdown',
  })
}

async function sendMealTypeMenu(chatId: number) {
  await getBot().sendMessage(chatId, '¿En qué comida lo quieres registrar?', {
    reply_markup: MEAL_TYPE_KEYBOARD,
  })
}

function buildCatalogDraftFromDetected(detected: MacroDetectionResult): CatalogDraft {
  // Por defecto empezamos con per_100g
  return {
    nombre: detected.foodName || 'Nuevo alimento',
    kcal_100g: detected.calories || 0,
    proteinas_100g: detected.proteins || 0,
    carbohidratos_100g: detected.carbs || 0,
    grasas_100g: detected.fats || 0,
    fibra_100g: 0,
    macros_basis: 'per_100g',
  }
}

function formatDraft(draft: CatalogDraft): string {
  if (draft.macros_basis === 'per_unit') {
    return (
      `*${draft.nombre}* (${draft.unit_name || '1 unidad'})\n` +
      `🔥 ${draft.kcal_per_unit || 0} kcal/unidad\n` +
      `🥩 P: ${draft.proteinas_per_unit || 0}g · 🍞 C: ${draft.carbohidratos_per_unit || 0}g · 🧈 G: ${draft.grasas_per_unit || 0}g`
    )
  }
  
  return (
    `*${draft.nombre}*\n` +
    `🔥 ${draft.kcal_100g} kcal/100g\n` +
    `🥩 P: ${draft.proteinas_100g}g · 🍞 C: ${draft.carbohidratos_100g}g · 🧈 G: ${draft.grasas_100g}g\n` +
    `🌿 Fibra: ${draft.fibra_100g}g`
  )
}

function parseMacroEditInput(text: string): Omit<CatalogDraft, 'nombre'> | null {
  const parts = text
    .split(/[;,|]/)
    .map((p) => p.trim().replace(',', '.'))
    .filter(Boolean)

  if (parts.length < 4 || parts.length > 5) return null

  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null

  return {
    kcal_100g: Math.round(nums[0] * 10) / 10,
    proteinas_100g: Math.round(nums[1] * 10) / 10,
    carbohidratos_100g: Math.round(nums[2] * 10) / 10,
    grasas_100g: Math.round(nums[3] * 10) / 10,
    fibra_100g: Math.round((nums[4] ?? 0) * 10) / 10,
     macros_basis: 'per_100g',
  }
}

async function promptCatalogConfirm(chatId: number, draft: CatalogDraft) {
  await getBot().sendMessage(
    chatId,
    `Revisa el alimento antes de guardarlo en tu catálogo:\n\n${formatDraft(draft)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Guardar en catálogo', callback_data: 'ca_save' }],
          [{ text: '✏️ Corregir macros', callback_data: 'ca_edit_macros' }],
          [{ text: '✍️ Cambiar nombre', callback_data: 'ca_edit_name' }],
          [{ text: '❌ Cancelar', callback_data: 'menu' }],
        ],
      },
    }
  )
}

function parseQtyAndQuery(input: string): { qty: number | null; query: string } {
  const m = input.trim().match(/^(\d+(?:[\.,]\d+)?)\s+(.+)$/)
  if (!m) return { qty: null, query: input.trim() }
  const qty = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(qty) || qty <= 0) return { qty: null, query: input.trim() }
  return { qty, query: m[2].trim() }
}

function dedupeFoods(foods: FoodItem[]): FoodItem[] {
  const seen = new Set<string>()
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const out: FoodItem[] = []
  for (const f of foods) {
    const key = normalise(f.nombre)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

async function searchFoodsMerged(chatId: number, query: string): Promise<FoodItem[]> {
  const db = getDb()

  const [dbFoodsResult, offFoods] = await Promise.all([
    db.rpc('bot_search_foods', { p_chat_id: chatId, p_query: query, p_limit: 6 }),
    searchOpenFoodFacts(query, 6),
  ])

  const dbFoods: FoodItem[] = ((dbFoodsResult.data ?? []) as BotSearchFood[]).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    kcal_100g: Number(f.kcal_100g),
    proteinas_100g: Number(f.proteinas_100g),
    carbohidratos_100g: Number(f.carbohidratos_100g),
    grasas_100g: Number(f.grasas_100g),
    fibra_100g: Number(f.fibra_100g ?? 0),
    source: f.source,
  }))

  return dedupeFoods([...dbFoods, ...offFoods]).slice(0, 12)
}

async function sendFoodResults(
  chatId: number,
  foods: FoodItem[],
  mealType: MealType,
  mealNumber: number,
  proposedQty?: number
) {
  const keyboardRows: TelegramBot.InlineKeyboardButton[][] = foods.map((f, i) => {
    const label = proposedQty
      ? `${f.nombre.slice(0, 28)} · ${Math.round((f.kcal_100g * proposedQty) / 100)} kcal (${proposedQty}g)`
      : `${f.nombre.slice(0, 40)} (${f.kcal_100g} kcal/100g)`
    return [{ text: label, callback_data: `sf:${i}` }]
  })

  keyboardRows.push([{ text: '🔍 Buscar de nuevo', callback_data: `mt:${mealType}:${mealNumber}` }])
  keyboardRows.push([{ text: '➕ ¿No te cuadran los macros? Añádelo', callback_data: 'ca_quick' }])
  keyboardRows.push([{ text: '« Cancelar', callback_data: 'menu' }])

  await getBot().sendMessage(chatId, 'Selecciona el alimento:', {
    reply_markup: { inline_keyboard: keyboardRows },
  })
}

async function handleCatalogPhoto(chatId: number, fileId: string) {
  const bot = getBot()
  const file = await bot.getFile(fileId)

  if (!file.file_path) {
    await bot.sendMessage(chatId, 'No pude leer la imagen. Inténtalo de nuevo con otra foto.')
    return
  }

  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`

  // Descargar la imagen con timeout para no bloquear el flujo
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let buffer: Buffer
  try {
    const response = await fetch(fileUrl, { signal: controller.signal })
    if (!response.ok) {
      await bot.sendMessage(chatId, 'No pude descargar la foto de Telegram. Inténtalo de nuevo.')
      return
    }
    buffer = Buffer.from(await response.arrayBuffer())
  } catch {
    await bot.sendMessage(chatId, 'La descarga de la foto tardó demasiado. Prueba de nuevo con otra imagen.')
    return
  } finally {
    clearTimeout(timeout)
  }

  await bot.sendMessage(chatId, '🤖 Analizando con IA... máximo ~20s. Si no, pasamos a modo manual.')
  const detected = await detectMacrosFromImage(buffer)

  if (!detected.success || !detected.proteins) {
    const draft: CatalogDraft = {
      nombre: 'Nuevo alimento',
      kcal_100g: 0,
      proteinas_100g: 0,
      carbohidratos_100g: 0,
      grasas_100g: 0,
      fibra_100g: 0,
      macros_basis: 'per_100g',
    }

    await setSession(chatId, { step: 'awaiting_catalog_name', draft })
    await bot.sendMessage(
      chatId,
      'No he podido detectar macros de forma fiable (error: ' + (detected.error || 'unknown') + ')\n\nEscribe el *nombre* que quieres para el alimento y luego te pediré los macros manualmente.',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
      }
    )
    return
  }

  // Construir draft inicial con los datos detectados
  const draft = buildCatalogDraftFromDetected(detected)

  // Preguntar si es per_100g o per_unit
  await setSession(chatId, { step: 'awaiting_catalog_basis', detected, draft })

  await bot.sendMessage(
    chatId,
    `📸 *Detección IA completada:*\n\n${formatDraft(draft)}\n\n¿Estos macros son:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📏 Por 100 gramos', callback_data: 'ca_basis:per_100g' }],
          [{ text: '🔢 Por unidad (1 helado, 1 galleta, etc)', callback_data: 'ca_basis:per_unit' }],
          [{ text: '❌ Cancelar', callback_data: 'menu' }],
        ],
      },
    }
  )
}

// ─── Macro summary builder ────────────────────────────────────────────────────

function buildMacroBar(value: number, goal: number | null): string {
  const pct = goal && goal > 0 ? Math.min(Math.round((value / goal) * 100), 100) : null
  const bar = pct !== null ? `[${('█'.repeat(Math.round(pct / 10))).padEnd(10, '░')}] ${pct}%` : ''
  return bar
}

// ─── Check if user is linked ──────────────────────────────────────────────────

async function isLinked(chatId: number): Promise<boolean> {
  const db = getDb()
  const { data } = await db.rpc('bot_get_user_id', { p_chat_id: chatId })
  return !!data
}

// ─── Main update handler ──────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramBot.Update): Promise<void> {
  const bot = getBot()

  // ── Callback query (button press) ─────────────────────────────────────────
  if (update.callback_query) {
    const query = update.callback_query
    const chatId = query.message!.chat.id
    const data = query.data ?? ''

    // Always ack the callback
    await bot.answerCallbackQuery(query.id)

    // ── Main menu ──
    if (data === 'menu') {
      await setSession(chatId, { step: 'idle' })
      await sendMainMenu(chatId)
      return
    }

    // ── Help ──
    if (data === 'help') {
      await bot.sendMessage(
        chatId,
        `*Ayuda de MacrAI* 🤖\n\n` +
          `📝 *Registrar comida* — Añade lo que has comido al diario de hoy.\n` +
          `📊 *Macros de hoy* — Consulta las calorías y macros acumulados hoy.\n` +
          `📅 *Historial semanal* — Ve los últimos 7 días.\n` +
          `🍎 *Mi catálogo* — Revisa tus alimentos personales.\n` +
          `📸 *Añadir alimento por foto* — Detecta macros desde etiqueta y guarda corrigiendo lo que quieras.\n\n` +
          `_Puedes escribir el nombre de un alimento directamente en el chat para buscarlo rápido._`,
        { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
      )
      return
    }

    if (data === 'ca') {
      await setSession(chatId, { step: 'awaiting_catalog_photo' })
      await bot.sendMessage(
        chatId,
        'Envíame una *foto o captura* de la tabla nutricional del producto.',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    if (data === 'ca_quick') {
      await setSession(chatId, { step: 'awaiting_catalog_photo' })
      await bot.sendMessage(
        chatId,
        'Perfecto, envíame una *foto o captura* de la tabla nutricional y lo añadimos al catálogo sin salir de este flujo.',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    if (data === 'ed') {
      const db = getDb()
      const { data: rows } = await db.rpc('bot_list_today_consumos', { p_chat_id: chatId })
      const entries = ((rows ?? []) as TodayEntry[]).map((r) => ({
        ...r,
        cantidad_gr: Number(r.cantidad_gr),
        kcal: Number(r.kcal),
        proteinas: Number(r.proteinas),
        carbohidratos: Number(r.carbohidratos),
        grasas: Number(r.grasas),
      }))

      if (entries.length === 0) {
        await bot.sendMessage(chatId, 'No tienes registros hoy para corregir.', {
          reply_markup: MAIN_MENU_KEYBOARD,
        })
        return
      }

      await setSession(chatId, { step: 'selecting_today_entry', entries })

      const rowsKb: TelegramBot.InlineKeyboardButton[][] = entries.slice(0, 10).map((e, i) => [
        {
          text: `${e.nombre_alimento.slice(0, 28)} · ${e.cantidad_gr}g · ${Math.round(e.kcal)} kcal`,
          callback_data: `edsel:${i}`,
        },
      ])
      rowsKb.push([{ text: '« Menú principal', callback_data: 'menu' }])

      await bot.sendMessage(chatId, 'Selecciona qué entrada quieres corregir:', {
        reply_markup: { inline_keyboard: rowsKb },
      })
      return
    }

    if (data.startsWith('edsel:')) {
      const idx = parseInt(data.split(':')[1], 10)
      const session = await getSession(chatId)
      if (session.step !== 'selecting_today_entry') {
        await sendMainMenu(chatId)
        return
      }
      const entry = session.entries[idx]
      if (!entry) {
        await sendMainMenu(chatId)
        return
      }

      await setSession(chatId, { step: 'awaiting_edit_qty', entry })
      await bot.sendMessage(
        chatId,
        `Entrada actual:\n*${entry.nombre_alimento}*\n${entry.cantidad_gr}g · ${Math.round(entry.kcal)} kcal\n\nEscribe la *nueva cantidad en gramos*.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    if (data === 'ca_edit_name') {
      const session = await getSession(chatId)
      if (
        session.step !== 'awaiting_catalog_confirm' &&
        session.step !== 'awaiting_catalog_name' &&
        session.step !== 'awaiting_catalog_macro_edit'
      ) {
        await sendMainMenu(chatId)
        return
      }
      await setSession(chatId, { step: 'awaiting_catalog_name', draft: session.draft })
      await bot.sendMessage(chatId, 'Escribe el nombre que quieres para este alimento:')
      return
    }

    if (data === 'ca_edit_macros') {
      const session = await getSession(chatId)
      if (
        session.step !== 'awaiting_catalog_confirm' &&
        session.step !== 'awaiting_catalog_name' &&
        session.step !== 'awaiting_catalog_macro_edit'
      ) {
        await sendMainMenu(chatId)
        return
      }

      await setSession(chatId, { step: 'awaiting_catalog_macro_edit', draft: session.draft })
      const basisText =
        session.draft.macros_basis === 'per_unit'
          ? 'por unidad'
          : 'por 100g'
      await bot.sendMessage(
        chatId,
        `Escribe los macros ${basisText} en este formato:\n\`kcal,proteinas,carbohidratos,grasas,fibra\`\n\nEjemplo: \`250,12,30,8,4\`\n(Fibra es opcional)`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    if (data === 'ca_save') {
      const session = await getSession(chatId)
      if (session.step !== 'awaiting_catalog_confirm') {
        await sendMainMenu(chatId)
        return
      }

      const db = getDb()
      const { data: id, error } = await db.rpc('bot_add_user_food', {
        p_chat_id: chatId,
        p_nombre: session.draft.nombre,
        p_kcal_100g: session.draft.kcal_100g,
        p_proteinas_100g: session.draft.proteinas_100g,
        p_grasas_100g: session.draft.grasas_100g,
        p_carbohidratos_100g: session.draft.carbohidratos_100g,
        p_fibra_100g: session.draft.fibra_100g,
        p_macros_basis: session.draft.macros_basis || 'per_100g',
        p_unit_name: session.draft.unit_name || null,
        p_kcal_per_unit: session.draft.kcal_per_unit || null,
        p_proteinas_per_unit: session.draft.proteinas_per_unit || null,
        p_grasas_per_unit: session.draft.grasas_per_unit || null,
        p_carbohidratos_per_unit: session.draft.carbohidratos_per_unit || null,
      })

      await setSession(chatId, { step: 'idle' })

      if (error || !id) {
        await bot.sendMessage(chatId, '❌ No he podido guardar el alimento en tu catálogo.')
        await sendMainMenu(chatId)
        return
      }

      await bot.sendMessage(
        chatId,
        `✅ Guardado en tu catálogo:\n\n${formatDraft(session.draft)}`,
        { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
      )
      return
    }

    // ── Catalog basis selection: ca_basis:per_100g | ca_basis:per_unit ──
    if (data.startsWith('ca_basis:')) {
      const basis = data.split(':')[1] as MacrosBasis
      const session = await getSession(chatId)

      if (session.step !== 'awaiting_catalog_basis' || !session.draft) {
        await sendMainMenu(chatId)
        return
      }

      session.draft.macros_basis = basis

      if (basis === 'per_unit') {
        // Para per_unit, los macros detectados son por unidad
        session.draft.proteinas_per_unit = session.draft.proteinas_100g
        session.draft.grasas_per_unit = session.draft.grasas_100g
        session.draft.carbohidratos_per_unit = session.draft.carbohidratos_100g
        session.draft.kcal_per_unit = session.draft.kcal_100g
        // Limpiar los valores per_100g
        session.draft.proteinas_100g = 0
        session.draft.grasas_100g = 0
        session.draft.carbohidratos_100g = 0
        session.draft.kcal_100g = 0

        await setSession(chatId, { step: 'awaiting_catalog_basis', detected: session.detected, draft: session.draft })
        await bot.sendMessage(
          chatId,
          `¿Cuál es la unidad? (ej: "1 helado", "1 galleta", "1 porción")\n\nEstos son los macros por unidad:\n${formatDraft(session.draft)}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]],
            },
          }
        )
        return
      }

      // Si es per_100g, continuamos al siguiente paso (nombre)
      await setSession(chatId, { step: 'awaiting_catalog_name', draft: session.draft })
      await bot.sendMessage(
        chatId,
        `📸 *Datos detectados (por 100g):*\n\n${formatDraft(session.draft)}\n\nAhora escribe el *nombre* que quieres guardar (puedes usar otro diferente).`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✏️ Corregir macros', callback_data: 'ca_edit_macros' }],
              [{ text: '❌ Cancelar', callback_data: 'menu' }],
            ],
          },
        }
      )
      return
    }

    // ── Log food ──
    if (data === 'lf') {
      await setSession(chatId, { step: 'selecting_meal_type' })
      await sendMealTypeMenu(chatId)
      return
    }

    // ── Meal type selected: mt:{mealType}:{mealNumber} ──
    if (data.startsWith('mt:')) {
      const [, mealType, numStr] = data.split(':')
      const mealNumber = parseInt(numStr, 10) || 1
      await setSession(chatId, {
        step: 'awaiting_food_query',
        mealType: mealType as MealType,
        mealNumber,
      })
      await bot.sendMessage(
        chatId,
        `¿Qué has comido? Escribe el nombre del alimento para buscarlo.`,
        { reply_markup: { inline_keyboard: [[{ text: '« Cancelar', callback_data: 'menu' }]] } }
      )
      return
    }

    // ── Food selected from results: sf:{index} ──
    if (data.startsWith('sf:')) {
      const idx = parseInt(data.split(':')[1], 10)
      const session = await getSession(chatId)
      if (session.step !== 'selecting_food') {
        await sendMainMenu(chatId)
        return
      }
      const food = session.foods[idx]
      if (!food) {
        await bot.sendMessage(chatId, 'Alimento no encontrado. Inténtalo de nuevo.')
        await sendMainMenu(chatId)
        return
      }

      if (session.proposedQty && session.proposedQty > 0) {
        const qty = session.proposedQty
        const factor = qty / 100
        const kcal = Math.round(food.kcal_100g * factor * 10) / 10
        const proteinas = Math.round(food.proteinas_100g * factor * 10) / 10
        const grasas = Math.round(food.grasas_100g * factor * 10) / 10
        const carbohidratos = Math.round(food.carbohidratos_100g * factor * 10) / 10
        const fibra = Math.round((food.fibra_100g ?? 0) * factor * 10) / 10

        const db = getDb()
        const { data: newId, error } = await db.rpc('bot_log_consumo', {
          p_chat_id: chatId,
          p_nombre: food.nombre,
          p_cantidad_gr: qty,
          p_kcal: kcal,
          p_proteinas: proteinas,
          p_grasas: grasas,
          p_carbohidratos: carbohidratos,
          p_fibra: fibra,
          p_tipo_comida: session.mealType,
          p_numero_comida: session.mealNumber,
          p_alimento_source: food.source,
        })

        await setSession(chatId, { step: 'idle' })

        if (error || !newId) {
          await bot.sendMessage(chatId, '❌ Hubo un error al guardar. Inténtalo de nuevo.')
          await sendMainMenu(chatId)
          return
        }

        await bot.sendMessage(
          chatId,
          `✅ *${food.nombre}* registrado (${qty}g)\n\n` +
            `🔥 ${kcal} kcal  ·  🥩 P: ${proteinas}g  ·  🍞 C: ${carbohidratos}g  ·  🧈 G: ${grasas}g`,
          { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
        )
        return
      }

      await setSession(chatId, {
        step: 'awaiting_food_qty',
        mealType: session.mealType,
        mealNumber: session.mealNumber,
        food,
      })
      await bot.sendMessage(
        chatId,
        `*${food.nombre}*\n_${food.kcal_100g} kcal · P: ${food.proteinas_100g}g · C: ${food.carbohidratos_100g}g · G: ${food.grasas_100g}g (por 100g)_\n\n¿Cuántos gramos has comido? Escribe solo el número.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '« Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    // ── Macros today ──
    if (data === 'mr') {
      await handleMacrosToday(chatId)
      return
    }

    // ── History ──
    if (data === 'hs') {
      await handleHistory(chatId)
      return
    }

    // ── Catalog ──
    if (data === 'ct') {
      await handleCatalog(chatId)
      return
    }

    // ── Unlink ──
    if (data === 'ul_confirm') {
      const db = getDb()
      await db.rpc('bot_unlink_telegram', { p_chat_id: chatId })
      await bot.sendMessage(
        chatId,
        '✅ Tu cuenta de Telegram ha sido desvinculada de MacrAI. Hasta pronto!'
      )
      return
    }

    if (data === 'ul') {
      await bot.sendMessage(chatId, '¿Seguro que quieres desvincular tu cuenta de Telegram?', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Sí, desvincular', callback_data: 'ul_confirm' },
              { text: '❌ Cancelar', callback_data: 'menu' },
            ],
          ],
        },
      })
      return
    }

    return
  }

  // ── Text / photo messages ────────────────────────────────────────────────────
  if (!update.message) return

  const msg = update.message
  const chatId = msg.chat.id
  const firstName = msg.from?.first_name ?? 'amigo'

  // ── Photo message ──
  if (msg.photo) {
    const linked = await isLinked(chatId)
    if (!linked) {
      await bot.sendMessage(
        chatId,
        '🔗 Tu cuenta no está vinculada todavía. Ve al dashboard de MacrAI y haz clic en *"Conectar con Telegram"*.',
        { parse_mode: 'Markdown' }
      )
      return
    }

    const largestPhoto = msg.photo[msg.photo.length - 1]
    if (!largestPhoto?.file_id) {
      await bot.sendMessage(chatId, 'No he podido leer esa foto. Intenta de nuevo.')
      return
    }

    await handleCatalogPhoto(chatId, largestPhoto.file_id)
    return
  }

  if (!msg.text) return
  const text = msg.text.trim()

  // ── /start command ──
  if (text.startsWith('/start')) {
    const parts = text.split(' ')
    const code = parts[1]?.trim()

    if (code) {
      // Try to link account
      const db = getDb()
      const { data: userId, error } = await db.rpc('verify_telegram_link', {
        p_code: code,
        p_chat_id: chatId,
      })

      if (error || !userId) {
        await bot.sendMessage(
          chatId,
          '❌ El código de vinculación no es válido o ha expirado.\n\nVuelve a la app y genera un nuevo código desde tu dashboard.'
        )
        return
      }

      await bot.sendMessage(
        chatId,
        `✅ ¡Cuenta vinculada correctamente!\n\nBienvenido a *MacrAI*, ${firstName}. 🎉\n\nYa puedes gestionar tu dieta directamente desde aquí.`,
        { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
      )
      return
    }

    // No code — check if already linked
    const linked = await isLinked(chatId)
    if (linked) {
      await sendMainMenu(
        chatId,
        `👋 ¡Hola de nuevo, ${firstName}!\n\n¿Qué quieres hacer hoy?`
      )
    } else {
      await bot.sendMessage(
        chatId,
        `👋 ¡Hola, ${firstName}! Soy *MacrAI*, tu asistente de nutrición.\n\nPara empezar necesitas vincular tu cuenta. Ve al *dashboard* de MacrAI y haz clic en *"Conectar con Telegram"* para obtener tu código de acceso.`,
        { parse_mode: 'Markdown' }
      )
    }
    return
  }

  // ── All other text messages: check session state ──
  const linked = await isLinked(chatId)
  if (!linked) {
    await bot.sendMessage(
      chatId,
      '🔗 Tu cuenta no está vinculada todavía. Ve al dashboard de MacrAI y haz clic en *"Conectar con Telegram"*.',
      { parse_mode: 'Markdown' }
    )
    return
  }

  const session = await getSession(chatId)

  // ── Awaiting food search query ──
  if (session.step === 'awaiting_food_query') {
    const parsed = parseQtyAndQuery(text)
    const query = parsed.query
    const proposedQty = parsed.qty ?? undefined
    await bot.sendMessage(chatId, `🔍 Buscando *${query}*...`, { parse_mode: 'Markdown' })

    const foods = await searchFoodsMerged(chatId, query)

    if (foods.length === 0) {
      await bot.sendMessage(
        chatId,
        'No he encontrado resultados para ese alimento. Intenta con otro nombre o añádelo a tu catálogo.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ ¿No te cuadran los macros? Añádelo', callback_data: 'ca_quick' }],
              [{ text: '« Cancelar', callback_data: 'menu' }],
            ],
          },
        }
      )
      return
    }

    await setSession(chatId, {
      step: 'selecting_food',
      mealType: session.mealType,
      mealNumber: session.mealNumber,
      foods,
      proposedQty,
    })

    await sendFoodResults(chatId, foods, session.mealType, session.mealNumber, proposedQty)
    return
  }

  // ── Awaiting quantity ──
  if (session.step === 'awaiting_food_qty') {
    const qty = parseFloat(text.replace(',', '.'))
    if (isNaN(qty) || qty <= 0 || qty > 5000) {
      await bot.sendMessage(
        chatId,
        '⚠️ Por favor escribe solo el número de gramos (ej: 150).',
        { reply_markup: { inline_keyboard: [[{ text: '« Cancelar', callback_data: 'menu' }]] } }
      )
      return
    }

    const { food, mealType, mealNumber } = session
    const factor = qty / 100
    const kcal = Math.round(food.kcal_100g * factor * 10) / 10
    const proteinas = Math.round(food.proteinas_100g * factor * 10) / 10
    const grasas = Math.round(food.grasas_100g * factor * 10) / 10
    const carbohidratos = Math.round(food.carbohidratos_100g * factor * 10) / 10
    const fibra = Math.round((food.fibra_100g ?? 0) * factor * 10) / 10

    const db = getDb()
    const { data: newId, error } = await db.rpc('bot_log_consumo', {
      p_chat_id: chatId,
      p_nombre: food.nombre,
      p_cantidad_gr: qty,
      p_kcal: kcal,
      p_proteinas: proteinas,
      p_grasas: grasas,
      p_carbohidratos: carbohidratos,
      p_fibra: fibra,
      p_tipo_comida: mealType,
      p_numero_comida: mealNumber,
      p_alimento_source: food.source,
    })

    await setSession(chatId, { step: 'idle' })

    if (error || !newId) {
      await bot.sendMessage(chatId, '❌ Hubo un error al guardar. Inténtalo de nuevo.')
      await sendMainMenu(chatId)
      return
    }

    await bot.sendMessage(
      chatId,
      `✅ *${food.nombre}* registrado (${qty}g)\n\n` +
        `🔥 ${kcal} kcal  ·  🥩 P: ${proteinas}g  ·  🍞 C: ${carbohidratos}g  ·  🧈 G: ${grasas}g`,
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
    return
  }

  if (session.step === 'awaiting_catalog_basis') {
    // Usuario está escribiendo el nombre de la unidad para per_unit macros
    const unitName = text.slice(0, 80).trim()
    if (unitName.length < 2) {
      await bot.sendMessage(chatId, 'El nombre de la unidad es muy corto. Intenta de nuevo.')
      return
    }

    const draft = { ...session.draft, unit_name: unitName }
    await setSession(chatId, { step: 'awaiting_catalog_name', draft })
    await bot.sendMessage(
      chatId,
      `✅ Unidad establecida: *${unitName}*\n\nAhora escribe el *nombre* del alimento que quieres guardar.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
      }
    )
    return
  }

  if (session.step === 'awaiting_catalog_name') {
    const nombre = text.slice(0, 80).trim()
    if (nombre.length < 2) {
      await bot.sendMessage(chatId, 'El nombre es demasiado corto. Escribe uno válido.')
      return
    }

    const draft: CatalogDraft = { ...session.draft, nombre }

    if (
      draft.kcal_100g === 0 &&
      draft.proteinas_100g === 0 &&
      draft.carbohidratos_100g === 0 &&
      draft.grasas_100g === 0 &&
      draft.fibra_100g === 0
    ) {
      await setSession(chatId, { step: 'awaiting_catalog_macro_edit', draft })
      await bot.sendMessage(
        chatId,
        'Perfecto. Ahora escribe los macros por 100g en formato:\n`kcal,proteinas,carbohidratos,grasas,fibra`\nEjemplo: `250,12,30,8,4`',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'menu' }]] },
        }
      )
      return
    }

    await setSession(chatId, { step: 'awaiting_catalog_confirm', draft })
    await promptCatalogConfirm(chatId, draft)
    return
  }

  if (session.step === 'awaiting_catalog_macro_edit') {
    const parsed = parseMacroEditInput(text)
    if (!parsed) {
      await bot.sendMessage(
        chatId,
        'Formato no válido. Usa: `kcal,proteinas,carbohidratos,grasas,fibra`\nEjemplo: `250,12,30,8,4`',
        { parse_mode: 'Markdown' }
      )
      return
    }

    let draft: CatalogDraft
    if (session.draft.macros_basis === 'per_unit') {
      draft = {
        ...session.draft,
        kcal_per_unit: parsed.kcal_100g,
        proteinas_per_unit: parsed.proteinas_100g,
        carbohidratos_per_unit: parsed.carbohidratos_100g,
        grasas_per_unit: parsed.grasas_100g,
        kcal_100g: 0,
        proteinas_100g: 0,
        carbohidratos_100g: 0,
        grasas_100g: 0,
        fibra_100g: 0,
      }
    } else {
      draft = { ...session.draft, ...parsed }
    }
    await setSession(chatId, { step: 'awaiting_catalog_confirm', draft })
    await promptCatalogConfirm(chatId, draft)
    return
  }

  if (session.step === 'awaiting_edit_qty') {
    const qty = Number(text.replace(',', '.'))
    if (!Number.isFinite(qty) || qty <= 0 || qty > 5000) {
      await bot.sendMessage(chatId, 'Cantidad no válida. Escribe solo gramos, por ejemplo: 180')
      return
    }

    const db = getDb()
    const { data: updatedId } = await db.rpc('bot_update_consumo_qty', {
      p_chat_id: chatId,
      p_consumo_id: session.entry.id,
      p_new_qty: qty,
    })

    await setSession(chatId, { step: 'idle' })

    if (!updatedId) {
      await bot.sendMessage(chatId, '❌ No he podido actualizar esa entrada.')
      await sendMainMenu(chatId)
      return
    }

    await bot.sendMessage(
      chatId,
      `✅ Cantidad actualizada: *${session.entry.nombre_alimento}* ahora son *${qty}g*.`,
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
    return
  }

  // ── Default: treat free text as food search from main menu ──
  await setSession(chatId, { step: 'awaiting_food_query', mealType: 'otro', mealNumber: 1 })
  // Re-process as food search
  const parsed = parseQtyAndQuery(text)
  await bot.sendMessage(chatId, `🔍 Buscando *${parsed.query}*...`, { parse_mode: 'Markdown' })

  const foods = await searchFoodsMerged(chatId, parsed.query)
  if (foods.length === 0) {
    await bot.sendMessage(chatId, 'Sin resultados. ¿Qué quieres hacer?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ ¿No te cuadran los macros? Añádelo', callback_data: 'ca_quick' }],
          [{ text: '« Menú principal', callback_data: 'menu' }],
        ],
      },
    })
    return
  }

  await setSession(chatId, {
    step: 'selecting_food',
    mealType: 'otro',
    mealNumber: 1,
    foods,
    proposedQty: parsed.qty ?? undefined,
  })

  await sendFoodResults(chatId, foods, 'otro', 1, parsed.qty ?? undefined)
}

// ─── Macros today handler ────────────────────────────────────────────────────

async function handleMacrosToday(chatId: number) {
  const db = getDb()
  const [{ data: macros }, { data: objetivo }] = await Promise.all([
    db.rpc('bot_get_macros_today', { p_chat_id: chatId }),
    db.rpc('bot_get_objetivo', { p_chat_id: chatId }),
  ])

  const m = macros?.[0]
  const o = objetivo?.[0] ?? null

  if (!m || Number(m.num_entradas) === 0) {
    await getBot().sendMessage(
      chatId,
      '📊 *Macros de hoy*\n\nAún no has registrado nada hoy. ¡Empieza registrando tu primera comida! 💪',
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
    return
  }

  const goalLine = o
    ? `\n\n🎯 *Objetivo diario:* ${o.kcal} kcal\n${buildMacroBar(Number(m.kcal), Number(o.kcal))}`
    : ''

  await getBot().sendMessage(
    chatId,
    `📊 *Macros de hoy*\n\n` +
      `🔥 Calorías: *${m.kcal} kcal*\n` +
      `🥩 Proteínas: *${m.proteinas}g*\n` +
      `🍞 Carbohidratos: *${m.carbohidratos}g*\n` +
      `🧈 Grasas: *${m.grasas}g*\n` +
      `🌿 Fibra: *${m.fibra}g*\n` +
      `📝 Entradas: *${m.num_entradas}*` +
      goalLine,
    { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
  )
}

// ─── History handler ─────────────────────────────────────────────────────────

async function handleHistory(chatId: number) {
  const db = getDb()
  const { data: rows } = await db.rpc('bot_get_history', { p_chat_id: chatId })

  if (!rows || rows.length === 0) {
    await getBot().sendMessage(
      chatId,
      '📅 No hay datos de los últimos 7 días todavía.',
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
    return
  }

  const lines = rows.map((r: { fecha: string; kcal: number; proteinas: number; carbohidratos: number; grasas: number }) => {
    const d = new Date(r.fecha + 'T12:00:00')
    const label = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    return `• *${label}*: ${r.kcal} kcal · P:${r.proteinas}g C:${r.carbohidratos}g G:${r.grasas}g`
  })

  await getBot().sendMessage(
    chatId,
    `📅 *Historial — últimos 7 días*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
  )
}

// ─── Catalog handler ─────────────────────────────────────────────────────────

async function handleCatalog(chatId: number) {
  const db = getDb()
  const { data: foods } = await db.rpc('bot_get_user_foods', { p_chat_id: chatId })

  if (!foods || foods.length === 0) {
    await getBot().sendMessage(
      chatId,
      '🍎 Tu catálogo personal está vacío. Puedes añadir alimentos desde la app web de MacrAI.',
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
    return
  }

  const lines = foods.map(
    (f: { nombre: string; kcal_100g: number; proteinas_100g: number; carbohidratos_100g: number; grasas_100g: number }) =>
      `• *${f.nombre}* — ${f.kcal_100g} kcal · P:${f.proteinas_100g}g C:${f.carbohidratos_100g}g G:${f.grasas_100g}g`
  )

  await getBot().sendMessage(
    chatId,
    `🍎 *Mi catálogo* (${foods.length} alimentos)\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
  )
}
