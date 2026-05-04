import type { Consumo, GroupingMode, MealType } from '@/types'
import { format } from 'date-fns'

export interface ConsumoGroup {
  key: string
  label: string
  items: Consumo[]
  totalKcal: number
  totalProteinas: number
  totalGrasas: number
  totalCarbohidratos: number
}

const MEAL_LABELS: Record<MealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  comida: 'Comida',
  merienda: 'Merienda',
  cena: 'Cena',
  snack: 'Snack',
  otro: 'Otro',
}

const MEAL_ORDER: MealType[] = [
  'desayuno',
  'almuerzo',
  'comida',
  'merienda',
  'cena',
  'snack',
  'otro',
]

function getHourBlock(isoTimestamp: string): { key: string; label: string } {
  const date = new Date(isoTimestamp)
  const hour = date.getHours()
  if (hour >= 6 && hour < 12) return { key: 'manana', label: 'Mañana (6h-12h)' }
  if (hour >= 12 && hour < 16) return { key: 'mediodia', label: 'Mediodía (12h-16h)' }
  if (hour >= 16 && hour < 21) return { key: 'tarde', label: 'Tarde (16h-21h)' }
  return { key: 'noche', label: 'Noche (21h-6h)' }
}

function buildGroups(
  map: Map<string, { label: string; items: Consumo[] }>
): ConsumoGroup[] {
  return Array.from(map.entries()).map(([key, { label, items }]) => ({
    key,
    label,
    items,
    totalKcal: items.reduce((s, i) => s + i.kcal, 0),
    totalProteinas: items.reduce((s, i) => s + i.proteinas, 0),
    totalGrasas: items.reduce((s, i) => s + i.grasas, 0),
    totalCarbohidratos: items.reduce((s, i) => s + i.carbohidratos, 0),
  }))
}

export function groupConsumos(
  consumos: Consumo[],
  mode: GroupingMode
): ConsumoGroup[] {
  if (mode === 'tipo_comida') {
    const map = new Map<string, { label: string; items: Consumo[] }>()
    for (const meal of MEAL_ORDER) {
      map.set(meal, { label: MEAL_LABELS[meal], items: [] })
    }
    for (const c of consumos) {
      const group = map.get(c.tipo_comida)
      if (group) group.items.push(c)
      else map.get('otro')!.items.push(c)
    }
    // Remove empty groups
    Array.from(map.entries()).forEach(([key, g]) => {
      if (g.items.length === 0) map.delete(key)
    })
    return buildGroups(map)
  }

  if (mode === 'numero_comida') {
    const map = new Map<string, { label: string; items: Consumo[] }>()
    const sorted = [...consumos].sort((a, b) => a.numero_comida - b.numero_comida)
    for (const c of sorted) {
      const key = `comida_${c.numero_comida}`
      if (!map.has(key)) {
        map.set(key, { label: `Comida ${c.numero_comida}`, items: [] })
      }
      map.get(key)!.items.push(c)
    }
    return buildGroups(map)
  }

  // hora
  const map = new Map<string, { label: string; items: Consumo[] }>()
  const sorted = [...consumos].sort(
    (a, b) =>
      new Date(a.hora_insercion).getTime() - new Date(b.hora_insercion).getTime()
  )
  for (const c of sorted) {
    const block = getHourBlock(c.hora_insercion)
    if (!map.has(block.key)) {
      map.set(block.key, { label: block.label, items: [] })
    }
    map.get(block.key)!.items.push(c)
  }
  return buildGroups(map)
}
