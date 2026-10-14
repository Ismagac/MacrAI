package app.macrai.core

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

// Los números cuadran siempre (regla 10): se calculan aquí, nunca en el modelo.

fun roundTo(value: Double, decimals: Int): Double {
    val factor = 10.0.pow(decimals)
    return (value * factor).roundToLong() / factor
}

/** Redondeo de presentación: kcal y macros a un decimal como mucho (§11.2). */
fun Macros.rounded(): Macros = Macros(roundTo(kcal, 1), roundTo(protein, 1), roundTo(carbs, 1), roundTo(fat, 1))

fun kcalFromMacros(m: Macros): Double = 4 * m.protein + 4 * m.carbs + 9 * m.fat

data class LabelCheck(val declaredKcal: Double, val computedKcal: Double) {
    val deviation: Double get() = if (declaredKcal == 0.0) 0.0 else abs(computedKcal - declaredKcal) / declaredKcal
    val consistent: Boolean get() = deviation <= LABEL_TOLERANCE
}

const val LABEL_TOLERANCE = 0.10

/**
 * kcal ≈ 4·P + 4·C + 9·G con ±10 % (§6.2). Detecta filas desplazadas y kcal tapadas.
 * La fibra y los polialcoholes explican desviaciones pequeñas, por eso la tolerancia.
 */
fun checkLabel(per100: Macros): LabelCheck = LabelCheck(per100.kcal, kcalFromMacros(per100))

/** Kcal tapadas en la etiqueta: se reconstruyen desde los macros y se dice. */
fun Macros.withKcalFromMacros(): Macros = copy(kcal = roundTo(kcalFromMacros(this), 1))

/**
 * Entre varias lecturas posibles de una tabla (p. ej. la fila desplazada del queso crema)
 * gana la única que cuadra. Si cuadran varias o ninguna, devuelve null y se pregunta.
 */
fun pickConsistentReading(readings: List<Macros>): Macros? =
    readings.filter { checkLabel(it).consistent }.singleOrNull()

enum class Plausibility { OK, UNUSUALLY_LOW, UNUSUALLY_HIGH, IMPOSSIBLE }

/** Densidades máximas por tipo (§14.3): nada sólido supera ~900 kcal/100 g. */
fun plausibility(per100: Macros, kind: FoodKind = FoodKind.OTHER): Plausibility {
    if (per100.kcal > 900 || per100.protein + per100.carbs + per100.fat > 100) return Plausibility.IMPOSSIBLE
    return when (kind) {
        FoodKind.DAIRY_DRINK -> when {
            per100.kcal < 25 -> Plausibility.UNUSUALLY_LOW
            per100.kcal > 120 -> Plausibility.UNUSUALLY_HIGH
            else -> Plausibility.OK
        }
        FoodKind.FRUIT -> if (per100.fat > 1.0) Plausibility.UNUSUALLY_HIGH else Plausibility.OK
        FoodKind.OTHER -> Plausibility.OK
    }
}

enum class FoodKind { DAIRY_DRINK, FRUIT, OTHER }

fun FoodProfile.macrosForGrams(grams: Double): Macros = per100 * (grams / 100.0)

/** Valores por unidad cuando el producto solo se conoce así; si no, peso unitario × densidad. */
fun FoodProfile.macrosForUnits(units: Double): Macros? = when {
    perUnit != null -> perUnit * units
    unitWeightG != null -> macrosForGrams(unitWeightG * units)
    else -> null
}

/** Para cálculos a partir de una entrada ya registrada (correcciones de cantidad). */
fun LogEntry.rescaledTo(newGrams: Double): LogEntry {
    val factor = if (grams == 0.0) 0.0 else newGrams / grams
    return copy(grams = newGrams, macros = macros * factor)
}
