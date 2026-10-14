package app.macrai.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Con el catálogo real de las semanas de prueba (docs/datos/catalogo-inicial.md).

class CatalogImportTest {
    private val parsed = parseCatalogMarkdown(File("../../docs/datos/catalogo-inicial.md").readText())
    private fun food(name: String) = assertNotNull(parsed.foods.firstOrNull { it.name == name }, "falta $name")

    @Test fun readsEveryFoodOfTheDocument() {
        assertEquals(52, parsed.foods.size)
        val carne = food("Carne picada de ternera Mercadona")
        assertEquals(Macros(190.0, 18.0, 2.4, 12.0), carne.per100)
        assertEquals(ValueSource.LABEL, carne.source)
        assertTrue(!carne.macrosEstimated)
    }

    @Test fun understandsUnitsStatesAndBases() {
        val helado = food("Helado mango choco Mercadona")
        assertEquals(238.0, helado.perUnit?.kcal)
        assertNull(helado.unitWeightG)

        val zumo = food("Zumo mediterráneo Alipende fruta y leche")
        assertEquals(330.0, zumo.unitWeightG)
        assertEquals(46.0, zumo.perUnit?.kcal)
        assertEquals(13.9, roundTo(zumo.per100.kcal, 1))
        assertEquals(Basis.PER_100ML, zumo.basis)

        assertEquals(11.0, food("Saboyardo").unitWeightG)
        assertEquals(100.0, food("Mousse de proteínas chocolate Mercadona").unitWeightG)
        val atun = food("Atún claro al natural")
        assertEquals(56.0, atun.unitWeightG)
        assertEquals(LabelColumn.DRAINED, atun.column)

        val sopa = food("Sopa de cebolla Hacendado")
        assertEquals(Basis.PER_100ML, sopa.basis)
        assertEquals(LabelColumn.PREPARED, sopa.column)
        assertEquals("sobre 43 g = 1 l", sopa.packFormat)

        assertEquals(0.8, food("Jamón (Duriber)").per100.carbs)
        assertTrue(food("Queso crema San Millán 0 %").macrosEstimated)
        assertEquals("Pechuga de pavo (lonchas, otra marca)", food("Pechuga de pavo (lonchas, otra marca)").name)
        assertEquals("Ketchup normal Salseo del burger", food("Ketchup normal Salseo del burger").name)
    }

    @Test fun aliasesLandOnTheirFoods() {
        val state = StoreState().importCatalog(parsed).state
        fun aliasesOf(name: String) = state.catalog.first { it.name == name }.aliases
        assertTrue("la de Mercadona" in aliasesOf("Carne picada de ternera Mercadona"))
        assertTrue("el batido" in aliasesOf("Queso fresco batido 0 %"))
        assertTrue("jam" in aliasesOf("Jamón (Duriber)"))
        assertEquals("Carne picada de ternera Mercadona", findInCatalog("la de Mercadona", state.catalog, emptyList())?.name)
    }

    @Test fun importingTwiceDoesNotDuplicateOrOverwrite() {
        val first = StoreState().importCatalog(parsed)
        val edited = first.state.upsertFood(first.state.catalog.first { it.name == "Pan" }.let { it.copy(per100 = it.per100.copy(kcal = 250.0)) })
        val second = edited.importCatalog(parseCatalogMarkdown(File("../../docs/datos/catalogo-inicial.md").readText()))
        assertEquals(0, second.added)
        assertEquals(52, second.state.catalog.size)
        assertEquals(250.0, second.state.catalog.first { it.name == "Pan" }.per100.kcal)
    }
}
