import { useTranslations } from 'next-intl'
import type { MacrosSummary, Objetivo } from '@/types'
import { cn } from '@/lib/utils/cn'

interface Props {
  macros: MacrosSummary
  objetivo: Objetivo | null
}

function MacroTile({
  label,
  value,
  goal,
  barClass,
  textClass,
  unit = 'g',
}: {
  label: string
  value: number
  goal?: number
  barClass: string
  textClass: string
  unit?: string
}) {
  const pct = goal ? Math.min(Math.round((value / goal) * 100), 100) : null
  const over = goal ? value > goal : false

  return (
    <div className="surface-card p-3">
      <p className="label-caps">{label}</p>
      <p className="metric mt-1 text-2xl">
        <span className={textClass}>{Math.round(value * 10) / 10}</span>
        <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>
      </p>
      {goal ? (
        <>
          <div className="macro-track mt-2 h-1.5 w-full rounded-full">
            <div
              className={cn('h-1.5 rounded-full', over ? 'bg-destructive' : barClass)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {pct}% · {goal}
            {unit}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">—</p>
      )}
    </div>
  )
}

export function MacroSummaryCards({ macros, objetivo }: Props) {
  const t = useTranslations('dashboard')
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <MacroTile
        label={t('protein')}
        value={macros.proteinas}
        goal={objetivo?.proteinas_objetivo}
        barClass="macro-bg-protein"
        textClass="macro-protein"
      />
      <MacroTile
        label={t('carbs')}
        value={macros.carbohidratos}
        goal={objetivo?.carbohidratos_objetivo}
        barClass="macro-bg-carbs"
        textClass="macro-carbs"
      />
      <MacroTile
        label={t('fat')}
        value={macros.grasas}
        goal={objetivo?.grasas_objetivo}
        barClass="macro-bg-fat"
        textClass="macro-fat"
      />
      <MacroTile
        label={t('fiber')}
        value={macros.fibra}
        barClass="macro-bg-fiber"
        textClass="macro-fiber"
      />
    </div>
  )
}
