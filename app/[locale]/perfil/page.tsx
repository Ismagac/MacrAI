'use client'

import { useEffect } from 'react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { AppLayout } from '@/components/layout/AppLayout'
import { useProfile } from '@/hooks/useProfile'
import { calcTDEE } from '@/lib/utils/macros'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import type { ActivityLevel, Sexo } from '@/types'
import { Zap, KeyRound } from 'lucide-react'
import { ACCENT_THEMES, type AccentTheme, getStoredAccentTheme, setStoredAccentTheme } from '@/lib/theme/accent'

const schema = z.object({
  username: z.string().optional(),
  peso_kg: z.coerce.number().positive().max(400).optional(),
  altura_cm: z.coerce.number().positive().max(300).optional(),
  edad: z.coerce.number().int().positive().max(120).optional(),
  sexo: z.enum(['hombre', 'mujer', 'otro']).optional(),
  nivel_actividad: z
    .enum(['sedentario', 'ligero', 'moderado', 'activo', 'muy_activo'])
    .optional(),
})
type FormValues = z.infer<typeof schema>

export default function PerfilPage() {
  const t = useTranslations('perfil')
  const locale = useLocale()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { profile, loading, updateProfile } = useProfile()
  const { toast } = useToast()
  const [accentTheme, setAccentTheme] = useState<AccentTheme>('green')
  const [llmProvider, setLlmProvider] = useState('groq')
  const [llmKey, setLlmKey] = useState('')
  const [llmConfigured, setLlmConfigured] = useState<string | null>(null)
  const [llmSaving, setLlmSaving] = useState(false)

  useEffect(() => {
    setAccentTheme(getStoredAccentTheme())
  }, [])

  useEffect(() => {
    fetch('/api/llm-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.hasKey) {
          setLlmConfigured(d.provider)
          setLlmProvider(d.provider)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!profile) return

    if (profile.accent_theme) {
      setStoredAccentTheme(profile.accent_theme)
      setAccentTheme(profile.accent_theme)
    }

    if (profile.theme_mode) {
      setTheme(profile.theme_mode)
    }
  }, [profile, setTheme])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (profile) {
      reset({
        username: profile.username ?? '',
        peso_kg: profile.peso_kg,
        altura_cm: profile.altura_cm,
        edad: profile.edad,
        sexo: profile.sexo,
        nivel_actividad: profile.nivel_actividad,
      })
    }
  }, [profile, reset])

  const values = watch()
  const tdee = profile?.id
    ? calcTDEE({
        ...profile,
        peso_kg: values.peso_kg ?? profile.peso_kg,
        altura_cm: values.altura_cm ?? profile.altura_cm,
        edad: values.edad ?? profile.edad,
        sexo: (values.sexo ?? profile.sexo) as Sexo,
        nivel_actividad: (values.nivel_actividad ?? profile.nivel_actividad) as ActivityLevel,
      })
    : null

  async function onSubmit(data: FormValues) {
    const err = await updateProfile(data)
    if (!err) toast({ title: t('saved') })
  }

  async function handleThemeModeChange(mode: 'light' | 'dark' | 'system') {
    setTheme(mode)
    const err = await updateProfile({ theme_mode: mode })
    if (err) {
      toast({ title: 'No se pudo guardar el modo de tema', variant: 'destructive' })
    }
  }

  async function handleAccentThemeChange(color: AccentTheme) {
    setStoredAccentTheme(color)
    setAccentTheme(color)
    const err = await updateProfile({ accent_theme: color })
    if (err) {
      toast({ title: 'No se pudo guardar el color primario', variant: 'destructive' })
    }
  }

  function useTDEEAsGoal() {
    if (tdee) router.push(`/${locale}/objetivos?kcal=${tdee.tdee}`)
  }

  async function handleSaveLlmKey() {
    if (!llmKey.trim()) return
    setLlmSaving(true)
    try {
      const res = await fetch('/api/llm-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: llmProvider, apiKey: llmKey.trim() }),
      })
      if (!res.ok) throw new Error()
      setLlmConfigured(llmProvider)
      setLlmKey('')
      toast({ title: t('aiSaved') })
    } catch {
      toast({ title: t('aiError'), variant: 'destructive' })
    } finally {
      setLlmSaving(false)
    }
  }

  async function handleDeleteLlmKey() {
    setLlmSaving(true)
    try {
      const res = await fetch('/api/llm-key', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setLlmConfigured(null)
      toast({ title: t('aiDeleted') })
    } catch {
      toast({ title: t('aiError'), variant: 'destructive' })
    } finally {
      setLlmSaving(false)
    }
  }

  if (loading) return <AppLayout><p className="text-muted-foreground">Cargando...</p></AppLayout>

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>

        <Card className="border-primary/20 shadow-lg shadow-primary/10">
          <CardHeader>
            <CardTitle className="text-base">{t('appearanceTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{t('themeMode')}</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={theme === 'light' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeModeChange('light')}
                >
                  {t('themeLight')}
                </Button>
                <Button
                  type="button"
                  variant={theme === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeModeChange('dark')}
                >
                  {t('themeDark')}
                </Button>
                <Button
                  type="button"
                  variant={theme === 'system' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleThemeModeChange('system')}
                >
                  {t('themeSystem')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('primaryColor')}</Label>
              <div className="flex flex-wrap gap-2">
                {ACCENT_THEMES.map((color) => {
                  const bg =
                    color === 'green'
                      ? 'bg-[#10B981]'
                      : color === 'lilac'
                        ? 'bg-[#8B5CF6]'
                        : color === 'pink'
                          ? 'bg-[#EC4899]'
                          : color === 'sky'
                            ? 'bg-[#0EA5E9]'
                            : 'bg-[#F59E0B]'

                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => handleAccentThemeChange(color)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition hover:scale-[1.02] ${accentTheme === color ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}
                    >
                      <span className={`h-3.5 w-3.5 rounded-full ${bg}`} />
                      {t(`color_${color}` as 'color_green')}
                    </button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              {t('aiTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('aiDescription')}</p>

            {llmConfigured && (
              <p className="text-sm font-medium text-primary">
                ✅ {t('aiConfigured', { provider: llmConfigured })}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('aiProvider')}</Label>
                <Select value={llmProvider} onValueChange={setLlmProvider}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="xai">xAI (Grok)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('aiKey')}</Label>
                <Input
                  type="password"
                  value={llmKey}
                  onChange={(e) => setLlmKey(e.target.value)}
                  placeholder={t('aiKeyPlaceholder')}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveLlmKey} disabled={llmSaving || !llmKey.trim()}>
                {t('aiSave')}
              </Button>
              {llmConfigured && (
                <Button size="sm" variant="outline" onClick={handleDeleteLlmKey} disabled={llmSaving}>
                  {t('aiDelete')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label>{t('username')}</Label>
                <Input {...register('username')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t('weight')}</Label>
                  <Input type="number" step="0.1" {...register('peso_kg')} />
                </div>
                <div>
                  <Label>{t('height')}</Label>
                  <Input type="number" step="0.5" {...register('altura_cm')} />
                </div>
                <div>
                  <Label>{t('age')}</Label>
                  <Input type="number" {...register('edad')} />
                </div>
                <div>
                  <Label>{t('sex')}</Label>
                  <Select
                    value={values.sexo ?? ''}
                    onValueChange={(v) => setValue('sexo', v as Sexo)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hombre">{t('hombre')}</SelectItem>
                      <SelectItem value="mujer">{t('mujer')}</SelectItem>
                      <SelectItem value="otro">{t('otro')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>{t('activityLevel')}</Label>
                <Select
                  value={values.nivel_actividad ?? ''}
                  onValueChange={(v) => setValue('nivel_actividad', v as ActivityLevel)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['sedentario', 'ligero', 'moderado', 'activo', 'muy_activo'] as ActivityLevel[]).map((l) => (
                      <SelectItem key={l} value={l}>{t(l)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={isSubmitting}>{t('save')}</Button>
            </form>
          </CardContent>
        </Card>

        {/* TDEE card */}
        {tdee && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                {t('tdee')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold">{tdee.bmr}</p>
                  <p className="text-xs text-muted-foreground">{t('bmr')} (kcal)</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{tdee.tdee}</p>
                  <p className="text-xs text-muted-foreground">{t('tdee')} (kcal)</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={useTDEEAsGoal}>
                {t('useTdee')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
