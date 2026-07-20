// Emparejado de nombres de alimentos entre lo que dice el usuario y lo que hay
// en su catálogo.
//
// El usuario habla: escribe "un mochi de tarta de la abula" para "Mochi tarta de
// la abuela hacendado". Comparar por substring falla ante erratas, palabras de
// más y marcas ausentes, así que se compara palabra a palabra tolerando errores.

const STOPWORDS = new Set([
  'de','del','la','el','los','las','un','una','unos','unas','y','o','con','sin','al','a',
  'para','por','en','mi','mis','me','he','ha','comido','tomado','anade','añade','pon',
  'ponme','agrega','registra','quiero','gramos','gramo','unidad','unidades','kcal',
])

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fuera acentos: "abuela" y "abuéla" son lo mismo
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

// Distancia de edición acotada: sólo interesa saber si dos palabras están a uno
// o dos errores de distancia, no la distancia exacta.
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  if (a === b) return true

  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      rowMin = Math.min(rowMin, curr[j])
    }
    if (rowMin > max) return false
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }

  return prev[b.length] <= max
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  // Plurales y derivados: "galleta" contra "galletas"
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  // Erratas: una edición en palabras cortas, dos en las largas
  const tolerance = Math.max(a.length, b.length) >= 7 ? 2 : 1
  return withinEditDistance(a, b, tolerance)
}

/**
 * Puntúa de 0 a 1 cuánto encaja la frase del usuario con el nombre de un alimento.
 * Se mide sobre los términos del catálogo que aparecen en la frase, de modo que
 * palabras sueltas del usuario ("comido", "hoy") no penalicen.
 */
export function matchScore(userText: string, foodName: string): number {
  const queryTokens = tokenize(userText)
  const nameTokens = tokenize(foodName)
  if (queryTokens.length === 0 || nameTokens.length === 0) return 0

  const nameHits = nameTokens.filter((n) => queryTokens.some((q) => tokensMatch(n, q))).length
  if (nameHits === 0) return 0

  // Hace falta al menos un término con entidad propia: evita que palabras
  // sueltas y genéricas arrastren cualquier alimento.
  const hasDistinctiveHit = nameTokens.some(
    (n) => n.length >= 4 && queryTokens.some((q) => tokensMatch(n, q))
  )
  if (!hasDistinctiveHit) return 0

  const queryHits = queryTokens.filter((q) => nameTokens.some((n) => tokensMatch(n, q))).length

  // Se puntúa por los dos lados y gana el mejor: "un mochi" cubre poco del
  // nombre largo pero cubre todo lo que el usuario dijo, y debe valer.
  return Math.max(nameHits / nameTokens.length, queryHits / queryTokens.length)
}

/**
 * Ordena los alimentos por parecido con lo que dijo el usuario y descarta los
 * que no llegan al mínimo.
 */
export function rankByMatch<T extends { nombre: string }>(
  items: T[],
  userText: string,
  minScore = 0.4
): T[] {
  return items
    .map((item) => ({ item, score: matchScore(userText, item.nombre) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

export function bestMatch<T extends { nombre: string }>(
  items: T[],
  userText: string,
  minScore = 0.4
): T | undefined {
  return rankByMatch(items, userText, minScore)[0]
}
