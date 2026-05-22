'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { DayStats } from '@/types'
import { useTranslations } from 'next-intl'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useLocale } from 'next-intl'

interface Props {
  stats: DayStats[]
}

export function WeeklyMacroChart({ stats }: Props) {
  const t = useTranslations('dashboard')
  const locale = useLocale()

  const data = stats.map((s) => ({
    fecha: format(parseISO(s.fecha), 'EEE dd', {
      locale: locale === 'es' ? es : undefined,
    }),
    [t('protein')]: Math.round(s.proteinas),
    [t('carbs')]: Math.round(s.carbohidratos),
    [t('fat')]: Math.round(s.grasas),
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.7)" />
        <XAxis
          dataKey="fecha"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="g" />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--popover))',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(v: number) => [`${v}g`]}
        />
        <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
        <Bar dataKey={t('protein')} stackId="a" fill="var(--macro-protein)" radius={[0, 0, 0, 0]} />
        <Bar dataKey={t('carbs')} stackId="a" fill="var(--macro-carbs)" />
        <Bar dataKey={t('fat')} stackId="a" fill="var(--macro-fat)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
