'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  LayoutDashboard,
  BookOpen,
  History,
  Apple,
  User,
  Target,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const navItems = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'log', href: '/log', icon: BookOpen },
  { key: 'historial', href: '/historial', icon: History },
  { key: 'alimentos', href: '/alimentos', icon: Apple },
  { key: 'objetivos', href: '/objetivos', icon: Target },
  { key: 'perfil', href: '/perfil', icon: User },
] as const

export function Sidebar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r bg-background h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b">
        <Zap className="h-6 w-6 text-primary" />
        <span className="text-xl font-bold tracking-tight">MacrAI</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ key, href, icon: Icon }) => {
          const fullHref = `/${locale}${href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          return (
            <Link
              key={key}
              href={fullHref}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(key)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
