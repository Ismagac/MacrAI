#!/usr/bin/env node
// Importa el catálogo de Mercadona a alimentos_global y lo cruza con Open Food Facts por EAN.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/catalogo/importar.mjs
//   node scripts/catalogo/importar.mjs --prueba --limite 20      (sin escribir: solo cuenta)
//
// Aviso: la API de la tienda de Mercadona es interna, no tiene términos para terceros y su
// robots.txt pide no rastrear /api. Puede cambiar o cerrarse sin aviso. Se usa a ritmo
// pausado, desde un servidor y nunca desde los móviles de los usuarios.

import { pathToFileURL } from 'node:url'
import { agrupar, filaMercadona, nutricionOff } from './normalizar.mjs'
import { mercadona, openFoodFacts, supabase } from './fuentes.mjs'

export async function importar({ fetch = globalThis.fetch, url, clave, prueba = false, limite = Infinity, almacen, pausas = {}, log = console.log }) {
  const tienda = mercadona({ fetch, almacen, pausaMs: pausas.mercadona, log })
  const off = openFoodFacts({ fetch, pausaMs: pausas.off })

  log('Mercadona: recorriendo categorías…')
  const ids = await tienda.idsDeProductos(limite)
  log(`  ${ids.length} productos`)

  const filas = []
  for (const [i, id] of ids.entries()) {
    const ficha = await tienda.ficha(id).catch((e) => (log(`  producto ${id}: ${e.message}`), null))
    const fila = filaMercadona(ficha)
    if (fila) filas.push(fila)
    if ((i + 1) % 250 === 0) log(`  ${i + 1}/${ids.length} fichas`)
  }
  // Un mismo EAN puede salir en varias categorías.
  const unicas = [...new Map(filas.map((f) => [f.codigo_barras, f])).values()]
  log(`  ${unicas.length} con EAN`)

  log('Open Food Facts: nutrición por EAN…')
  const productos = await off.porEans(unicas.map((f) => f.codigo_barras))
  const nutricion = new Map()
  for (const [ean, p] of productos) {
    const n = nutricionOff(p)
    if (n) nutricion.set(ean, n)
  }
  log(`  ${nutricion.size} con macros completos (${Math.round((100 * nutricion.size) / Math.max(unicas.length, 1))} %)`)

  if (prueba) {
    log('Prueba: no se escribe nada.')
    return { productos: unicas.length, conNutricion: nutricion.size }
  }

  const db = supabase({ fetch, url, clave })
  const existentes = await db.conNutricion(unicas.map((f) => f.codigo_barras))
  const grupos = agrupar(unicas, nutricion, existentes)
  for (const grupo of Object.values(grupos)) await db.upsert(grupo)
  log(`Guardado: ${grupos.conNutricion.length} con nutrición, ${grupos.soloDatos.length} actualizados sin tocar su nutrición, ${grupos.sinNutricion.length} pendientes de etiqueta.`)
  return { productos: unicas.length, conNutricion: nutricion.size }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const valor = (nombre) => {
    const i = args.indexOf(nombre)
    return i >= 0 ? args[i + 1] : undefined
  }
  const prueba = args.includes('--prueba')
  const url = process.env.SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!prueba && (!url || !clave)) {
    console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o usa --prueba).')
    process.exit(1)
  }
  importar({ url, clave, prueba, limite: Number(valor('--limite') ?? Infinity), almacen: valor('--almacen') ?? 'mad1' })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
