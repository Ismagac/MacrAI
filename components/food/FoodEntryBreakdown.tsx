import { useTranslations } from 'next-intl'
import type { MacrosSummary } from '@/types'
import { Flame, Beef, Wheat, Droplets } from 'lucide-react'

interface Props {
  macros: MacrosSummary
  foodName: string
  quantityGr: number
  quantityLabel?: string
}

export function FoodEntryBreakdown({ macros, foodName, quantityGr, quantityLabel = `${quantityGr}g` }: Props) {
  const t = useTranslations('log')
  const tc = useTranslations('common')

  return (
    <div className="surface-card p-3 space-y-2.5">
      <p className="text-sm font-semibold">
        {t('breakdown')}: <span className="font-normal text-muted-foreground">{foodName} ({quantityLabel})</span>
      </p>
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <Flame className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
          <p className="metric text-lg">{macros.kcal}</p>
          <p className="label-caps">{tc('kcal')}</p>
        </div>
        <div className="text-center">
          <Beef className="h-4 w-4 mx-auto mb-1 macro-protein" />
          <p className="metric text-lg">{macros.proteinas}</p>
          <p className="label-caps">Prot</p>
        </div>
        <div className="text-center">
          <Wheat className="h-4 w-4 mx-auto mb-1 macro-carbs" />
          <p className="metric text-lg">{macros.carbohidratos}</p>
          <p className="label-caps">Carbs</p>
        </div>
        <div className="text-center">
          <Droplets className="h-4 w-4 mx-auto mb-1 macro-fat" />
          <p className="metric text-lg">{macros.grasas}</p>
          <p className="label-caps">Grasas</p>
        </div>
      </div>
    </div>
  )
}
