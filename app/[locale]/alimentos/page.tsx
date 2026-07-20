'use client'

import { useState, useCallback } from 'react'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppLayout } from '@/components/layout/AppLayout'
import { FoodSearchCombobox } from '@/components/food/FoodSearchCombobox'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { FoodItemUsuario } from '@/types'

const foodSchema = z.object({
  nombre: z.string().min(2),
  macros_basis: z.enum(['per_100g', 'per_unit']).default('per_100g'),
  unit_name: z.string().optional(),
  kcal_100g: z.coerce.number().min(0),
  proteinas_100g: z.coerce.number().min(0),
  grasas_100g: z.coerce.number().min(0),
  carbohidratos_100g: z.coerce.number().min(0),
  fibra_100g: z.coerce.number().min(0).optional(),
  kcal_per_unit: z.coerce.number().min(0).optional(),
  proteinas_per_unit: z.coerce.number().min(0).optional(),
  grasas_per_unit: z.coerce.number().min(0).optional(),
  carbohidratos_per_unit: z.coerce.number().min(0).optional(),
})
type FoodFormValues = z.infer<typeof foodSchema>

function FoodForm({
  defaultValues,
  onSave,
  onCancel,
}: {
  defaultValues?: Partial<FoodFormValues>
  onSave: (v: FoodFormValues) => void
  onCancel: () => void
}) {
  const t = useTranslations('alimentos')
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FoodFormValues>({
    resolver: zodResolver(foodSchema),
    defaultValues,
  })

  const macrosBasis = watch('macros_basis') || 'per_100g'
  const macroFields: [keyof FoodFormValues, string][] =
    macrosBasis === 'per_unit'
      ? [
          ['kcal_per_unit', 'Kcal por unidad'],
          ['proteinas_per_unit', 'Proteínas por unidad'],
          ['carbohidratos_per_unit', 'Carbohidratos por unidad'],
          ['grasas_per_unit', 'Grasas por unidad'],
        ]
      : [
          ['kcal_100g', t('kcalPer100')],
          ['proteinas_100g', t('proteinPer100')],
          ['carbohidratos_100g', t('carbsPer100')],
          ['grasas_100g', t('fatPer100')],
          ['fibra_100g', t('fiberPer100')],
        ]

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-3">
      <div>
        <Label>{t('name')}</Label>
        <Input {...register('nombre')} className={errors.nombre ? 'border-destructive' : ''} />
      </div>

      <div>
        <Label>Base de macros</Label>
        <Select
          defaultValue={defaultValues?.macros_basis || 'per_100g'}
          onValueChange={(v) => setValue('macros_basis', v as 'per_100g' | 'per_unit')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_100g">Por 100 gramos</SelectItem>
            <SelectItem value="per_unit">Por unidad</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {macrosBasis === 'per_unit' && (
        <div>
          <Label>Nombre de unidad</Label>
          <Input placeholder="Ej: 1 helado, 1 galleta, 1 porción" {...register('unit_name')} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {macroFields.map(([field, label]) => (
          <div key={field}>
            <Label>{label}</Label>
            <Input type="number" step="0.1" {...register(field)} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {t('save')}
        </Button>
      </div>
    </form>
  )
}

function MyFoodsCatalogue() {
  const t = useTranslations('alimentos')
  const { toast } = useToast()
  const [foods, setFoods] = useState<FoodItemUsuario[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editFood, setEditFood] = useState<FoodItemUsuario | null>(null)

  const loadFoods = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('alimentos_usuario')
      .select('*')
      .order('created_at', { ascending: false })
    setFoods((data ?? []) as FoodItemUsuario[])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadFoods()
  }, [loadFoods])

  async function handleAdd(values: FoodFormValues) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('alimentos_usuario')
      .insert({ ...values, user_id: user.id })
      .select()
      .single()
    if (!error && data) {
      setFoods((prev) => [data as FoodItemUsuario, ...prev])
      setAddOpen(false)
      toast({ title: 'Alimento añadido' })
    }
  }

  async function handleEdit(values: FoodFormValues) {
    if (!editFood) return
    const supabase = createClient()
    const { data, error } = await supabase
      .from('alimentos_usuario')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', editFood.id)
      .select()
      .single()
    if (!error && data) {
      setFoods((prev) => prev.map((f) => (f.id === editFood.id ? (data as FoodItemUsuario) : f)))
      setEditFood(null)
    }
  }

  async function handleDelete(id: string) {
    const supabase = createClient()
    await supabase.from('alimentos_usuario').delete().eq('id', id)
    setFoods((prev) => prev.filter((f) => f.id !== id))
  }

  if (loading) return <Skeleton className="h-40 w-full" />

  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        {t('addCustom')}
      </Button>

      {foods.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t('noFoods')}</p>
      ) : (
        <div className="rounded-xl border divide-y overflow-hidden">
          {foods.map((food) => (
            <div key={food.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{food.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {food.macros_basis === 'per_unit'
                    ? `${food.kcal_per_unit ?? 0} kcal · P:${food.proteinas_per_unit ?? 0}g · C:${food.carbohidratos_per_unit ?? 0}g · G:${food.grasas_per_unit ?? 0}g / ${food.unit_name || 'unidad'}`
                    : `${food.kcal_100g} kcal · P:${food.proteinas_100g}g · C:${food.carbohidratos_100g}g · G:${food.grasas_100g}g / 100g`}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditFood(food)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(food.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addCustom')}</DialogTitle>
          </DialogHeader>
          <FoodForm onSave={handleAdd} onCancel={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editFood} onOpenChange={(o) => !o && setEditFood(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('edit')}</DialogTitle>
          </DialogHeader>
          {editFood && (
            <FoodForm
              defaultValues={editFood}
              onSave={handleEdit}
              onCancel={() => setEditFood(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AlimentosPage() {
  const t = useTranslations('alimentos')

  return (
    <AppLayout>
      <div className="space-y-5">
        <h1 className="font-head text-2xl font-bold tracking-tight">{t('title')}</h1>

        <Tabs defaultValue="search">
          <TabsList>
            <TabsTrigger value="search">{t('search')}</TabsTrigger>
            <TabsTrigger value="my">{t('myFoods')}</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Buscar en las 3 fuentes</CardTitle>
              </CardHeader>
              <CardContent>
                <FoodSearchCombobox onSelect={(food) => {
                  // When searching from the catalogue page, just show info
                  // (no logging here, use the log page for that)
                }} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="my" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('myFoods')}</CardTitle>
              </CardHeader>
              <CardContent>
                <MyFoodsCatalogue />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
