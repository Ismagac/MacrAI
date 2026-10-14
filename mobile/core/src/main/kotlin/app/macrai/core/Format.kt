package app.macrai.core

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong

// Números en formato español: coma decimal y punto de miles (1.963,5). Sin ",0" de relleno.

fun formatNumber(value: Double, decimals: Int = 1): String {
    val rounded = roundTo(value, decimals)
    val negative = rounded < 0
    val absolute = abs(rounded)
    val integerPart = absolute.toLong()
    val fraction = roundTo(absolute - integerPart, decimals)

    val grouped = integerPart.toString().reversed().chunked(3).joinToString(".").reversed()
    val fractionDigits = if (decimals == 0 || fraction == 0.0) {
        ""
    } else {
        val digits = (fraction * 10.0.pow(decimals)).roundToLong().toString().padStart(decimals, '0').trimEnd('0')
        if (digits.isEmpty()) "" else ",$digits"
    }
    return (if (negative) "-" else "") + grouped + fractionDigits
}

fun formatKcal(value: Double): String = formatNumber(value, 1)

fun formatGrams(value: Double): String = "${formatNumber(value, 1)} g"

/** Prefijo "~" cuando el total incluye alguna estimación (§11.2). */
fun approx(text: String, estimated: Boolean): String = if (estimated) "~$text" else text

fun formatSigned(value: Double, decimals: Int = 0): String =
    (if (value > 0) "+" else "") + formatNumber(value, decimals)
