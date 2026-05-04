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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur flex h-16">
      {items.map(({ key, href, icon: Icon }) => {
        const fullHref = `/${locale}${href}`
        const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
        return (
          <Link
            key={key}
            href={fullHref}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{t(key)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
