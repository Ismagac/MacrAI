package app.macrai.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.minus
import kotlinx.datetime.plus

// Motor del chat: el modelo interpreta, el motor decide y calcula.
//
// 1. El modelo (Gemini Nano en el dispositivo o Gemini en la nube) devuelve acciones JSON.
// 2. El motor las aplica con las reglas del documento de comportamiento: día, comida,
//    cascada de alimentos, cantidades, correcciones. Todo supuesto queda escrito.
// 3. La respuesta se compone desde las entradas guardadas, nunca sumando sobre un total
//    anterior (§14.4), con la forma fija del §11.1.

enum class ModelTier {
    /** Gemini Nano si el dispositivo lo tiene; si no, la nube. */
    ON_DEVICE_PREFERRED,
    CLOUD,
}

data class ModelRequest(
    val prompt: String,
    val system: String? = null,
    val image: ByteArray? = null,
    val tier: ModelTier,
)

fun interface LanguageModel {
    suspend fun generate(request: ModelRequest): String
}

class UserMessage(
    val text: String,
    val at: LocalDateTime,
    /** Texto de la etiqueta reconocido en el dispositivo (ML Kit), si hay foto. */
    val ocrText: String? = null,
    val image: ByteArray? = null,
    /** EAN leído en la foto (ML Kit), si había un código de barras. */
    val barcode: String? = null,
)

/** Más largo que esto es un dictado: no cabe en la salida del modelo local. */
const val ON_DEVICE_MAX_CHARS = 220

/** Veces que una misma forma de decir algo debe acabar en el mismo alimento antes de proponer el alias. */
const val ALIAS_CONFIRM_AFTER = 2

