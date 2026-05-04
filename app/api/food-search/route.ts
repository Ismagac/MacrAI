import { NextRequest, NextResponse } from 'next/server'
import { searchOpenFoodFacts } from '@/lib/api/openfoodfacts'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')
  if (!query || query.length < 2) {
    return NextResponse.json([])
  }

  try {
    const results = await searchOpenFoodFacts(query, 6)
    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    console.error('[food-search] error:', e)
    return NextResponse.json([])
  }
}
