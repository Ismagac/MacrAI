import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const today = new Date().toISOString().split('T')[0]

  const [{ data: consumosData }, { data: objetivoData }] = await Promise.all([
    supabase
      .from('consumos')
      .select('*')
      .eq('fecha', today)
      .order('hora_insercion', { ascending: true }),
    supabase
      .from('objetivos')
      .select('*')
      .eq('user_id', user.id)
      .eq('periodo', 'diario')
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return (
    <AppLayout>
      <DashboardClient
        initialConsumos={consumosData ?? []}
        objetivo={objetivoData}
        today={today}
        locale={locale}
      />
    </AppLayout>
  )
}
