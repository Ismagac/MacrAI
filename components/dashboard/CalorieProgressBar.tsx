import { useTranslations } from 'next-intl'
import type { MacrosSummary, Objetivo } from '@/types'
import { cn } from '@/lib/utils/cn'

interface Props {
  macros: MacrosSummary
  objetivo: Objetivo | null
}

export function CalorieProgressBar({ macros, objetivo }: Props) {
  const t = useTranslations('dashboard')
  const goal = objetivo?.kcal_objetivo ?? 2000
  const pct = Math.min(Math.round((macros.kcal / goal) * 100), 100)
  const exceeded = macros.kcal > goal
  const diff = Math.abs(Math.round(goal - macros.kcal))

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-caps">{t('calories')}</p>
          <p className="metric mt-0.5 text-3xl">
            <span className={cn(exceeded && 'text-destructive')}>{Math.round(macros.kcal)}</span>
            <span className="ml-1 text-base font-normal text-muted-foreground">/ {Math.round(goal)}</span>
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold',
            exceeded ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-foreground'
          )}
        >
          {exceeded ? `+${diff} ${t('exceeded')}` : `${diff} ${t('remaining')}`}
        </span>
      </div>
      <div className="macro-track h-1.5 w-full rounded-full">
        <div
          className={cn('h-1.5 rounded-full', exceeded ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
