'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AppLayout } from '@/components/layout/AppLayout'
import { useConsumos } from '@/hooks/useConsumos'
import { DailyLogTable } from '@/components/food/DailyLogTable'
import { AddFoodModal } from '@/components/food/AddFoodModal'
import { useProfile } from '@/hooks/useProfile'
import { sumMacros, calcMacrosFromGrams } from '@/lib/utils/macros'
import { CalorieProgressBar } from '@/components/dashboard/CalorieProgressBar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { GroupingMode, ConsumoFormData } from '@/types'

export default function LogPage() {
  const t = useTranslations('log')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('tipo_comida')
  const [modalOpen, setModalOpen] = useState(false)
  const { consumos, addConsumo, deleteConsumo, updateConsumoCantidad, loading } = useConsumos(fecha)
  const { objetivoDiario } = useProfile()
  const { toast } = useToast()

  const macros = sumMacros(
    consumos.map((c) => ({
      kcal: c.kcal,
      proteinas: c.proteinas,
      grasas: c.grasas,
      carbohidratos: c.carbohidratos,
      fibra: c.fibra ?? 0,
    }))
  )

  function prevDay() {
    setFecha(format(subDays(parseISO(fecha), 1), 'yyyy-MM-dd'))
  }
  function nextDay() {
    setFecha(format(addDays(parseISO(fecha), 1), 'yyyy-MM-dd'))
  }

  async function handleSave(data: ConsumoFormData) {
    const result = await addConsumo(data)
    if (result) {
      const m = calcMacrosFromGrams(data.alimento, data.cantidad_gr)
      toast({
        title: data.alimento.nombre,
        description: `+${m.kcal} kcal · P:${m.proteinas}g · C:${m.carbohidratos}g · G:${m.grasas}g`,
      })
    }
  }

  async function handleUpdateCantidad(id: string, cantidadGr: number) {
    const updated = await updateConsumoCantidad(id, cantidadGr)
    if (updated) {
      toast({
        title: updated.nombre_alimento,
        description: `Cantidad actualizada a ${updated.cantidad_gr}g`,
      })
    }
  }

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-head text-2xl font-bold tracking-tight">{t('title')}</h1>
          </div>
          <Button onClick={() => setModalOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {t('addFood')}
          </Button>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevDay}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 text-center">
            <p className="font-semibold text-sm capitalize">
              {format(parseISO(fecha), "EEEE, d 'de' MMMM yyyy", { locale: es })}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={nextDay}
            disabled={fecha >= new Date().toISOString().split('T')[0]}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calorie bar */}
        <Card>
          <CardContent className="pt-6">
            <CalorieProgressBar macros={macros} objetivo={objetivoDiario} />
          </CardContent>
        </Card>

        {/* Grouping selector */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground shrink-0">{t('groupBy')}:</span>
          <Select
            value={groupingMode}
            onValueChange={(v) => setGroupingMode(v as GroupingMode)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tipo_comida">{t('byMealType')}</SelectItem>
              <SelectItem value="numero_comida">{t('byMealNumber')}</SelectItem>
              <SelectItem value="hora">{t('byHour')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Log table */}
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Cargando...</p>
        ) : (
          <DailyLogTable
            consumos={consumos}
            groupingMode={groupingMode}
            onDelete={deleteConsumo}
            onUpdateCantidad={handleUpdateCantidad}
          />
        )}

        <AddFoodModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          onSave={handleSave}
          fecha={fecha}
        />
      </div>
    </AppLayout>
  )
}
