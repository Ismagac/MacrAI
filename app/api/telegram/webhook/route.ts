import { NextRequest, NextResponse } from 'next/server'
import { handleUpdate } from '@/lib/bot/telegram'
import type TelegramBot from 'node-telegram-bot-api'

// This endpoint receives incoming updates from Telegram via webhook.
// In serverless environments, we must await processing so callback queries
// are actually handled before the function exits.

export async function POST(request: NextRequest) {
  // Optional: verify the webhook secret to prevent unauthorized calls
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Bot not configured' }, { status: 500 })
  }

  // Telegram sends updates as JSON in the request body
  let update: TelegramBot.Update
  try {
    update = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await handleUpdate(update)
  } catch (err) {
    console.error('[TelegramWebhook] Error handling update:', err)
  }

  return NextResponse.json({ ok: true })
}

// Telegram sends a HEAD/GET check when registering the webhook
export async function GET() {
  return NextResponse.json({ ok: true, service: 'MacrAI Telegram Bot' })
}
