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
import type { FoodItem } from '@/types'

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

type BotSession =
  | { step: 'idle' }
  | { step: 'selecting_meal_type' }
  | { step: 'awaiting_food_query'; mealType: MealType; mealNumber: number }
  | { step: 'selecting_food'; mealType: MealType; mealNumber: number; foods: FoodItem[] }
  | { step: 'awaiting_food_qty'; mealType: MealType; mealNumber: number; food: FoodItem }

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
          `🍎 *Mi catálogo* — Revisa tus alimentos personales.\n\n` +
          `_Puedes escribir el nombre de un alimento directamente en el chat para buscarlo rápido._`,
        { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
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
    await bot.sendMessage(
      chatId,
      '📸 ¡Foto recibida! El análisis de imágenes de alimentos estará disponible muy pronto.\n\nMientras tanto, puedes buscar el alimento por nombre con el botón de *Registrar comida*.',
      { parse_mode: 'Markdown', reply_markup: MAIN_MENU_KEYBOARD }
    )
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
    const query = text
    await bot.sendMessage(chatId, `🔍 Buscando *${query}*...`, { parse_mode: 'Markdown' })

    const foods = await searchOpenFoodFacts(query, 6)

    if (foods.length === 0) {
      await bot.sendMessage(
        chatId,
        'No he encontrado resultados para ese alimento. Intenta con otro nombre.',
        { reply_markup: { inline_keyboard: [[{ text: '« Cancelar', callback_data: 'menu' }]] } }
      )
      return
    }

    await setSession(chatId, {
      step: 'selecting_food',
      mealType: session.mealType,
      mealNumber: session.mealNumber,
      foods,
    })

    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        ...foods.map((f, i) => [
          {
            text: `${f.nombre.slice(0, 40)} (${f.kcal_100g} kcal/100g)`,
            callback_data: `sf:${i}`,
          },
        ]),
        [{ text: '🔍 Buscar de nuevo', callback_data: `mt:${session.mealType}:${session.mealNumber}` }],
        [{ text: '« Cancelar', callback_data: 'menu' }],
      ],
    }

    await bot.sendMessage(chatId, 'Selecciona el alimento:', { reply_markup: keyboard })
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

  // ── Default: treat free text as food search from main menu ──
  await setSession(chatId, { step: 'awaiting_food_query', mealType: 'otro', mealNumber: 1 })
  // Re-process as food search
  await bot.sendMessage(chatId, `🔍 Buscando *${text}*...`, { parse_mode: 'Markdown' })

  const foods = await searchOpenFoodFacts(text, 6)
  if (foods.length === 0) {
    await sendMainMenu(chatId, 'Sin resultados. ¿Qué quieres hacer?')
    return
  }

  await setSession(chatId, {
    step: 'selecting_food',
    mealType: 'otro',
    mealNumber: 1,
    foods,
  })

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...foods.map((f, i) => [
        {
          text: `${f.nombre.slice(0, 40)} (${f.kcal_100g} kcal/100g)`,
          callback_data: `sf:${i}`,
        },
      ]),
      [{ text: '« Cancelar', callback_data: 'menu' }],
    ],
  }
  await bot.sendMessage(chatId, 'Selecciona el alimento:', { reply_markup: keyboard })
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
