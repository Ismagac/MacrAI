'use client'

import { AppLayout } from '@/components/layout/AppLayout'
import { ChatCore } from '@/components/chat/ChatCore'

export default function ChatPage() {
  return (
    <AppLayout>
      <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-3xl flex-col rounded-2xl border border-border bg-background shadow-sm">
        <div className="flex items-center gap-2 rounded-t-2xl bg-primary/10 px-4 py-3 border-b border-border">
          <span className="text-lg">🤖</span>
          <div>
            <p className="font-semibold text-sm leading-none">MacrAI</p>
            <p className="text-xs text-muted-foreground">Tu asistente de nutrición</p>
          </div>
        </div>
        <ChatCore fullPage />
      </div>
    </AppLayout>
  )
}
