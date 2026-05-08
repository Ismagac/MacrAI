import type { Metadata } from 'next'
import { Manrope, Sora } from 'next/font/google'
import '../globals.css'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
import { AccentThemeProvider } from '@/components/theme/AccentThemeProvider'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'

const manrope = Manrope({ subsets: ['latin'], variable: '--font-body' })
const sora = Sora({ subsets: ['latin'], variable: '--font-head' })

export const metadata: Metadata = {
  title: 'MacrAI — Macro & Calorie Tracker',
  description: 'Rastrea tus macros y calorías con inteligencia artificial',
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!routing.locales.includes(locale as 'es' | 'en')) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${manrope.variable} ${sora.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AccentThemeProvider>
            <NextIntlClientProvider messages={messages}>
              {children}
              <Toaster />
            </NextIntlClientProvider>
          </AccentThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