class MacroAssistant(
    private val store: MacroStore,
    private val model: LanguageModel,
    private val behaviorDoc: String,
    /** Base de productos de marca (Open Food Facts). Sin ella, lo que no esté en el catálogo se estima. */
    private val foods: FoodDatabase? = null,
) {
    suspend fun handle(message: UserMessage): AssistantReply {
        val state = store.state()
        val parsed = extract(message, state)
        val turn = Turn(message.at)
        if (parsed == null) {
            if (message.barcode == null) {
                return AssistantReply(listOf(ReplyBlock.Text("No he podido interpretarlo. ¿Me lo repites con otras palabras?")))
            }
        } else {
            notifyMishearings(parsed, turn)
            for (action in parsed.acciones) apply(action, message, turn)
        }
        // Foto de un código de barras sin cantidad: se identifica el producto y se pregunta cuánto.
        val usedBarcode = parsed?.acciones.orEmpty().any { it is Action.Add || it is Action.SaveLabel || it is Action.CorrectProduct }
        if (message.barcode != null && !usedBarcode) identifyBarcode(message.barcode, turn)
        return compose(turn)
    }

    private suspend fun identifyBarcode(code: String, turn: Turn) {
        val state = store.state()
        val known = state.catalog.firstOrNull { it.barcode == code }
        val food = known ?: foods?.let { runCatching { it.byBarcode(code) }.getOrNull() }?.copy(id = newId())
        if (food == null) {
            turn.blocks += ReplyBlock.Text("No encuentro el código $code en Open Food Facts.")
            turn.ask("¿Me pasas la foto de la tabla nutricional?")
            return
        }
        if (known == null) store.update { it.upsertFood(food) }
        val origin = if (known != null) "Lo tienes en tu catálogo" else "Lo he encontrado en ${food.origin ?: "la base de productos"} y lo he guardado en tu catálogo"
        turn.blocks += ReplyBlock.Title(food.displayName + (food.packFormat?.let { " ($it)" } ?: ""))
        turn.blocks += ReplyBlock.Text("$origin. ${labelSummary(food)}")
        turn.ask("¿Cuánto has tomado y en qué comida?")
    }

    private suspend fun extract(message: UserMessage, state: StoreState): ParsedMessage? {
        val pending = state.pending.lastOrNull { !it.reminded && it.day == state.openDay }?.text
        val prompt = buildExtractionPrompt(message.text, state.catalog, state.lastEntry?.meal, message.ocrText, pending)
        val needsCloud = message.text.length > ON_DEVICE_MAX_CHARS || (message.image != null && message.ocrText.isNullOrBlank())
        val firstTier = if (needsCloud) ModelTier.CLOUD else ModelTier.ON_DEVICE_PREFERRED

        val first = runCatching { model.generate(ModelRequest(prompt, image = message.image, tier = firstTier)) }
            .getOrNull()?.let(::parseModelOutput)
        if (first != null && first.acciones.isNotEmpty()) return first
        if (firstTier == ModelTier.CLOUD) return first

        // El modelo local no lo ha sacado: una segunda pasada en la nube antes de rendirse.
        return runCatching { model.generate(ModelRequest(prompt, image = message.image, tier = ModelTier.CLOUD)) }
            .getOrNull()?.let(::parseModelOutput)
    }

    // ─── Estado de un turno ──────────────────────────────────────────────────

    private class Turn(val now: LocalDateTime) {
        val added = mutableListOf<LogEntry>()
        /** Comidas que ya tenían algo antes de este mensaje: el título dice "actualizada". */
        val mealsWithPrevious = mutableSetOf<Pair<LocalDate, Meal>>()
        val notes = mutableListOf<String>()
        val blocks = mutableListOf<ReplyBlock>()
        var question: String? = null
        var touchedDay: LocalDate? = null
        var showDay = false
        var finalDay = false

        fun ask(text: String) {
            if (question == null) question = text
        }
    }

    private suspend fun notifyMishearings(parsed: ParsedMessage, turn: Turn) {
        val state = store.state()
        val fresh = parsed.voz.filter { "voz:${normalizeText(it.oido)}" !in state.notedOnce }
        if (fresh.isEmpty()) return
        turn.notes += fresh.joinToString(" ") { "He entendido «${it.oido}» como «${it.entendido}»." }
        store.update { s -> s.copy(notedOnce = s.notedOnce + fresh.map { "voz:${normalizeText(it.oido)}" }) }
    }


    private fun dayFor(state: StoreState, now: LocalDateTime, meal: Meal?, dia: String, signal: DaySignal = DaySignal.NONE): DayDecision {
        val current = resolveLogDay(now, state.openDay, state.lastEntry?.loggedAt, signal, meal)
        return if (dia == "ayer") DayDecision(resolvePreviousDay(now, current), DayReason.SAME_DAY) else current
    }

    private fun dayNote(decision: DayDecision, now: LocalDateTime, meal: Meal): String? = when (decision.reason) {
        DayReason.AFTER_MIDNIGHT ->
            "Lo cuento en la ${meal.label.lowercase()} del ${dayLabel(decision.day)}, porque son más de la " +
                "${now.hour}:00 y aún no has cerrado el día."
        DayReason.NEW_DAY_AFTER_SLEEP -> "Empiezo el ${dayLabel(decision.day)} con el desayuno."
        else -> null
    }

    // ─── Acciones ────────────────────────────────────────────────────────────

    private suspend fun apply(action: Action, message: UserMessage, turn: Turn) {
        when (action) {
            is Action.Add -> add(action, message, turn)
            is Action.AddKcalOnly -> addKcalOnly(action, turn)
            is Action.CorrectQuantity -> correctQuantity(action, turn)
            is Action.CorrectEdible -> correctEdible(action, turn)
            is Action.CorrectProduct -> correctProduct(action, turn)
            is Action.Partial -> partial(action, turn)
            is Action.Move -> move(action, turn)
            is Action.Delete -> delete(action, turn)
            is Action.SaveLabel -> saveLabel(action, turn)
            is Action.CatalogQuery -> catalogQuery(action, turn)
            is Action.Alias -> alias(action, turn)
            is Action.Answer -> answer(action, turn)
            is Action.Weight -> weight(action, turn)
            is Action.Burn -> burn(action, turn)
            Action.NewDay -> newDay(turn)
            Action.CloseDay -> closeDay(turn)
            is Action.Analysis -> analysis(action, message, turn)
            is Action.Chat -> turn.blocks += ReplyBlock.Text(action.respuesta)
        }
    }

    private suspend fun add(action: Action.Add, message: UserMessage, turn: Turn) {
        // El código de barras de la foto solo identifica al alimento si es el único del mensaje.
        val barcode = message.barcode?.takeIf { action.items.size == 1 }
        for (spec in action.items) {
            val state = store.state()
            val day = dayFor(state, turn.now, action.comida, action.dia)
            val lastInDay = state.entriesOf(day.day).maxByOrNull { it.loggedAt }
            val meal = resolveMeal(turn.now, action.comida, day, lastInDay)

            val web = if (needsProductLookup(spec, state, barcode)) lookupProduct(spec, barcode) else null
            val choice = chooseProfile(spec, state.catalog, state.entries, newId = ::newId, barcode = barcode, web = web)
            if (choice == null) {
                turn.ask("No tengo «${spec.alimento}» en el catálogo. ¿Cuántas kcal tiene, o me pasas la etiqueta?")
                continue
            }
            val result = resolveItem(spec, choice.profile, choice.isNew)
            if (result is ItemResult.Missing) {
                turn.ask(result.question)
                val key = pendingKey(choice.profile)
                store.update { s -> s.copy(pending = s.pending.filterNot { it.key == key } + PendingQuestion(key, result.question, day.day)) }
                continue
            }
            result as ItemResult.Resolved

            // "Actualizada" solo si la comida ya tenía algo antes de este mensaje.
            if (state.entriesOf(day.day).any { it.meal == meal.meal && it !in turn.added }) turn.mealsWithPrevious += day.day to meal.meal
            dayNote(day, turn.now, meal.meal)?.let { if (it !in turn.notes) turn.notes += it }
            if (meal.reason == MealReason.LAST_ENTRY_DOUBTFUL && meal.clockSuggests != null && turn.added.isEmpty()) {
                turn.notes += "Lo he puesto en la ${meal.meal.label.lowercase()} porque es lo último que registraste; " +
                    "si es ${meal.clockSuggests.label.lowercase()}, dímelo y lo muevo."
            }
            turn.notes += choice.notes
            turn.notes += result.assumptions

            val entry = LogEntry(
                id = newId(),
                day = day.day,
                meal = meal.meal,
                name = result.name,
                grams = result.grams,
                macros = result.macros,
                foodId = result.foodId,
                source = result.source,
                assumptions = result.assumptions,
                provisional = result.provisional,
                statedGrams = result.statedGrams,
                units = result.units,
                loggedAt = turn.now,
            )
            store.update { s ->
                val catalog = if (choice.isNew) s.catalog + choice.profile
                else s.catalog.map { if (it.id == choice.profile.id) choice.profile else it }
                s.copy(
                    entries = s.entries + entry,
                    catalog = catalog,
                    openDay = if (action.dia == "ayer") s.openDay else maxOfNullable(s.openDay, day.day),
                    pending = s.pending.filterNot { it.key == pendingKey(choice.profile) },
                )
            }
            turn.added += entry
            turn.touchedDay = day.day
            turn.showDay = true
            if (!choice.isNew) learnAlias(spec, choice.profile, turn)
        }
    }

    /**
     * Paso 4 de la cascada: solo si no hay etiqueta, ni entrada en el catálogo, ni kcal del
     * usuario; y solo para productos de marca, con código de barras o que el modelo no sabe estimar.
     * Los genéricos ("pechuga de pollo") se estiman: en la base salen marcas al azar.
     */
    private fun needsProductLookup(spec: ItemSpec, state: StoreState, barcode: String?): Boolean =
        foods != null &&
            spec.etiqueta == null &&
            spec.kcalPer100 == null &&
            findInCatalogFor(spec, state.catalog, state.entries, barcode) == null &&
            (spec.marca != null || barcode != null || spec.estimatePer100 == null)

    private suspend fun lookupProduct(spec: ItemSpec, barcode: String?): FoodProfile? {
        val db = foods ?: return null
        return runCatching {
            barcode?.let { db.byBarcode(it) } ?: db.search(listOfNotNull(spec.alimento, spec.marca).joinToString(" "))
                .firstOrNull { p ->
                    p.bestScore(spec.alimento) >= MIN_MATCH_SCORE &&
                        (spec.marca == null || matchScore(spec.marca, p.brand ?: p.name) > 0)
                }
        }.getOrNull()
    }

    /**
     * Si el usuario llama a un alimento del catálogo de una forma que no es su nombre ni un alias,
     * y lo hace varias veces, se le pregunta una vez si guardarla como alias.
     */
    private suspend fun learnAlias(spec: ItemSpec, food: FoodProfile, turn: Turn) {
        val phrase = spec.dicho?.trim()?.takeIf { it.length >= 3 } ?: return
        val key = normalizeText(phrase)
        if ((listOf(food.name, food.displayName) + food.aliases).any { normalizeText(it) == key }) return

        val evidenceKey = "$key|${food.id}"
        val state = store.update { s ->
            s.copy(aliasEvidence = s.aliasEvidence + (evidenceKey to (s.aliasEvidence[evidenceKey] ?: 0) + 1))
        }
        val pendingKey = "$ALIAS_KEY${food.id}|$phrase"
        val alreadyAsked = "alias-no:$evidenceKey" in state.notedOnce || state.pending.any { it.key.startsWith("$ALIAS_KEY${food.id}|") }
        if ((state.aliasEvidence[evidenceKey] ?: 0) < ALIAS_CONFIRM_AFTER || alreadyAsked || turn.question != null) return

        val question = "Cuando dices «$phrase», ¿te refieres siempre a ${food.displayName}? Si me dices que sí, lo guardo como alias."
        turn.ask(question)
        store.update { s -> s.copy(pending = s.pending + PendingQuestion(pendingKey, question, s.openDay ?: turn.now.date)) }
    }

    private suspend fun addKcalOnly(action: Action.AddKcalOnly, turn: Turn) {
        val state = store.state()
        val day = dayFor(state, turn.now, action.comida, action.dia)
        val meal = resolveMeal(turn.now, action.comida, day, state.entriesOf(day.day).maxByOrNull { it.loggedAt })
        val entry = LogEntry(
            id = newId(),
            day = day.day,
            meal = meal.meal,
            name = action.descripcion,
            grams = 0.0,
            macros = Macros(kcal = action.kcal),
            kcalOnly = true,
            loggedAt = turn.now,
        )
        store.update { s -> s.copy(entries = s.entries + entry, openDay = maxOfNullable(s.openDay, day.day)) }
        turn.added += entry
        turn.notes += "Registro solo las kcal; la proteína de este día no es fiable."
        turn.touchedDay = day.day
        turn.showDay = true
    }

    private fun findEntry(state: StoreState, query: String?): LogEntry? {
        val day = state.openDay ?: return state.lastEntry
        val pool = state.entriesOf(day).ifEmpty { state.entries }
        if (query.isNullOrBlank()) return pool.maxByOrNull { it.loggedAt }
        return pool
            .map { it to matchScore(query, it.name) }
            .filter { it.second >= MIN_MATCH_SCORE }
            .maxWithOrNull(compareBy<Pair<LogEntry, Double>> { it.second }.thenBy { it.first.loggedAt })
            ?.first
    }

    private fun changeRows(before: LogEntry, after: LogEntry): List<Triple<String, String, String>> = buildList {
        if (before.grams != after.grams) add(Triple("Cantidad", formatGrams(before.grams), formatGrams(after.grams)))
        add(Triple("Kcal", formatKcal(before.macros.kcal), formatKcal(after.macros.kcal)))
        add(Triple("Proteína", formatGrams(before.macros.protein), formatGrams(after.macros.protein)))
        add(Triple("Carbos", formatGrams(before.macros.carbs), formatGrams(after.macros.carbs)))
        add(Triple("Grasas", formatGrams(before.macros.fat), formatGrams(after.macros.fat)))
    }

    private suspend fun correctQuantity(action: Action.CorrectQuantity, turn: Turn) {
        val target = findEntry(store.state(), action.objetivo)
            ?: return turn.ask("¿Qué registro quieres cambiar?")
        val updated = target.rescaledTo(action.cantidad).copy(statedGrams = null)
        store.update { it.updateEntryGrams(target.id, action.cantidad) }
        turn.blocks += ReplyBlock.Title("Corregido: ${target.name}, ${formatGrams(target.grams)} → ${formatGrams(updated.grams)}")
        turn.blocks += ReplyBlock.Change(changeRows(target, updated))
        turn.touchedDay = target.day
        turn.showDay = true
    }

    private suspend fun correctEdible(action: Action.CorrectEdible, turn: Turn) {
        val target = findEntry(store.state(), action.objetivo)
            ?: return turn.ask("¿Qué registro era sin hueso?")
        val stated = target.statedGrams
        if (stated == null) {
            turn.blocks += ReplyBlock.Text("Ya lo tenía como peso comestible (${formatGrams(target.grams)}); no cambia nada.")
            return
        }
        val updated = target.rescaledTo(stated).copy(statedGrams = null)
        store.update { it.updateEntryGrams(target.id, stated) }
        turn.blocks += ReplyBlock.Title("Corregido: ${target.name} sin hueso, ${formatGrams(target.grams)} → ${formatGrams(stated)}")
        turn.blocks += ReplyBlock.Change(changeRows(target, updated))
        turn.touchedDay = target.day
        turn.showDay = true
    }

    /** Recalcula todo lo que depende del producto: comida, día y balance (regla 6). */
    private suspend fun correctProduct(action: Action.CorrectProduct, turn: Turn) {
        val state = store.state()
        val food = findInCatalog(action.alimento, state.catalog, state.entries)
            ?: return turn.ask("No encuentro «${action.alimento}» en el catálogo. ¿Me pasas la etiqueta?")

        val updatedFood = when {
            action.etiqueta != null -> labelToProfile(action.etiqueta, food.id)?.first?.copy(aliases = food.aliases)
            action.kcalPerUnit != null -> food.copy(
                perUnit = (food.perUnit ?: food.unitWeightG?.let { food.per100 * (it / 100) } ?: Macros(kcal = action.kcalPerUnit))
                    .let { base -> if (base.kcal > 0) base * (action.kcalPerUnit / base.kcal) else base },
                source = ValueSource.USER,
            )
            action.kcalPer100 != null -> food.copy(
                per100 = if (food.per100.kcal > 0) food.per100 * (action.kcalPer100 / food.per100.kcal) else food.per100.copy(kcal = action.kcalPer100),
                source = ValueSource.USER,
                macrosEstimated = true,
            )
            else -> null
        } ?: return turn.ask("¿Qué valor tiene ${food.name}?")

        warnIfOdd(updatedFood, turn)

        val since = state.openDay?.minus(DatePeriod(days = RECALC_DAYS))
        val affected = state.entries.filter { it.foodId == food.id && !it.kcalOnly && (since == null || it.day >= since) }
        val updated = store.update { it.upsertFood(updatedFood) }

        turn.blocks += ReplyBlock.Title("Actualizado: ${updatedFood.displayName}")
        if (action.etiqueta != null) turn.notes += labelSummary(updatedFood)
        val last = affected.maxByOrNull { it.loggedAt }
        val lastNew = last?.let { l -> updated.entries.firstOrNull { it.id == l.id } }
        if (last != null && lastNew != null) {
            turn.blocks += ReplyBlock.Change(changeRows(last, lastNew), conclusion = deltaConclusion(last.macros, lastNew.macros))
            turn.touchedDay = last.day
            turn.showDay = true
        }
        if (affected.size > 1) turn.notes += "Recalculadas ${affected.size} entradas de esta semana."
    }

    /** Valor raro del usuario: se registra como lo dice y se avisa una vez (regla 8). */
    private suspend fun warnIfOdd(food: FoodProfile, turn: Turn) {
        val key = "raro:${food.id}"
        if (key in store.state().notedOnce) return
        // Si el valor es por envase, la densidad sale del peso del envase.
        val density = food.perUnit?.let { unit -> food.unitWeightG?.let { unit * (100 / it) } } ?: food.per100
        val verdict = plausibility(density, foodKindOf(food.name))
        if (verdict == Plausibility.UNUSUALLY_LOW || verdict == Plausibility.UNUSUALLY_HIGH) {
            val level = if (verdict == Plausibility.UNUSUALLY_LOW) "bajo" else "alto"
            turn.notes += "Sale a ${formatKcal(density.kcal)} kcal/100 ${food.basis.unit}, que es $level para este tipo de producto; " +
                "mira si la etiqueta decía «por 100 ${food.basis.unit}». Lo dejo como dices."
            store.update { s -> s.copy(notedOnce = s.notedOnce + key) }
        }
    }

    private fun deltaConclusion(before: Macros, after: Macros): String? {
        val parts = listOf(
            "las kcal" to (after.kcal - before.kcal) / 10, // en kcal, 10 equivale a 1 g de macro
            "la proteína" to after.protein - before.protein,
            "los carbos" to after.carbs - before.carbs,
            "las grasas" to after.fat - before.fat,
        ).filter { kotlin.math.abs(it.second) >= 1.0 }
        if (parts.isEmpty()) return "Apenas cambia nada."
        return parts.joinToString(", ", postfix = ".") { (label, delta) ->
            val amount = if (label == "las kcal") "${formatNumber(kotlin.math.abs(delta * 10), 0)} kcal" else formatGrams(kotlin.math.abs(delta))
            "$label ${if (delta > 0) "suben" else "bajan"} $amount"
        }.replaceFirstChar { it.uppercase() }
    }

    private suspend fun partial(action: Action.Partial, turn: Turn) {
        val state = store.state()
        val day = state.openDay ?: return
        val targets = state.entriesOf(day).filter { e -> action.objetivos.any { matchScore(it, e.name) >= MIN_MATCH_SCORE } }
        if (targets.isEmpty()) return turn.ask("¿Qué parte del plato no te comiste?")

        val fraction = action.fraccion.coerceIn(0.0, 1.0)
        val updated = targets.map { it.rescaledTo(it.grams * fraction) }
        store.update { s -> s.copy(entries = s.entries.map { e -> updated.firstOrNull { it.id == e.id } ?: e }) }

        val meal = targets.first().meal
        val untouched = state.entriesOf(day).filter { e -> e.meal == meal && targets.none { it.id == e.id } }
        turn.blocks += ReplyBlock.Title("Corregido: de ${targets.joinToString(" y ") { it.name }} solo cuento ~${formatNumber(fraction * 100, 0)} %")
        turn.notes += buildString {
            append("Toco: ${targets.joinToString(", ") { it.name }}.")
            if (untouched.isNotEmpty()) append(" Cuento como comido: ${untouched.joinToString(", ") { it.name }}.")
        }
        turn.touchedDay = day
        turn.showDay = true
    }

    private suspend fun move(action: Action.Move, turn: Turn) {
        val target = findEntry(store.state(), action.objetivo) ?: return turn.ask("¿Qué registro muevo?")
        store.update { it.moveEntry(target.id, action.comida) }
        turn.blocks += ReplyBlock.Title("Movido: ${target.name}, de ${target.meal.label.lowercase()} a ${action.comida.label.lowercase()}")
        turn.touchedDay = target.day
        turn.showDay = true
    }

    private suspend fun delete(action: Action.Delete, turn: Turn) {
        val target = findEntry(store.state(), action.objetivo) ?: return turn.ask("¿Qué registro borro?")
        store.update { it.deleteEntry(target.id) }
        turn.blocks += ReplyBlock.Title("Borrado: ${formatGrams(target.grams)} ${target.name} de la ${target.meal.label.lowercase()}")
        turn.touchedDay = target.day
        turn.showDay = true
    }

    private suspend fun saveLabel(action: Action.SaveLabel, turn: Turn) {
        val state = store.state()
        val (profile, notes) = labelToProfile(action.etiqueta, newId())
            ?: return turn.ask("No consigo leer los macros de la etiqueta. ¿Me pasas otra foto?")
        val choice = mergeLabelIntoCatalog(profile, state.catalog)
        store.update { it.upsertFood(choice.profile) }
        turn.blocks += ReplyBlock.Title("Guardada: ${choice.profile.displayName}")
        turn.notes += labelSummary(choice.profile)
        choice.profile.packFormat?.let { turn.notes += "Formato: $it." }
        turn.notes += notes + choice.notes
        turn.ask("¿Cuánto has tomado y en qué comida?")
    }

    private suspend fun catalogQuery(action: Action.CatalogQuery, turn: Turn) {
        val state = store.state()
        val food = findInCatalog(action.alimento, state.catalog, state.entries)
        if (food == null) {
            // Fuera del catálogo personal: se busca en la base de productos y, si aparece, se guarda.
            val found = foods?.let { db ->
                runCatching { db.search(action.alimento).firstOrNull { it.bestScore(action.alimento) >= MIN_MATCH_SCORE } }.getOrNull()
            }
            if (found == null) {
                turn.blocks += ReplyBlock.Text("No, no tengo «${action.alimento}» en el catálogo.")
                turn.ask("¿Me pasas la foto de la etiqueta o el código de barras?")
                return
            }
            val saved = found.copy(id = newId())
            store.update { it.upsertFood(saved) }
            turn.blocks += ReplyBlock.Text(
                "No lo tenía, pero en ${saved.origin ?: "la base de productos"} está ${saved.displayName}" +
                    (saved.packFormat?.let { " ($it)" } ?: "") + ". ${labelSummary(saved)} Lo he guardado en tu catálogo.",
            )
            turn.notes += "Si tu producto es otro, pásame la foto de la etiqueta y lo guardo aparte."
            turn.ask("¿Cuánto y en qué comida?")
            return
        }
        turn.blocks += ReplyBlock.Text(
            "Sí: ${food.displayName}. ${labelSummary(food)} Fuente: ${food.source.label}." +
                (food.packFormat?.let { " Formato: $it." } ?: ""),
        )
        val similar = state.catalog
            .filter { it.id != food.id && it.bestScore(action.alimento) >= MIN_MATCH_SCORE }
            .maxByOrNull { it.bestScore(action.alimento) }
        similar?.let {
            turn.notes += "Es distinta de ${it.displayName}: ${formatKcal(it.per100.kcal)} kcal/100 ${it.basis.unit}."
        }
        turn.ask("¿Cuánto y en qué comida?")
    }

    private suspend fun alias(action: Action.Alias, turn: Turn) {
        val state = store.state()
        val food = findInCatalog(action.alimento, state.catalog, state.entries)
            ?: return turn.ask("No tengo «${action.alimento}» en el catálogo. ¿Me pasas la etiqueta o sus valores?")
        store.update { it.addAlias(food.id, action.alias) }
        turn.blocks += ReplyBlock.Title("Alias guardado: «${action.alias}» = ${food.displayName}")
    }

    /** Sí o no a la última pregunta de alias pendiente (clave "alias:<idAlimento>|<frase>"). */
    private suspend fun answer(action: Action.Answer, turn: Turn) {
        val pending = store.state().pending.lastOrNull { it.key.startsWith(ALIAS_KEY) }
        if (pending == null) {
            turn.blocks += ReplyBlock.Text("No tenía nada pendiente de confirmar.")
            return
        }
        val (foodId, phrase) = pending.key.removePrefix(ALIAS_KEY).split('|', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        val updated = store.update { s ->
            val cleared = s.copy(pending = s.pending - pending)
            if (action.si) cleared.addAlias(foodId, phrase)
            else cleared.copy(notedOnce = cleared.notedOnce + "alias-no:${normalizeText(phrase)}|$foodId")
        }
        val food = updated.food(foodId)?.displayName ?: "ese alimento"
        turn.blocks += ReplyBlock.Text(
            if (action.si) "Hecho: cuando digas «$phrase» entiendo $food." else "Vale, no lo guardo como alias.",
        )
    }

    private suspend fun weight(action: Action.Weight, turn: Turn) {
        val state = store.state()
        // El peso en ayunas es el marcador más fiable de que ya es otro día.
        val day = resolveLogDay(turn.now, state.openDay, state.lastEntry?.loggedAt, DaySignal.MORNING_WEIGH_IN).day
        val previous = state.weighIns.filter { it.day < day }.maxByOrNull { it.day }
        val updated = store.update { s ->
            s.copy(
                weighIns = s.weighIns.filterNot { it.day == day } + WeighIn(day, action.kg),
                openDay = maxOfNullable(s.openDay, day),
                // El mínimo de proteína (§15) sigue al peso real.
                user = s.user.copy(weightKg = action.kg),
            )
        }

        val recent = updated.weighIns.filter { it.day > day.minus(DatePeriod(days = 7)) }.sortedBy { it.day }
        turn.blocks += ReplyBlock.Title("Peso del ${dayLabel(day)}: ${formatNumber(action.kg, 1)} kg")
        turn.blocks += ReplyBlock.Weights(recent, average(recent))

        if (previous != null) {
            val change = action.kg - previous.kg
            val balances = generateSequence(previous.day) { it.plus(DatePeriod(days = 1)) }
                .takeWhile { it < day }
                .map { d -> buildDayBalance(d, updated.entries, updated.expenditures.firstOrNull { it.day == d }, null) }
                .toList()
            val deficits = balances.mapNotNull { it.deficit }
            turn.notes += if (deficits.isEmpty()) {
                "${formatSigned(change, 1)} kg desde el ${dayLabel(previous.day)}."
            } else {
                val reading = readWeightChange(change, deficits.sum())
                "${formatSigned(change, 1)} kg desde el ${dayLabel(previous.day)}. El déficit de esos días " +
                    "(~${formatNumber(deficits.sum(), 0)} kcal) explica ~${formatNumber(-reading.fatKg, 2)} kg de grasa; " +
                    "el resto es agua, glucógeno y contenido intestinal."
            }
        }
        if (recent.size < 7) turn.notes += "Con menos de 7 días de pesajes no saco conclusiones: la comparación fiable es media semanal contra media semanal."
    }

    private suspend fun burn(action: Action.Burn, turn: Turn) {
        val state = store.state()
        val day = action.fecha?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: state.openDay ?: turn.now.date
        store.update { s ->
            s.copy(expenditures = s.expenditures.filterNot { it.day == day } + Expenditure(day, action.kcal, action.pasos, ExpenditureSource.SCREENSHOT))
        }
        turn.blocks += ReplyBlock.Title("Gasto del ${dayLabel(day)}: ${formatNumber(action.kcal, 0)} kcal")
        weekBalance(day, turn)
        if (day == store.state().openDay && day !in store.state().closedDays) {
            turn.notes += "Balance provisional: el déficit de hoy bajará kcal a kcal con lo que comas."
        }
    }

    private suspend fun weekBalance(day: LocalDate, turn: Turn) {
        val state = store.state()
        val target = state.user.dailyDeficitTarget
        val balance = state.weekBalance(day)
        val period = balance.period
        turn.blocks += balance

        val line = buildString {
            append("Déficit acumulado ~${formatNumber(period.accumulatedDeficit, 0)} kcal (≈${formatNumber(period.theoreticalFatKg, 2)} kg de grasa teóricos).")
            if (target != null) {
                val daysLeft = 7 - day.dayOfWeek.isoDayNumber
                period.remainingPerDay(target * 7, daysLeft)?.let {
                    append(" Para el objetivo semanal faltan ~${formatNumber(target * 7 - period.accumulatedDeficit, 0)}: ${formatNumber(it, 0)} al día.")
                }
            }
        }
        turn.notes += line
    }

    private suspend fun newDay(turn: Turn) {
        val state = store.state()
        val day = resolveLogDay(turn.now, state.openDay, state.lastEntry?.loggedAt, DaySignal.EXPLICIT_NEW_DAY).day
        store.update { it.copy(openDay = day) }
        turn.blocks += ReplyBlock.Text("Nuevo día: ${dayLabel(day)}. Lo siguiente va al desayuno.")
    }

    private suspend fun closeDay(turn: Turn) {
        val state = store.state()
        val day = state.openDay
        if (day == null) {
            turn.blocks += ReplyBlock.Text("Todavía no hay nada registrado.")
            return
        }
        val pending = state.pending.filter { it.day == day && !it.reminded }
        store.update { s ->
            s.copy(closedDays = s.closedDays + day, pending = s.pending.map { if (it in pending) it.copy(reminded = true) else it })
        }
        turn.touchedDay = day
        turn.showDay = true
        turn.finalDay = true
        if (pending.isNotEmpty()) turn.notes += "Cierro sin: ${pending.joinToString("; ") { it.text.trimEnd('?').trimStart('¿') }}."
        weekBalance(day, turn)
    }

    private suspend fun analysis(action: Action.Analysis, message: UserMessage, turn: Turn) {
        val state = store.state()
        val facts = factsFor(state)
        val answer = runCatching {
            model.generate(
                ModelRequest(
                    prompt = message.text,
                    system = buildReasoningPrompt(behaviorDoc, facts),
                    tier = ModelTier.CLOUD,
                ),
            )
        }.getOrElse { "Ahora no puedo conectar con el modelo de análisis. Los datos de la semana están en Semana." }
        turn.blocks += ReplyBlock.Text(answer.trim())
    }

    private fun factsFor(state: StoreState): String = buildString {
        val day = state.openDay ?: return@buildString
        val monday = mondayOf(day)
        val target = state.user.dailyDeficitTarget
        appendLine("Día abierto: ${dayLabel(day)} $day.")
        state.user.proteinMinimum?.let { appendLine("Mínimo de proteína: ${formatNumber(it, 0)} g.") }
        target?.let { appendLine("Déficit objetivo: ${formatNumber(it, 0)} kcal/día.") }
        generateSequence(monday) { it.plus(DatePeriod(days = 1)) }.takeWhile { it <= day }.forEach { d ->
            val b = buildDayBalance(d, state.entries, state.expenditures.firstOrNull { it.day == d }, target)
            val protein = state.entriesOf(d).map { it.macros }.sum().protein
            appendLine(
                "- ${dayLabel(d)}: comido ${formatNumber(b.intake, 0)} kcal, proteína ${formatNumber(protein, 0)} g, " +
                    "gasto ${b.expenditure?.let { formatNumber(it, 0) } ?: "sin dato"}, déficit ${b.deficit?.let { formatNumber(it, 0) } ?: "-"}" +
                    (if (b.estimated) " (estimado)" else ""),
            )
        }
        state.weighIns.sortedBy { it.day }.takeLast(14).forEach { appendLine("- peso ${it.day}: ${formatNumber(it.kg, 1)} kg") }
    }

    // ─── Respuesta ───────────────────────────────────────────────────────────

    private suspend fun compose(turn: Turn): AssistantReply {
        val state = store.state()
        val blocks = mutableListOf<ReplyBlock>()
        val meals = turn.added.map { it.day to it.meal }.distinct()
        val dictation = meals.size > 1

        if (turn.added.isNotEmpty()) {
            if (dictation) {
                blocks += ReplyBlock.Title("Registrado el ${dayLabel(turn.added.first().day)}: ${turn.added.size} alimentos en ${meals.size} comidas")
            } else {
                val (day, meal) = meals.single()
                val verb = if ((day to meal) in turn.mealsWithPrevious) "actualizada" else "añadida"
                blocks += ReplyBlock.Title("${meal.label} $verb: " + turn.added.joinToString(" ") { "+ ${describeAmount(it)} ${it.name}" })
            }
        }
        blocks += turn.blocks.filterIsInstance<ReplyBlock.Title>()

        val notes = if (dictation) {
            // Solo los supuestos que más pesan, y el margen del día (§2.7).
            val heavy = turn.added.filter { it.assumptions.isNotEmpty() }.sortedByDescending { it.macros.kcal }.take(7)
                .flatMap { it.assumptions }
            (turn.notes.filterNot { n -> turn.added.any { n in it.assumptions } } + heavy).distinct() +
                (if (turn.added.any { it.isEstimate }) listOf("Margen del día: ±15-20 %, al ser a ojo.") else emptyList())
        } else {
            turn.notes.distinct().take(3)
        }
        if (notes.isNotEmpty()) blocks += ReplyBlock.Notes(notes)

        if (turn.added.isNotEmpty() && !dictation) {
            blocks += ReplyBlock.Foods(turn.added.map { ReplyBlock.FoodRow(it.name, describeAmount(it), it.macros.rounded(), it.source) })
            val (day, meal) = meals.single()
            val mealEntries = state.entriesOf(day).filter { it.meal == meal }
            // Con un solo alimento en la comida, su tabla ya es la de la comida (§11.2).
            if (mealEntries.size > 1) {
                blocks += ReplyBlock.MealTotal(meal, mealEntries.map { it.macros }.sum().rounded(), mealEntries.any { it.isEstimate })
            }
        }
        blocks += turn.blocks.filterNot { it is ReplyBlock.Title || it is ReplyBlock.Balance }

        val day = turn.touchedDay
        if (turn.showDay && day != null) {
            blocks += dayTotal(state, day, turn.finalDay)
            proteinLine(state, day)?.let { blocks += ReplyBlock.Text(it) }
        }
        blocks += turn.blocks.filterIsInstance<ReplyBlock.Balance>()

        val question = turn.question ?: nextStepQuestion(turn)
        question?.let { blocks += ReplyBlock.Question(it) }
        return AssistantReply(blocks)
    }

    private fun describeAmount(e: LogEntry): String = when {
        e.kcalOnly -> "~${formatNumber(e.macros.kcal, 0)} kcal"
        e.grams == 0.0 -> "${formatNumber(e.units ?: 1.0)} ud"
        else -> formatGrams(e.grams)
    }

    private fun dayTotal(state: StoreState, day: LocalDate, final: Boolean): ReplyBlock.DayTotal {
        val entries = state.entriesOf(day)
        val rows = Meal.entries.map { meal ->
            val inMeal = entries.filter { it.meal == meal }
            ReplyBlock.MealRow(meal, inMeal.takeIf { it.isNotEmpty() }?.map { it.macros }?.sum()?.rounded())
        }
        return ReplyBlock.DayTotal(day, rows, entries.map { it.macros }.sum().rounded(), entries.any { it.isEstimate }, final)
    }

    private fun proteinLine(state: StoreState, day: LocalDate): String? {
        val minimum = state.user.proteinMinimum ?: return null
        val protein = state.entriesOf(day).map { it.macros }.sum().protein
        val missing = minimum - protein
        return if (missing > 0) "Te faltan unos ${formatNumber(missing, 0)} g de proteína para el mínimo de ${formatNumber(minimum, 0)} g." else null
    }

    private fun nextStepQuestion(turn: Turn): String? {
        if (turn.finalDay) return null
        val meal = turn.added.lastOrNull()?.meal ?: return null
        if (meal == Meal.CENA) return "¿Algo más en la cena o cerramos el día?"
        val next = Meal.entries[meal.ordinal + 1]
        return "¿Algo más en ${meal.label.lowercase()} o pasamos a ${next.label.lowercase()}?"
    }
}

private const val ALIAS_KEY = "alias:"

private fun pendingKey(food: FoodProfile) = "cantidad:${normalizeText(food.name)}"

private fun maxOfNullable(a: LocalDate?, b: LocalDate): LocalDate = if (a == null || b > a) b else a
