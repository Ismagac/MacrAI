import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserLlmKey } from '@/lib/api/byok'

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const WHISPER_MODEL = 'whisper-large-v3-turbo'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'Missing audio' }, { status: 400 })
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio too large' }, { status: 413 })
  }

  // Whisper corre en Groq: key de app primero, key propia del usuario si es de Groq
  const userKey = await getUserLlmKey(supabase, user.id)
  const groqKeys = [
    process.env.GROQ_API_KEY,
    userKey?.provider === 'groq' ? userKey.apiKey : undefined,
  ].filter((k): k is string => Boolean(k))

  if (groqKeys.length === 0) {
    return NextResponse.json({ error: 'Transcription not configured' }, { status: 503 })
  }

  let lastStatus = 500
  for (const apiKey of groqKeys) {
    const upstream = new FormData()
    upstream.append('file', audio, 'audio.webm')
    upstream.append('model', WHISPER_MODEL)
    upstream.append('language', 'es')
    upstream.append('response_format', 'json')

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    })

    if (response.ok) {
      const data = (await response.json()) as { text?: string }
      return NextResponse.json({ text: data.text ?? '' })
    }

    lastStatus = response.status
    if (response.status !== 401 && response.status !== 429) break
  }

  return NextResponse.json({ error: 'Transcription failed' }, { status: lastStatus === 429 ? 429 : 502 })
}
