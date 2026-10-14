import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agrupar, eanValido, filaMercadona, nutricionOff } from './normalizar.mjs'

const fichaMercadona = {
  id: '20221',
  ean: '8480000202215',
  display_name: 'Yogur natural edulcorado Hacendado 0% MG',
  packaging: 'Pack-6',
  brand: 'Hacendado',
  photos: [
    { regular: 'https://img/thumb-1.jpg', perspective: 1 },
    { regular: 'https://img/frontal.jpg', perspective: 2 },
  ],
  price_instructions: { unit_size: 0.75, size_format: 'kg', unit_price: '1.05' },
}

test('ficha de Mercadona a fila del catálogo', () => {
  assert.deepEqual(filaMercadona(fichaMercadona), {
    nombre: 'Yogur natural edulcorado Hacendado 0% MG',
    marca: 'Hacendado',
    codigo_barras: '8480000202215',
    supermercado: 'Mercadona',
    id_externo: '20221',
    formato: 'Pack-6 · 0.75 kg',
    foto_url: 'https://img/frontal.jpg',
    precio: 1.05,
    base: '100g',
  })
})

test('líquidos van por 100 ml y sin EAN no se importa', () => {
  assert.equal(filaMercadona({ ...fichaMercadona, price_instructions: { unit_size: 1, size_format: 'L' } }).base, '100ml')
  assert.equal(filaMercadona({ ...fichaMercadona, ean: null }), null)
  assert.equal(eanValido('84800002'), true)
  assert.equal(eanValido('ABC'), false)
})

test('nutrición de Open Food Facts con kJ y textos', () => {
  assert.deepEqual(nutricionOff({ nutriments: { energy_100g: 163, proteins_100g: '4.8', carbohydrates_100g: 4.9, fat_100g: 0 } }), {
    kcal_100g: 39,
    proteinas_100g: 4.8,
    carbohidratos_100g: 4.9,
    grasas_100g: 0,
    fibra_100g: 0,
  })
  assert.equal(nutricionOff({ nutriments: { proteins_100g: 3 } }), null)
  assert.equal(nutricionOff({ nutriments: { 'energy-kcal_100g': 2000, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } }), null)
})

test('no se pisa la nutrición aportada por usuarios', () => {
  const filas = ['1111111111111', '2222222222222', '3333333333333'].map((ean) => ({ ...filaMercadona(fichaMercadona), codigo_barras: ean }))
  const nutricion = new Map([['1111111111111', { kcal_100g: 39, proteinas_100g: 4.8, carbohidratos_100g: 4.9, grasas_100g: 0, fibra_100g: 0 }]])
  const { conNutricion, soloDatos, sinNutricion } = agrupar(filas, nutricion, new Set(['2222222222222']))
  assert.equal(conNutricion[0].fuente_nutricion, 'off')
  assert.equal(soloDatos[0].codigo_barras, '2222222222222')
  assert.equal('con_nutricion' in soloDatos[0], false)
  assert.equal(sinNutricion[0].con_nutricion, false)
})
