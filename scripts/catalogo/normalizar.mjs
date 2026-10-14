// Conversión de productos de supermercado y de Open Food Facts a filas de alimentos_global.
// Funciones puras: se prueban sin red (normalizar.test.mjs).

const KJ_POR_KCAL = 4.184

const numero = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const redondear = (n, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d)

/** EAN-8, UPC-A, EAN-13 o GTIN-14; cualquier otra cosa no sirve para cruzar. */
export const eanValido = (ean) => typeof ean === 'string' && /^[0-9]{8,14}$/.test(ean)

/**
 * Ficha de producto de la API de la tienda de Mercadona (/api/products/{id}/) → fila base,
 * sin nutrición: Mercadona no la da como datos.
 */
export function filaMercadona(p) {
  if (!p || !eanValido(p.ean)) return null
  const precio = p.price_instructions ?? {}
  const tamano = numero(precio.unit_size)
  const unidad = (precio.size_format ?? '').toLowerCase()
  const formato = [p.packaging, tamano && unidad ? `${tamano} ${unidad}` : null].filter(Boolean).join(' · ') || null
  const foto = (p.photos ?? []).find((f) => f.perspective === 2)?.regular ?? p.photos?.[0]?.regular ?? p.thumbnail ?? null
  return {
    nombre: (p.display_name ?? '').trim(),
    marca: (p.brand ?? p.details?.brand ?? '').trim() || null,
    codigo_barras: p.ean,
    supermercado: 'Mercadona',
    id_externo: String(p.id),
    formato,
    foto_url: foto,
    precio: numero(precio.unit_price),
    base: ['l', 'ml', 'cl'].includes(unidad) ? '100ml' : '100g',
  }
}

/** Nutriments de Open Food Facts → macros por 100 g/ml, o null si falta alguno. */
export function nutricionOff(producto) {
  const n = producto?.nutriments
  if (!n) return null
  const proteinas = numero(n.proteins_100g)
  const carbohidratos = numero(n.carbohydrates_100g)
  const grasas = numero(n.fat_100g)
  if (proteinas === null || carbohidratos === null || grasas === null) return null
  const kcal =
    numero(n['energy-kcal_100g']) ??
    (numero(n.energy_100g) !== null ? numero(n.energy_100g) / KJ_POR_KCAL : 4 * proteinas + 4 * carbohidratos + 9 * grasas)
  if (kcal < 0 || kcal > 900 || proteinas + carbohidratos + grasas > 100) return null
  return {
    kcal_100g: redondear(kcal, 1),
    proteinas_100g: redondear(proteinas),
    carbohidratos_100g: redondear(carbohidratos),
    grasas_100g: redondear(grasas),
    fibra_100g: redondear(numero(n.fiber_100g) ?? 0),
  }
}

/**
 * Reparte las filas en tres grupos para el upsert (PostgREST exige las mismas columnas en
 * cada lote) sin pisar nunca la nutrición que ya aportaron los usuarios:
 *  - conNutricion: Open Food Facts tiene los macros → se guardan.
 *  - soloDatos: sin macros nuevos pero la fila ya tiene nutrición → solo nombre, precio, foto…
 *  - sinNutricion: producto nuevo sin macros → se guarda marcado con_nutricion = false.
 */
export function agrupar(filas, nutricionPorEan, existentesConNutricion) {
  const conNutricion = []
  const soloDatos = []
  const sinNutricion = []
  for (const fila of filas) {
    const nutricion = nutricionPorEan.get(fila.codigo_barras)
    if (nutricion) {
      conNutricion.push({ ...fila, ...nutricion, con_nutricion: true, fuente_nutricion: 'off', source: 'supermercado' })
    } else if (existentesConNutricion.has(fila.codigo_barras)) {
      soloDatos.push({ ...fila, source: 'supermercado' })
    } else {
      sinNutricion.push({ ...fila, con_nutricion: false, source: 'supermercado' })
    }
  }
  return { conNutricion, soloDatos, sinNutricion }
}
