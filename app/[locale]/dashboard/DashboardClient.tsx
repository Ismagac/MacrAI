'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Consumo, Objetivo } from '@/types'
import { sumMacros, calcMacrosFromGrams } from '@/lib/utils/macros'
import { CalorieRing } from '@/components/dashboard/CalorieRing'
import { MealBreakdown } from '@/components/dashboard/MealBreakdown'
import { TodayTable } from '@/components/dashboard/TodayTable'
import { MacroSummaryCards } from '@/components/dashboard/MacroSummaryCards'
import { TelegramBanner } from '@/components/dashboard/TelegramBanner'
import { AddFoodModal } from '@/components/food/AddFoodModal'
import { useConsumos } from '@/hooks/useConsumos'
import { Button } from '@/components/ui/button'
import { Plus, MessageCircle } from 'lucide-react'
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

  const goal = objetivo?.kcal_objetivo ?? 2000

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

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {format(new Date(today + 'T12:00:00'), "EEEE, d 'de' MMMM", { locale: es })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/chat`}>
              <MessageCircle className="mr-1 h-4 w-4" />
              Preguntar a MacrAI
            </Link>
          </Button>
          <Button onClick={() => setModalOpen(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            {t('addFood')}
          </Button>
        </div>
      </div>

      {/* KPIs de macros */}
      <MacroSummaryCards macros={macros} objetivo={objetivo} />

      {/* Calorías: anillo + reparto por comida */}
      <div className="surface-card p-4">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <CalorieRing value={macros.kcal} goal={goal} />
          <div className="w-full flex-1">
            <p className="label-caps mb-3">Reparto por comida</p>
            <MealBreakdown consumos={allConsumos} />
          </div>
        </div>
      </div>

      <TelegramBanner />

      {/* Registro del día */}
      <div className="surface-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <p className="label-caps">Registro de hoy</p>
          <span className="text-xs text-muted-foreground">
            {allConsumos.length} {allConsumos.length === 1 ? 'entrada' : 'entradas'}
          </span>
        </div>
        <TodayTable consumos={[...allConsumos].reverse()} onDelete={deleteConsumo} />
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
