import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

const PUBLIC_PATHS = ['/login', '/register', '/auth/callback']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware entirely for API routes
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Handle i18n routing first
  const intlResponse = intlMiddleware(request)

  // Extract locale from pathname
  const localeMatch = pathname.match(/^\/(es|en)/)
  const pathWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[0].length) || '/'
    : pathname

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathWithoutLocale.startsWith(p))) {
    return intlResponse
  }

  // Refresh Supabase session
  const response = intlResponse || NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && pathWithoutLocale !== '/') {
    const locale = localeMatch?.[1] ?? routing.defaultLocale
    return NextResponse.redirect(
      new URL(`/${locale}/login`, request.url)
    )
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
