'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { AppLayout } from '@/components/layout/AppLayout'
import { useHistorial } from '@/hooks/useHistorial'
import { WeeklyMacroChart } from '@/components/charts/WeeklyMacroChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import type { DayStats } from '@/types'

function StatsTable({ stats }: { stats: DayStats[] }) {
  const tc = useTranslations('common')
  const filled = stats.filter((s) => s.num_consumos > 0)
  if (filled.length === 0) return null

  const avg = {
    kcal: Math.round(filled.reduce((s, d) => s + d.kcal, 0) / filled.length),
    proteinas: Math.round(filled.reduce((s, d) => s + d.proteinas, 0) / filled.length),
    carbohidratos: Math.round(filled.reduce((s, d) => s + d.carbohidratos, 0) / filled.length),
    grasas: Math.round(filled.reduce((s, d) => s + d.grasas, 0) / filled.length),
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {[
        { label: 'Promedio kcal', value: avg.kcal, unit: 'kcal', cls: '' },
        { label: 'Prot. media', value: avg.proteinas, unit: 'g', cls: 'macro-protein' },
        { label: 'Carbs media', value: avg.carbohidratos, unit: 'g', cls: 'macro-carbs' },
        { label: 'Grasas media', value: avg.grasas, unit: 'g', cls: 'macro-fat' },
      ].map((s) => (
        <div key={s.label} className="surface-card p-3">
          <p className="label-caps">{s.label}</p>
          <p className="metric mt-1 text-2xl">
            <span className={s.cls}>{s.value}</span>
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">{s.unit}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

export default function HistorialPage() {
  const t = useTranslations('historial')
  const { stats, loading, fetchRange } = useHistorial()
  const today = new Date()

  function loadWeek(offset = 0) {
    const ref = subWeeks(today, offset)
    fetchRange(
      format(startOfWeek(ref, { locale: es }), 'yyyy-MM-dd'),
      format(endOfWeek(ref, { locale: es }), 'yyyy-MM-dd')
    )
  }

  function loadMonth(offset = 0) {
    const ref = subMonths(today, offset)
    fetchRange(
      format(startOfMonth(ref), 'yyyy-MM-dd'),
      format(endOfMonth(ref), 'yyyy-MM-dd')
    )
  }

  useEffect(() => {
    loadWeek(0)
  }, [])

  return (
    <AppLayout>
      <div className="space-y-5">
        <h1 className="font-head text-2xl font-bold tracking-tight">{t('title')}</h1>

        <Tabs
          defaultValue="week"
          onValueChange={(v) => {
            if (v === 'week') loadWeek(0)
            else if (v === 'month') loadMonth(0)
          }}
        >
          <TabsList>
            <TabsTrigger value="week">{t('weekly')}</TabsTrigger>
            <TabsTrigger value="month">{t('monthly')}</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="label-caps">Macros esta semana</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : stats.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{t('noData')}</p>
                ) : (
                  <>
                    <WeeklyMacroChart stats={stats} />
                    <StatsTable stats={stats} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="month" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="label-caps">Macros este mes</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : stats.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{t('noData')}</p>
                ) : (
                  <>
                    <WeeklyMacroChart stats={stats} />
                    <StatsTable stats={stats} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
