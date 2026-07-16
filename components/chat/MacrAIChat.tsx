'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { ChatCore } from './ChatCore'

export function MacrAIChat() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // La página /chat ya es el chat a pantalla completa
  if (pathname?.split('/')[2] === 'chat') return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-24 right-4 md:bottom-6 z-50 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg text-sm font-semibold transition-all duration-200 ${
          open
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground hover:bg-primary/90'
        }`}
        aria-label="Abrir chat MacrAI"
      >
        <span className="text-base">🤖</span>
        <span className="hidden sm:inline">MacrAI</span>
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-40 right-4 md:bottom-20 z-50 w-[340px] max-w-[calc(100vw-2rem)] flex flex-col rounded-2xl border border-border bg-background shadow-2xl"
          style={{ height: '520px', maxHeight: 'calc(100vh - 180px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl bg-primary/10 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <p className="font-semibold text-sm leading-none">MacrAI</p>
                <p className="text-xs text-muted-foreground">Asistente personal</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
              aria-label="Cerrar chat"
            >
              ×
            </button>
          </div>

          <ChatCore />
        </div>
      )}
    </>
  )
}
