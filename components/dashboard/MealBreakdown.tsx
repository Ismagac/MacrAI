import type { Consumo, MealType } from '@/types'
import { cn } from '@/lib/utils/cn'

// Reparto de calorías por comida. Las comidas sin registrar se muestran igualmente
// en gris: ver el hueco es lo que empuja a rellenarlo.

const MEALS: Array<{ key: MealType; label: string }> = [
  { key: 'desayuno', label: 'Desayuno' },
  { key: 'comida', label: 'Comida' },
  { key: 'cena', label: 'Cena' },
  { key: 'snack', label: 'Snacks' },
]

export function MealBreakdown({ consumos }: { consumos: Consumo[] }) {
  const totals = MEALS.map((meal) => {
    const kcal = consumos
      .filter((c) =>
        meal.key === 'snack'
          ? c.tipo_comida === 'snack' || c.tipo_comida === 'merienda' || c.tipo_comida === 'otro'
          : c.tipo_comida === meal.key
      )
      .reduce((sum, c) => sum + (c.kcal ?? 0), 0)
    return { ...meal, kcal: Math.round(kcal) }
  })

  const max = Math.max(...totals.map((m) => m.kcal), 1)

  return (
    <div className="space-y-2.5">
      {totals.map((meal) => (
        <div key={meal.key} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{meal.label}</span>
          <div className="macro-track h-1.5 flex-1 rounded-full">
            <div
              className={cn('h-1.5 rounded-full', meal.kcal > 0 ? 'bg-primary' : 'bg-transparent')}
              style={{ width: `${(meal.kcal / max) * 100}%` }}
            />
          </div>
          <span
            className={cn(
              'metric w-16 shrink-0 text-right text-sm',
              meal.kcal === 0 && 'font-normal text-muted-foreground'
            )}
          >
            {meal.kcal} <span className="text-[11px] font-normal text-muted-foreground">kcal</span>
          </span>
        </div>
      ))}
    </div>
  )
}
