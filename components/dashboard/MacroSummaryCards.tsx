import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import type { MacrosSummary, Objetivo } from '@/types'
import { cn } from '@/lib/utils/cn'
import { Beef, Wheat, Droplets, Leaf } from 'lucide-react'

interface Props {
  macros: MacrosSummary
  objetivo: Objetivo | null
}

function MacroCard({
  label,
  value,
  goal,
  color,
  icon,
  unit = 'g',
}: {
  label: string
  value: number
  goal?: number
  color: string
  icon: React.ReactNode
  unit?: string
}) {
  const pct = goal ? Math.min(Math.round((value / goal) * 100), 100) : null
  return (
    <Card className="relative overflow-hidden border-primary/10">
      <div className={cn('absolute inset-x-0 top-0 h-1', color)} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
            {icon}
          </span>
        </div>
        <p className="text-2xl font-extrabold mt-2">
          {Math.round(value * 10) / 10}
          <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>
        </p>
        {goal && (
          <p className="text-xs text-muted-foreground mt-1 font-medium">
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
        color="macro-bg-protein"
        icon={<Beef className="h-4 w-4" />}
      />
      <MacroCard
        label={t('carbs')}
        value={macros.carbohidratos}
        goal={objetivo?.carbohidratos_objetivo}
        color="macro-bg-carbs"
        icon={<Wheat className="h-4 w-4" />}
      />
      <MacroCard
        label={t('fat')}
        value={macros.grasas}
        goal={objetivo?.grasas_objetivo}
        color="macro-bg-fat"
        icon={<Droplets className="h-4 w-4" />}
      />
      <MacroCard
        label={t('fiber')}
        value={macros.fibra}
        color="macro-bg-fiber"
        icon={<Leaf className="h-4 w-4" />}
      />
    </div>
  )
}
