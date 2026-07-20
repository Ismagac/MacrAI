'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Consumo, Objetivo } from '@/types'
import { sumMacros, calcMacrosFromGrams } from '@/lib/utils/macros'
import { MacroPieChart } from '@/components/charts/MacroPieChart'
import { CalorieProgressBar } from '@/components/dashboard/CalorieProgressBar'
import { MacroSummaryCards } from '@/components/dashboard/MacroSummaryCards'
import { TelegramBanner } from '@/components/dashboard/TelegramBanner'
import { AddFoodModal } from '@/components/food/AddFoodModal'
import { useConsumos } from '@/hooks/useConsumos'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface Props {
  initialConsumos: Consumo[]
  objetivo: Objetivo | null
  today: string
  locale: string
}

export function DashboardClient({ initialConsumos, objetivo, today, locale }: Props) {
  const t = useTranslations('dashboard')
  const [modalOpen, setModalOpen] = useState(false)
  const { consumos, addConsumo, deleteConsumo } = useConsumos(today)
  const { toast } = useToast()

  // Use server-fetched data as initial, then live from hook
  const allConsumos = consumos.length > 0 ? consumos : initialConsumos

  const macros = sumMacros(
    allConsumos.map((c) => ({
      kcal: c.kcal,
      proteinas: c.proteinas,
      grasas: c.grasas,
      carbohidratos: c.carbohidratos,
      fibra: c.fibra ?? 0,
    }))
  )

  async function handleSave(data: Parameters<typeof addConsumo>[0]) {
    const result = await addConsumo(data)
    if (result) {
      const macrosEntry = calcMacrosFromGrams(data.alimento, data.cantidad_gr)
      toast({
        title: data.alimento.nombre,
        description: `+${macrosEntry.kcal} kcal · P:${macrosEntry.proteinas}g C:${macrosEntry.carbohidratos}g G:${macrosEntry.grasas}g`,
      })
    }
  }

  const recentConsumos = [...allConsumos].reverse().slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="surface-premium p-4 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="label-caps text-brand">MacrAI Performance Board</p>
            <h1 className="text-2xl md:text-3xl font-extrabold mt-1">{t('title')}</h1>
            <p className="text-sm text-muted-foreground capitalize mt-1">
              {format(new Date(today + 'T12:00:00'), "EEEE, d 'de' MMMM", { locale: es })}
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-brand">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Seguimiento diario activo
            </div>
          </div>
          <Button onClick={() => setModalOpen(true)} size="sm" className="shrink-0">
            <Plus className="h-4 w-4 mr-1" />
            {t('addFood')}
          </Button>
        </div>
      </div>

      {/* Calorie progress */}
      <Card className="surface-premium">
        <CardContent className="pt-6">
          <CalorieProgressBar macros={macros} objetivo={objetivo} />
        </CardContent>
      </Card>

      {/* Telegram banner */}
      <TelegramBanner />

      {/* Macro cards */}
      <MacroSummaryCards macros={macros} objetivo={objetivo} />

      {/* Chart + Recent log */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="surface-card">
          <CardHeader>
            <CardTitle className="text-base">{t('todayMacros')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MacroPieChart macros={macros} />
          </CardContent>
        </Card>

        <Card className="surface-card">
          <CardHeader>
            <CardTitle className="text-base">{t('recentLog')}</CardTitle>
          </CardHeader>
          <CardContent>
            {recentConsumos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t('noData')}</p>
            ) : (
              <ul className="space-y-2.5">
                {recentConsumos.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.nombre_alimento}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.cantidad_gr}g · {Math.round(c.kcal)} kcal
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteConsumo(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <AddFoodModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleSave}
        fecha={today}
      />
    </div>
  )
}
