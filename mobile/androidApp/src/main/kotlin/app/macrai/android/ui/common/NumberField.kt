package app.macrai.android.ui.common

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import app.macrai.core.formatNumber

/** Campo numérico en formato español: acepta "92,6" y "92.6". */
@Composable
fun NumberField(label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, suffix: String? = null) {
    OutlinedTextField(
        value = value,
        onValueChange = { text -> onValueChange(text.filter { it.isDigit() || it == ',' || it == '.' }) },
        modifier = modifier,
        label = { Text(label) },
        suffix = suffix?.let { { Text(it) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    )
}

fun String.toNumberOrNull(): Double? = replace(',', '.').toDoubleOrNull()

/** Valor inicial de un campo: sin decimales de relleno ni punto de miles. */
fun Double?.asField(): String = this?.let { formatNumber(it, 1).replace(".", "") } ?: ""
