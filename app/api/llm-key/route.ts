import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptSecret } from '@/lib/utils/crypto'
import { LLM_PROVIDERS, type LlmProviderId } from '@/lib/api/llm'

async function getAuthedUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  return { supabase, user: error ? null : user }
}

export async function GET() {
  const { supabase, user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_llm_keys')
    .select('provider, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    hasKey: Boolean(data),
    provider: data?.provider ?? null,
  })
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { provider?: unknown; apiKey?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = body.provider as LlmProviderId
  const apiKey = body.apiKey

  if (!LLM_PROVIDERS[provider]) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length < 10 || apiKey.length > 300) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 400 })
  }

  let encrypted: string
  try {
    encrypted = encryptSecret(apiKey.trim())
  } catch {
    return NextResponse.json({ error: 'Server key storage not configured' }, { status: 503 })
  }

  const { error } = await supabase.from('user_llm_keys').upsert({
    user_id: user.id,
    provider,
    api_key_enc: encrypted,
    updated_at: new Date().toISOString(),
  })

  if (error) return NextResponse.json({ error: 'Could not save key' }, { status: 500 })
  return NextResponse.json({ ok: true, provider })
}

export async function DELETE() {
  const { supabase, user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('user_llm_keys').delete().eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not delete key' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
