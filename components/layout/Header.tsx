'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { DarkModeToggle } from './DarkModeToggle'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, User } from 'lucide-react'

export function Header() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}/login`)
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border/70 bg-background/70 backdrop-blur-xl px-4 md:px-6">
      {/* Mobile logo */}
      <div className="md:hidden flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">AI</span>
        <span className="text-lg font-extrabold tracking-tight">MacrAI</span>
      </div>

      <div className="hidden md:flex items-center gap-3">
        <div className="surface-premium px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Control Hub</p>
          <p className="text-sm font-semibold text-foreground">Nutricion y progreso</p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <LanguageSwitcher />
        <DarkModeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/${locale}/perfil`)}>
              <User className="mr-2 h-4 w-4" />
              {t('perfil')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
