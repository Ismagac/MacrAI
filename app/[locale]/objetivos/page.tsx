'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { AppLayout } from '@/components/layout/AppLayout'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Target } from 'lucide-react'
import type { Objetivo, Periodo } from '@/types'

const schema = z.object({
  kcal_objetivo: z.coerce.number().positive(),
  proteinas_objetivo: z.coerce.number().min(0),
  grasas_objetivo: z.coerce.number().min(0),
  carbohidratos_objetivo: z.coerce.number().min(0),
})
type FormValues = z.infer<typeof schema>

function GoalForm({
  periodo,
  existing,
  onSaved,
}: {
  periodo: Periodo
  existing?: Objetivo
  onSaved: () => void
}) {
  const t = useTranslations('objetivos')
  const { toast } = useToast()

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kcal_objetivo: existing?.kcal_objetivo ?? 2000,
      proteinas_objetivo: existing?.proteinas_objetivo ?? 150,
      grasas_objetivo: existing?.grasas_objetivo ?? 65,
      carbohidratos_objetivo: existing?.carbohidratos_objetivo ?? 250,
    },
  })

  async function onSubmit(values: FormValues) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Deactivate previous active goal for same period
    await supabase
      .from('objetivos')
      .update({ activo: false })
      .eq('user_id', user.id)
      .eq('periodo', periodo)
      .eq('activo', true)

    await supabase.from('objetivos').insert({
      user_id: user.id,
      periodo,
      ...values,
      activo: true,
      fecha_inicio: new Date().toISOString().split('T')[0],
    })

    toast({ title: 'Objetivo guardado' })
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>{t('kcal')}</Label>
          <Input type="number" {...register('kcal_objetivo')} />
        </div>
        <div>
          <Label>{t('protein')}</Label>
          <Input type="number" step="0.5" {...register('proteinas_objetivo')} />
        </div>
        <div>
          <Label>{t('carbs')}</Label>
          <Input type="number" step="0.5" {...register('carbohidratos_objetivo')} />
        </div>
        <div>
          <Label>{t('fat')}</Label>
          <Input type="number" step="0.5" {...register('grasas_objetivo')} />
        </div>
      </div>
      <Button type="submit" disabled={isSubmitting}>{t('save')}</Button>
    </form>
  )
}

export default function ObjetivosPage() {
  const t = useTranslations('objetivos')
  const searchParams = useSearchParams()
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const supabase = createClient()
    const { data } = await supabase
      .from('objetivos')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false })
    setObjetivos((data ?? []) as Objetivo[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const kcalFromTDEE = searchParams.get('kcal')

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-6">
        <h1 className="font-head text-2xl font-bold tracking-tight">{t('title')}</h1>

        {/* Active goals summary */}
        {!loading && objetivos.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{t('active')}</p>
            <div className="flex flex-wrap gap-2">
              {objetivos.map((o) => (
                <Card key={o.id} className="flex-1 min-w-40">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="secondary" className="text-xs">{t(o.periodo)}</Badge>
                    </div>
                    <p className="metric text-xl">{o.kcal_objetivo} <span className="text-xs font-normal text-muted-foreground">kcal</span></p>
                    <p className="text-xs text-muted-foreground">
                      P:{o.proteinas_objetivo}g · C:{o.carbohidratos_objetivo}g · G:{o.grasas_objetivo}g
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Set goals */}
        <Tabs defaultValue="diario">
          <TabsList>
            <TabsTrigger value="diario">{t('diario')}</TabsTrigger>
            <TabsTrigger value="semanal">{t('semanal')}</TabsTrigger>
            <TabsTrigger value="mensual">{t('mensual')}</TabsTrigger>
          </TabsList>
          {(['diario', 'semanal', 'mensual'] as Periodo[]).map((p) => (
            <TabsContent key={p} value={p} className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Objetivo {t(p)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <GoalForm
                    periodo={p}
                    existing={objetivos.find((o) => o.periodo === p)}
                    onSaved={load}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AppLayout>
  )
}
