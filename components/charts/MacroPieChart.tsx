'use client'

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import type { MacrosSummary } from '@/types'
import { useTranslations } from 'next-intl'

interface Props {
  macros: MacrosSummary
}

const COLORS = {
  Proteínas: '#3b82f6',
  Carbohidratos: '#f59e0b',
  Grasas: '#ef4444',
}

export function MacroPieChart({ macros }: Props) {
  const t = useTranslations('dashboard')

  const data = [
    { name: t('protein'), value: Math.round(macros.proteinas * 4), grams: macros.proteinas, color: '#3b82f6' },
    { name: t('carbs'), value: Math.round(macros.carbohidratos * 4), grams: macros.carbohidratos, color: '#f59e0b' },
    { name: t('fat'), value: Math.round(macros.grasas * 9), grams: macros.grasas, color: '#ef4444' },
  ].filter((d) => d.value > 0)

  const total = data.reduce((s, d) => s + d.value, 0)

  if (total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        {t('noData')}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} strokeWidth={0} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string, props: any) =>
            [`${props?.payload?.grams ?? 0}g (${Math.round((value / total) * 100)}%)`, name]
          }
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--popover))',
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Legend
          formatter={(value) => (
            <span className="text-xs text-foreground">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
