import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectMacrosFromImage } from '@/lib/api/ai'
import { getUserLlmKey } from '@/lib/api/byok'

const MAX_IMAGE_BYTES = 6 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { image?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const image = body.image
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'Invalid image' }, { status: 400 })
  }
  if (image.length > MAX_IMAGE_BYTES * 1.4) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  const userKey = await getUserLlmKey(supabase, user.id)
  const result = await detectMacrosFromImage(image, userKey)

  return NextResponse.json(result)
}
