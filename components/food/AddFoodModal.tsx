'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FoodSearchCombobox } from './FoodSearchCombobox'
import { FoodEntryBreakdown } from './FoodEntryBreakdown'
import { calcMacrosFromGrams } from '@/lib/utils/macros'
import type { FoodItem, ConsumoFormData, MealType } from '@/types'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: ConsumoFormData) => Promise<void>
  fecha: string
}

const schema = z.object({
  cantidad_gr: z.coerce.number().positive().max(5000),
  tipo_comida: z.enum(['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro']),
  numero_comida: z.coerce.number().int().min(1).max(10),
})

type FormValues = z.infer<typeof schema>

const MEAL_TYPES: MealType[] = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro']

export function AddFoodModal({ open, onOpenChange, onSave, fecha }: Props) {
  const t = useTranslations('log')
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cantidad_gr: 100,
      tipo_comida: 'comida',
      numero_comida: 1,
    },
  })

  const cantidad = watch('cantidad_gr')
  const macros = selectedFood && cantidad > 0
    ? calcMacrosFromGrams(selectedFood, cantidad)
    : null

  function handleSelectFood(food: FoodItem) {
    setSelectedFood(food)
  }

  async function onSubmit(values: FormValues) {
    if (!selectedFood) return
    setSaving(true)
    await onSave({
      alimento: selectedFood,
      cantidad_gr: values.cantidad_gr,
      tipo_comida: values.tipo_comida,
      numero_comida: values.numero_comida,
      fecha,
    })
    setSaving(false)
    setSelectedFood(null)
    reset()
    onOpenChange(false)
  }

  function handleClose() {
    setSelectedFood(null)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addFood')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1: search food */}
          {!selectedFood ? (
            <FoodSearchCombobox onSelect={handleSelectFood} />
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Selected food */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{selectedFood.nombre}</p>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedFood(null)}
                  >
                    Cambiar
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedFood.kcal_100g} kcal · {selectedFood.proteinas_100g}g P · {selectedFood.carbohidratos_100g}g C · {selectedFood.grasas_100g}g G / 100g
                </p>
              </div>

              {/* Quantity */}
              <div className="space-y-1.5">
                <Label htmlFor="cantidad_gr">{t('quantity')}</Label>
                <Input
                  id="cantidad_gr"
                  type="number"
                  step="0.5"
                  {...register('cantidad_gr')}
                  className={errors.cantidad_gr ? 'border-destructive' : ''}
                />
              </div>

              {/* Breakdown preview */}
              {macros && (
                <FoodEntryBreakdown
                  macros={macros}
                  foodName={selectedFood.nombre}
                  quantityGr={cantidad}
                />
              )}

              {/* Meal type */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('mealType')}</Label>
                  <Select
                    defaultValue="comida"
                    onValueChange={(v) => setValue('tipo_comida', v as MealType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEAL_TYPES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {t(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="numero_comida">{t('mealNumber')}</Label>
                  <Input
                    id="numero_comida"
                    type="number"
                    min={1}
                    max={10}
                    {...register('numero_comida')}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                  {t('cancel')}
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? '...' : t('save')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
