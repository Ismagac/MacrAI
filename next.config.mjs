/** @type {import('next').NextConfig} */
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'world.openfoodfacts.org' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
}

export default withNextIntl(nextConfig)
