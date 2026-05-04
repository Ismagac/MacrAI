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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground capitalize">
            {format(new Date(today + 'T12:00:00'), "EEEE, d 'de' MMMM", { locale: es })}
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t('addFood')}
        </Button>
      </div>

      {/* Calorie progress */}
      <Card>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('todayMacros')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MacroPieChart macros={macros} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recentLog')}</CardTitle>
          </CardHeader>
          <CardContent>
            {recentConsumos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t('noData')}</p>
            ) : (
              <ul className="space-y-2">
                {recentConsumos.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
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
