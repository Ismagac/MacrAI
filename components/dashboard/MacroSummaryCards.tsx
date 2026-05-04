import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import type { MacrosSummary, Objetivo } from '@/types'
import { cn } from '@/lib/utils/cn'

interface Props {
  macros: MacrosSummary
  objetivo: Objetivo | null
}

function MacroCard({
  label,
  value,
  goal,
  color,
  unit = 'g',
}: {
  label: string
  value: number
  goal?: number
  color: string
  unit?: string
}) {
  const pct = goal ? Math.min(Math.round((value / goal) * 100), 100) : null
  return (
    <Card className="relative overflow-hidden">
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', color)} />
      <CardContent className="p-4 pl-5">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold">
          {Math.round(value * 10) / 10}
          <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>
        </p>
        {goal && (
          <p className="text-xs text-muted-foreground mt-1">
            {pct}% {goal}{unit}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function MacroSummaryCards({ macros, objetivo }: Props) {
  const t = useTranslations('dashboard')
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MacroCard
        label={t('protein')}
        value={macros.proteinas}
        goal={objetivo?.proteinas_objetivo}
        color="bg-blue-500"
      />
      <MacroCard
        label={t('carbs')}
        value={macros.carbohidratos}
        goal={objetivo?.carbohidratos_objetivo}
        color="bg-amber-500"
      />
      <MacroCard
        label={t('fat')}
        value={macros.grasas}
        goal={objetivo?.grasas_objetivo}
        color="bg-red-500"
      />
      <MacroCard
        label={t('fiber')}
        value={macros.fibra}
        color="bg-emerald-500"
      />
    </div>
  )
}
