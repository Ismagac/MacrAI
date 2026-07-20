import { cn } from '@/lib/utils/cn'

// Anillo de calorías: el dato principal del día. Trazo grueso sobre pista neutra,
// relleno en lima salvo que se pase del objetivo.

export function CalorieRing({
  value,
  goal,
  size = 176,
  stroke = 14,
}: {
  value: number
  goal: number
  size?: number
  stroke?: number
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0
  const over = goal > 0 && value > goal
  const remaining = Math.abs(Math.round(goal - value))

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[color:var(--track-empty)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn('transition-[stroke-dashoffset] duration-500', over ? 'stroke-destructive' : 'stroke-primary')}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('metric text-3xl leading-none', over && 'text-destructive')}>
          {Math.round(value)}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">de {Math.round(goal)} kcal</span>
        <span
          className={cn(
            'mt-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            over ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-brand'
          )}
        >
          {over ? `+${remaining} kcal` : `Quedan ${remaining}`}
        </span>
      </div>
    </div>
  )
}
