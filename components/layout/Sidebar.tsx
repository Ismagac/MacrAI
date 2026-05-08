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
    <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-primary/15 bg-background/60 backdrop-blur-xl h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-primary/10">
        <div className="surface-card surface-glow flex items-center gap-2 px-4 py-3">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-lg font-extrabold tracking-tight text-primary">MacrAI</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        {navItems.map(({ key, href, icon: Icon }) => {
          const fullHref = `/${locale}${href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          return (
            <Link
              key={key}
              href={fullHref}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_-16px_hsl(var(--primary)/0.95)]'
                  : 'text-muted-foreground hover:bg-card/80 hover:text-foreground'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-primary-foreground/20' : 'bg-muted/60 group-hover:bg-primary/10'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
              </span>
              {t(key)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
