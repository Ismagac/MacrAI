import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

// POST /api/telegram/link
// Generates a one-time link code for the authenticated user and returns:
//   - the code
//   - the Telegram deep link (t.me/BOT_USERNAME?start=CODE)
// The code expires in 10 minutes.

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Generate a short, URL-safe random code
  const code = randomBytes(4).toString('hex').toUpperCase() // e.g. "A3F29C1B"
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

  const { error } = await supabase
    .from('profiles')
    .update({
      telegram_link_code: code,
      telegram_link_code_expires_at: expiresAt,
    })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? 'MacrAI_bot'
  const deepLink = `https://t.me/${botUsername}?start=${code}`

  return NextResponse.json({ code, deepLink, expiresAt })
}

// GET /api/telegram/link
// Returns the current Telegram link status for the authenticated user.

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    linked: !!profile?.telegram_chat_id,
    chatId: profile?.telegram_chat_id ?? null,
  })
}
