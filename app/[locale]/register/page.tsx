'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Zap } from 'lucide-react'

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof schema>

export default function RegisterPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const locale = useLocale()
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(values: FormValues) {
    setServerError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/auth/callback`,
      },
    })
    if (error) {
      setServerError(t('registerError'))
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center p-6">
          <p className="font-semibold text-lg mb-2">¡Revisa tu email!</p>
          <p className="text-sm text-muted-foreground">
            Te hemos enviado un enlace de confirmación.
          </p>
          <Link href={`/${locale}/login`} className="mt-4 block text-sm text-primary underline-offset-4 hover:underline">
            Volver al login
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-8 w-8 text-primary" />
            <span className="text-3xl font-bold tracking-tight">MacrAI</span>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('register')}</CardTitle>
            <CardDescription>
              {t('hasAccount')}{' '}
              <Link href={`/${locale}/login`} className="text-primary underline-offset-4 hover:underline">
                {t('login')}
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')}</Label>
                <Input id="email" type="email" {...register('email')} className={errors.email ? 'border-destructive' : ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('password')}</Label>
                <Input id="password" type="password" {...register('password')} className={errors.password ? 'border-destructive' : ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
                <Input id="confirmPassword" type="password" {...register('confirmPassword')} className={errors.confirmPassword ? 'border-destructive' : ''} />
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? '...' : t('register')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
