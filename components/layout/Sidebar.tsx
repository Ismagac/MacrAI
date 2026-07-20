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
  MessageCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Logo } from '@/components/brand/Logo'

const navItems = [
  { key: 'chat', href: '/chat', icon: MessageCircle },
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
    <aside className="hidden md:flex flex-col w-[232px] shrink-0 border-r border-border bg-background h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <Logo size={30} />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
        {navItems.map(({ key, href, icon: Icon }) => {
          const fullHref = `/${locale}${href}`
          const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
          return (
            <Link
              key={key}
              href={fullHref}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold transition-all duration-200 border-l-2',
                isActive
                  ? 'border-l-primary bg-secondary/70 text-foreground border-t-transparent border-r-transparent border-b-transparent'
                  : 'border-l-transparent text-muted-foreground border-t-transparent border-r-transparent border-b-transparent hover:bg-secondary/60 hover:text-foreground'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-primary/15 text-primary' : 'bg-muted/70 group-hover:bg-muted'
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
