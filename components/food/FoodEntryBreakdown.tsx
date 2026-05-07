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
    <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
      <p className="text-sm font-semibold">
        {t('breakdown')}: <span className="font-normal text-muted-foreground">{foodName} ({quantityLabel})</span>
      </p>
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <Flame className="h-4 w-4 mx-auto mb-1 text-orange-500" />
          <p className="text-lg font-bold">{macros.kcal}</p>
          <p className="text-[10px] text-muted-foreground">{tc('kcal')}</p>
        </div>
        <div className="text-center">
          <Beef className="h-4 w-4 mx-auto mb-1 text-blue-500" />
          <p className="text-lg font-bold">{macros.proteinas}</p>
          <p className="text-[10px] text-muted-foreground">Prot</p>
        </div>
        <div className="text-center">
          <Wheat className="h-4 w-4 mx-auto mb-1 text-amber-500" />
          <p className="text-lg font-bold">{macros.carbohidratos}</p>
          <p className="text-[10px] text-muted-foreground">Carbs</p>
        </div>
        <div className="text-center">
          <Droplets className="h-4 w-4 mx-auto mb-1 text-red-500" />
          <p className="text-lg font-bold">{macros.grasas}</p>
          <p className="text-[10px] text-muted-foreground">Grasas</p>
        </div>
      </div>
    </div>
  )
}
