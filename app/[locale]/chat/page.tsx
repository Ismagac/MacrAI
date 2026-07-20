'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { ChatCore } from '@/components/chat/ChatCore'
import { LogoMark } from '@/components/brand/Logo'

// El chat no usa AppLayout: ocupa la altura completa sin cabecera ni padding,
// para que la conversación se lea como en cualquier asistente serio.
export default function ChatPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3 md:hidden">
          <LogoMark size={26} />
          <span className="font-head text-base font-semibold">MacrAI</span>
        </header>

        <ChatCore fullPage />

        <div className="h-16 shrink-0 md:hidden" />
        <MobileNav />
      </div>
    </div>
  )
}
