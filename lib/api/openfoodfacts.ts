import type { FoodItem, OFFSearchResponse } from '@/types'

const OFF_BASE = 'https://world.openfoodfacts.org/cgi/search.pl'

export async function searchOpenFoodFacts(
  query: string,
  pageSize = 6
): Promise<FoodItem[]> {
  const params = new URLSearchParams({
    action: 'process',
    search_terms: query,
    json: '1',
    page_size: String(pageSize),
    fields: 'id,product_name,nutriments,categories_tags',
    sort_by: 'unique_scans_n',
  })

  const url = `${OFF_BASE}?${params.toString()}`
  const headers = { 'User-Agent': 'MacrAI/1.0 (https://github.com/macrai)' }

  // Try up to 3 times with increasing delay on 503
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 600))
      }

      const res = await fetch(url, {
        headers,
        next: { revalidate: 3600 },
      })

      if (res.status === 503) {
        console.warn(`[OFF] 503 on attempt ${attempt + 1} for "${query}"`)
        continue
      }

      if (!res.ok) return []

      const data: OFFSearchResponse = await res.json()

      return data.products
        .filter(
          (p) =>
            p.product_name &&
            p.nutriments?.['energy-kcal_100g'] !== undefined
        )
        .map((p): FoodItem => ({
          id: `off_${p.id}`,
          nombre: p.product_name,
          kcal_100g: p.nutriments['energy-kcal_100g'] ?? 0,
          proteinas_100g: p.nutriments.proteins_100g ?? 0,
          grasas_100g: p.nutriments.fat_100g ?? 0,
          carbohidratos_100g: p.nutriments.carbohydrates_100g ?? 0,
          fibra_100g: p.nutriments.fiber_100g,
          source: 'openfoodfacts',
        }))
        .slice(0, pageSize)
    } catch (e) {
      console.error('[OFF] exception on attempt', attempt + 1, e)
    }
  }

  return []
}
