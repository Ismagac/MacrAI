// Clientes de red del importador. Se les pasa `fetch` para poder probarlos sin red.

const USER_AGENT = 'MacrAI-catalogo/0.1 (https://github.com/Ismagac/MacrAI)'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(fetch, url, intentos = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (res.ok) return res.json()
    // 429 o 5xx: se espera y se reintenta; lo demás (404) no tiene arreglo.
    if (i >= intentos || !(res.status === 429 || res.status >= 500)) throw new Error(`${res.status} en ${url}`)
    await esperar(2000 * i)
  }
}

/**
 * Mercadona: la API interna de tienda.mercadona.es (no oficial, sin documentación). No hay
 * listado completo: se recorren las subcategorías y después la ficha de cada producto, que es
 * la que trae el EAN. `almacen` decide el surtido (mad1, bcn1, vlc1, alc1…).
 */
export function mercadona({ fetch, almacen = 'mad1', pausaMs = 250, log = () => {} }) {
  const base = 'https://tienda.mercadona.es/api'
  const q = `lang=es&wh=${almacen}`
  return {
    async idsDeProductos(limite = Infinity) {
      const raiz = await json(fetch, `${base}/categories/?${q}`)
      const subcategorias = (raiz.results ?? []).flatMap((c) => c.categories ?? []).map((c) => c.id)
      const ids = new Set()
      for (const id of subcategorias) {
        if (ids.size >= limite) break
        await esperar(pausaMs)
        const categoria = await json(fetch, `${base}/categories/${id}/?${q}`).catch((e) => (log(`  categoría ${id}: ${e.message}`), null))
        for (const seccion of categoria?.categories ?? []) for (const p of seccion.products ?? []) ids.add(String(p.id))
      }
      return [...ids].slice(0, limite)
    },
    async ficha(id) {
      await esperar(pausaMs)
      return json(fetch, `${base}/products/${id}/?${q}`)
    },
  }
}

/** Open Food Facts: nutrición por lotes de EAN (búsqueda v2 con varios códigos a la vez). */
export function openFoodFacts({ fetch, pausaMs = 6500 }) {
  return {
    async porEans(eans) {
      const resultado = new Map()
      for (let i = 0; i < eans.length; i += 100) {
        const lote = eans.slice(i, i + 100)
        if (i > 0) await esperar(pausaMs) // ~10 búsquedas por minuto
        const url =
          'https://world.openfoodfacts.org/api/v2/search?fields=code,nutriments&page_size=100&code=' + lote.join(',')
        const data = await json(fetch, url)
        for (const p of data.products ?? []) resultado.set(String(p.code), p)
      }
      return resultado
    },
  }
}

/** Escritura en alimentos_global con la service role (salta RLS). */
export function supabase({ fetch, url, clave }) {
  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' }
  const rest = `${url.replace(/\/$/, '')}/rest/v1/alimentos_global`
  return {
    /** EAN de la lista que ya tienen nutrición en el catálogo (p. ej. aportada por usuarios). */
    async conNutricion(eans) {
      const con = new Set()
      for (let i = 0; i < eans.length; i += 100) {
        const lote = eans.slice(i, i + 100)
        const res = await fetch(`${rest}?select=codigo_barras&con_nutricion=eq.true&codigo_barras=in.(${lote.join(',')})`, { headers: cabeceras })
        if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
        for (const fila of await res.json()) con.add(fila.codigo_barras)
      }
      return con
    },
    async upsert(filas) {
      for (let i = 0; i < filas.length; i += 500) {
        const res = await fetch(`${rest}?on_conflict=codigo_barras`, {
          method: 'POST',
          headers: { ...cabeceras, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(filas.slice(i, i + 500)),
        })
        if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
      }
    },
  }
}
