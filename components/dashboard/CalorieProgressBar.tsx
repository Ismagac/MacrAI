import { useTranslations } from 'next-intl'
import { Progress } from '@/components/ui/progress'
import { Flame } from 'lucide-react'
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
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 font-medium">
          <Flame className="h-4 w-4 text-orange-500" />
          {t('calories')}
        </div>
        <span className="text-muted-foreground">
          <span className={cn('font-semibold', exceeded && 'text-destructive')}>
            {Math.round(macros.kcal)}
          </span>{' '}
          / {Math.round(goal)} kcal
        </span>
      </div>
      <Progress
        value={pct}
        className={cn('h-3', exceeded && '[&>div]:bg-destructive')}
      />
      <p className="text-xs text-muted-foreground text-right">
        {exceeded
          ? `+${diff} kcal ${t('exceeded')}`
          : `${diff} kcal ${t('remaining')}`}
      </p>
    </div>
  )
}
