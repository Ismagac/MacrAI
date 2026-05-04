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
    <div className="grid grid-cols-4 gap-3 mt-4">
      {[
        { label: 'Promedio kcal', value: avg.kcal, unit: 'kcal', color: 'text-orange-500' },
        { label: 'Prot. media', value: avg.proteinas, unit: 'g', color: 'text-blue-500' },
        { label: 'Carbs media', value: avg.carbohidratos, unit: 'g', color: 'text-amber-500' },
        { label: 'Grasas media', value: avg.grasas, unit: 'g', color: 'text-red-500' },
      ].map((s) => (
        <div key={s.label} className="rounded-xl border p-3 text-center">
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-[10px] text-muted-foreground">{s.unit}</p>
          <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
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
        <h1 className="text-2xl font-bold">{t('title')}</h1>

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
                <CardTitle className="text-base">Macros esta semana</CardTitle>
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
                <CardTitle className="text-base">Macros este mes</CardTitle>
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
