import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importar } from './importar.mjs'

// Red falsa: Mercadona (2 categorías, 3 productos, uno sin EAN), Open Food Facts y Supabase.
function redFalsa() {
  const escrito = []
  const respuestas = {
    '/api/categories/?': { results: [{ id: 1, categories: [{ id: 11 }, { id: 12 }] }] },
    '/api/categories/11/': { categories: [{ products: [{ id: 'a' }, { id: 'b' }] }] },
    '/api/categories/12/': { categories: [{ products: [{ id: 'b' }, { id: 'c' }] }] },
    '/api/products/a/': { id: 'a', ean: '8480000000011', display_name: 'Leche desnatada Hacendado', brand: 'Hacendado', price_instructions: { unit_size: 1, size_format: 'L', unit_price: '0.89' } },
    '/api/products/b/': { id: 'b', ean: '8480000000028', display_name: 'Pavo finas lonchas', brand: 'Hacendado', price_instructions: { unit_size: 0.25, size_format: 'kg' } },
    '/api/products/c/': { id: 'c', ean: null, display_name: 'Pan a granel' },
  }
  const fetch = async (url, opciones = {}) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
    if (url.includes('openfoodfacts.org')) {
      return ok({ products: [{ code: '8480000000011', nutriments: { 'energy-kcal_100g': 35, proteins_100g: 3.4, carbohydrates_100g: 5, fat_100g: 0.1 } }] })
    }
    if (url.includes('/rest/v1/alimentos_global')) {
      if (opciones.method === 'POST') escrito.push(...JSON.parse(opciones.body))
      return ok([])
    }
    const clave = Object.keys(respuestas).find((k) => url.includes(k))
    return clave ? ok(respuestas[clave]) : { ok: false, status: 404, text: async () => '' }
  }
  return { fetch, escrito }
}

test('importa Mercadona con EAN, cruza Open Food Facts y deja el resto pendiente', async () => {
  const { fetch, escrito } = redFalsa()
  const r = await importar({ fetch, url: 'https://x.supabase.co', clave: 'k', pausas: { mercadona: 0, off: 0 }, log: () => {} })
  assert.deepEqual(r, { productos: 2, conNutricion: 1 })
  const leche = escrito.find((f) => f.codigo_barras === '8480000000011')
  assert.equal(leche.kcal_100g, 35)
  assert.equal(leche.base, '100ml')
  assert.equal(leche.con_nutricion, true)
  const pavo = escrito.find((f) => f.codigo_barras === '8480000000028')
  assert.equal(pavo.con_nutricion, false)
})

test('en modo prueba no escribe', async () => {
  const { fetch, escrito } = redFalsa()
  await importar({ fetch, prueba: true, pausas: { mercadona: 0, off: 0 }, log: () => {} })
  assert.equal(escrito.length, 0)
})
