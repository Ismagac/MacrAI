import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/telegram/unlink
// Removes the telegram_chat_id from the authenticated user's profile.

export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('profiles')
    .update({ telegram_chat_id: null, telegram_link_code: null, telegram_link_code_expires_at: null })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to unlink' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
