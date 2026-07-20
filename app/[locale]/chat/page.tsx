'use client'

import { AppLayout } from '@/components/layout/AppLayout'
import { ChatCore } from '@/components/chat/ChatCore'
import { LogoMark } from '@/components/brand/Logo'

export default function ChatPage() {
  return (
    <AppLayout>
      <div className="mx-auto flex h-[calc(100vh-11rem)] md:h-[calc(100vh-9rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <LogoMark size={28} />
          <div>
            <p className="font-head text-sm font-semibold leading-none">MacrAI</p>
            <p className="text-xs text-muted-foreground">Tu asistente de nutrición</p>
          </div>
        </div>
        <ChatCore fullPage />
      </div>
    </AppLayout>
  )
}
