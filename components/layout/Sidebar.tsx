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
    <aside className="hidden md:flex flex-col w-72 shrink-0 border-r border-border/70 bg-background/65 backdrop-blur-xl h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border/70">
        <div className="surface-premium flex items-center justify-between gap-2 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Zap className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Elite Nutrition</p>
              <span className="text-lg font-extrabold tracking-tight text-foreground">MacrAI</span>
            </div>
          </div>
          <span className="rounded-full bg-primary/12 px-2 py-1 text-[10px] font-bold text-primary">AI</span>
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
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 border',
                isActive
                  ? 'border-primary/20 bg-primary/12 text-foreground shadow-[0_16px_28px_-22px_hsl(var(--primary)/0.85)]'
                  : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-card/80 hover:text-foreground'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-primary/20 text-primary' : 'bg-muted/70 group-hover:bg-primary/10'
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
