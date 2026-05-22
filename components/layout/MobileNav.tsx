'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { LayoutDashboard, BookOpen, History, Apple, Target } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const items = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'log', href: '/log', icon: BookOpen },
  { key: 'historial', href: '/historial', icon: History },
  { key: 'alimentos', href: '/alimentos', icon: Apple },
  { key: 'objetivos', href: '/objetivos', icon: Target },
] as const

export function MobileNav() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-3 left-3 right-3 z-40 rounded-2xl border border-border/70 bg-background/85 backdrop-blur-xl flex h-16 px-1 shadow-[0_22px_48px_-26px_hsl(var(--foreground)/0.5)]">
      {items.map(({ key, href, icon: Icon }) => {
        const fullHref = `/${locale}${href}`
        const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
        return (
          <Link
            key={key}
            href={fullHref}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold rounded-xl transition-all',
              isActive ? 'bg-primary/14 text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{t(key)}</span>
            {isActive && <span className="absolute bottom-1.5 h-1 w-5 rounded-full bg-primary/80" />}
          </Link>
        )
      })}
    </nav>
  )
}
