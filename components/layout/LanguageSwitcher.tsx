'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Globe } from 'lucide-react'

const LOCALES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
]

export function LanguageSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  function switchLocale(next: string) {
    // Replace current locale prefix in path
    const pathWithoutLocale = pathname.replace(/^\/(es|en)/, '')
    router.push(`/${next}${pathWithoutLocale}`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Language">
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => switchLocale(l.code)}
            className={locale === l.code ? 'font-semibold' : ''}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
