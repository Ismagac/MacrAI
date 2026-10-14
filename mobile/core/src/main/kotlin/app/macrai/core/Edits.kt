package app.macrai.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus

// Ediciones del registro y del catálogo. Las usan el chat y las pantallas de edición manual,
// así que un cambio hecho a mano recalcula lo mismo que uno pedido por mensaje (regla 6).

/** Cuántos días hacia atrás se recalculan al corregir un producto: la semana del balance. */
const val RECALC_DAYS = 6

fun StoreState.updateEntryGrams(id: String, grams: Double): StoreState =
    copy(entries = entries.map { if (it.id == id) it.rescaledTo(grams).copy(statedGrams = null) else it })

fun StoreState.moveEntry(id: String, meal: Meal): StoreState =
    copy(entries = entries.map { if (it.id == id) it.copy(meal = meal) else it })

fun StoreState.deleteEntry(id: String): StoreState = copy(entries = entries.filterNot { it.id == id })

/**
 * Guarda un perfil del catálogo y recalcula las entradas recientes que lo usan, para que
 * comida, día y balance cuadren con el valor nuevo.
 */
fun StoreState.upsertFood(food: FoodProfile, today: LocalDate? = openDay): StoreState {
    val since = today?.minus(DatePeriod(days = RECALC_DAYS))
    val recalculated = entries.map { e ->
        if (e.foodId != food.id || (since != null && e.day < since) || e.kcalOnly) return@map e
        val macros = when {
            e.grams > 0 -> food.macrosForGrams(e.grams)
            else -> food.macrosForUnits(e.units ?: 1.0) ?: e.macros
        }
        e.copy(macros = macros, source = food.source, provisional = false)
    }
    val exists = catalog.any { it.id == food.id }
    return copy(
        catalog = if (exists) catalog.map { if (it.id == food.id) food else it } else catalog + food,
        entries = recalculated,
    )
}

/** Las entradas ya registradas se quedan con sus macros; solo deja de estar en el catálogo. */
fun StoreState.deleteFood(id: String): StoreState = copy(catalog = catalog.filterNot { it.id == id })

/** Un alias pertenece a un solo alimento: si ya lo tenía otro, se mueve. */
fun StoreState.addAlias(foodId: String, alias: String): StoreState {
    val clean = alias.trim()
    if (clean.isEmpty()) return this
    val key = normalizeText(clean)
    return copy(
        catalog = catalog.map { f ->
            val others = f.aliases.filterNot { normalizeText(it) == key }
            if (f.id == foodId) f.copy(aliases = others + clean) else f.copy(aliases = others)
        },
    )
}

fun StoreState.removeAlias(foodId: String, alias: String): StoreState =
    copy(catalog = catalog.map { f -> if (f.id == foodId) f.copy(aliases = f.aliases - alias) else f })
