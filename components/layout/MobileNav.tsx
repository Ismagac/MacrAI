'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { LayoutDashboard, BookOpen, History, Apple, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const items = [
  { key: 'chat', href: '/chat', icon: MessageCircle },
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'log', href: '/log', icon: BookOpen },
  { key: 'historial', href: '/historial', icon: History },
  { key: 'alimentos', href: '/alimentos', icon: Apple },
] as const

export function MobileNav() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background flex h-16 px-1 pb-[env(safe-area-inset-bottom)]">
      {items.map(({ key, href, icon: Icon }) => {
        const fullHref = `/${locale}${href}`
        const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
        return (
          <Link
            key={key}
            href={fullHref}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold rounded-xl transition-all',
              isActive ? 'text-brand' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            <span>{t(key)}</span>
            {isActive && <span className="absolute bottom-1.5 h-1 w-5 rounded-full bg-primary" />}
          </Link>
        )
      })}
    </nav>
  )
}
