'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Mic, AudioLines, ArrowUp, Square, X, Paperclip } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { cn } from '@/lib/utils/cn'
import { useSpeech } from './useSpeech'
import {
  MacroCard,
  HistoryCard,
  CatalogCard,
  FoodOptionsCard,
  DetectedFoodCard,
  type FoodOption,
} from './ChatCards'
import type { AgentApiResponse } from '@/app/api/agent/route'
import type { MacroDetectionResult } from '@/lib/api/ai'

type AgentHistory = { role: 'user' | 'assistant'; content: string }

type ChatMessage =
  | { id: string; role: 'user'; content: string; image?: string }
  | {
      id: string
      role: 'assistant'
      content: string
      action?: AgentApiResponse['action']
      data?: AgentApiResponse['data']
      detected?: MacroDetectionResult
    }

const SUGGESTIONS = [
  '150 g de pollo a la comida',
  '¿Cuánto llevo hoy?',
  'Añade un yogur griego a mi catálogo',
  'Borra el café de esta mañana',
]

const MAX_IMAGE_BYTES = 6 * 1024 * 1024

export function ChatCore({ fullPage = false }: { fullPage?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const isEmpty = messages.length === 0

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  function pushAssistant(msg: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id' | 'role'>) {
    setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: 'assistant', ...msg }])
  }

  // Envía al agente y devuelve la respuesta, para que el modo voz pueda leerla.
  const askAgent = useCallback(
    async (text: string): Promise<string> => {
      const trimmed = text.trim()
      if (!trimmed) return ''

      setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', content: trimmed }])
      setInput('')
      setLoading(true)

      try {
        const history: AgentHistory[] = messages
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content }))

        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, history }),
        })
        if (!res.ok) throw new Error('API error')

        const data = (await res.json()) as AgentApiResponse
        pushAssistant({ content: data.reply, action: data.action, data: data.data })

        // Las mutaciones desde el chat deben verse al instante en el resto de la app.
        if (data.action === 'catalog_changed' || data.action === 'log_changed') router.refresh()

        return data.reply
      } catch {
        const fallback = 'Ha habido un error. Inténtalo de nuevo.'
        pushAssistant({ content: fallback })
        return fallback
      } finally {
        setLoading(false)
      }
    },
    [messages, router]
  )

  const speechRef = useRef<ReturnType<typeof useSpeech> | null>(null)

  const speech = useSpeech({
    // Dictado: el texto aterriza en el input y lo envía el usuario, no el micro.
    onDictation: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text))
      textareaRef.current?.focus()
    },
    onConversationTurn: async (text) => {
      const reply = await askAgent(text)
      if (reply) speechRef.current?.speak(reply)
    },
  })

  useEffect(() => {
    speechRef.current = speech
  })

  const conversationMode = speech.mode === 'conversation'
  const dictating = speech.mode === 'dictation'
  const busy = loading || dictating

  async function handleImage(file: File) {
    if (loading) return
    if (file.size > MAX_IMAGE_BYTES) {
      pushAssistant({ content: 'La foto pesa demasiado (máx. 6 MB). Prueba con otra.' })
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-u`, role: 'user', content: 'Foto de la etiqueta', image: dataUrl },
    ])
    setLoading(true)

    try {
      const res = await fetch('/api/agent/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const detected = (await res.json()) as MacroDetectionResult

      if (!res.ok || !detected.success) {
        pushAssistant({
          content:
            detected.error ??
            'No he podido leer los macros. Prueba con la etiqueta más cerca, o dímelos tú.',
        })
        return
      }

      pushAssistant({ content: 'Esto es lo que he leído. Revísalo y confirma:', detected })
    } catch {
      pushAssistant({ content: 'No he podido procesar la foto.' })
    } finally {
      setLoading(false)
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void askAgent(input)
    }
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  // ─── Modo conversación a pantalla completa ───────────────────────────────────
  if (conversationMode) {
    const scale = 1 + Math.min(speech.level * 9, 1.1)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-primary/20 transition-transform duration-100"
            style={{ transform: `scale(${scale})` }}
          />
          <span className="absolute inset-4 rounded-full bg-primary/30" />
          <LogoMark size={56} className="relative" />
        </div>

        <div className="text-center">
          <p className="font-head text-lg font-semibold">
            {speech.speaking ? 'MacrAI está hablando' : loading ? 'Pensando…' : 'Te escucho'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Habla con normalidad. Cuando pares, te respondo.
          </p>
        </div>

        <button
          onClick={speech.cancel}
          className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-accent"
        >
          <X className="h-4 w-4" />
          Salir del modo voz
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversación */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn('mx-auto w-full', fullPage ? 'max-w-3xl px-4 py-6' : 'px-3 py-4')}>
          {isEmpty ? (
            <div className="flex flex-col items-center py-10 text-center">
              <LogoMark size={44} />
              <h2 className="font-head mt-4 text-xl font-semibold">¿Qué has comido?</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Díctamelo, escríbelo o mándame una foto de la etiqueta. Yo lo apunto.
              </p>
              <div className={cn('mt-6 flex w-full max-w-md flex-col gap-2', !fullPage && 'mt-4')}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void askAgent(s)}
                    className="rounded-xl border border-border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                      {msg.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={msg.image}
                          alt="Foto enviada"
                          className="mb-2 max-h-48 rounded-lg object-cover"
                        />
                      )}
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="flex gap-3">
                    <LogoMark size={26} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      {msg.action === 'macros_data' && <MacroCard macros={msg.data?.macros} />}
                      {msg.action === 'history_data' && <HistoryCard days={msg.data?.days} />}
                      {msg.action === 'catalog_data' && <CatalogCard catalog={msg.data?.catalog} />}
                      {msg.action === 'food_options' && msg.data?.foods && (
                        <FoodOptionsCard
                          foods={msg.data.foods as FoodOption[]}
                          defaultQty={msg.data.qty}
                          defaultMealType={msg.data.mealType}
                          onLogged={() => router.refresh()}
                        />
                      )}
                      {msg.action === 'need_details' && (
                        <button
                          onClick={() => cameraInputRef.current?.click()}
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          Enviar foto de la etiqueta
                        </button>
                      )}
                      {msg.detected && (
                        <DetectedFoodCard detected={msg.detected} onLogged={() => router.refresh()} />
                      )}
                    </div>
                  </div>
                )
              )}

              {loading && (
                <div className="flex gap-3">
                  <LogoMark size={26} className="mt-0.5 shrink-0" />
                  <div className="flex items-center gap-1 pt-1.5">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background">
        <div className={cn('mx-auto w-full', fullPage ? 'max-w-3xl px-4 py-3' : 'px-2 py-2')}>
          {speech.error && <p className="mb-2 text-xs text-destructive">{speech.error}</p>}

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImage(f)
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImage(f)
            }}
          />

          <div
            className={cn(
              'flex items-end gap-1 rounded-2xl border bg-card px-2 py-1.5 transition-colors',
              dictating ? 'border-destructive' : 'border-border focus-within:border-primary'
            )}
          >
            <button
              onClick={() => cameraInputRef.current?.click()}
              disabled={busy}
              title="Hacer foto"
              aria-label="Hacer foto"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Camera className="h-5 w-5" />
            </button>
            {fullPage && (
              <button
                onClick={() => galleryInputRef.current?.click()}
                disabled={busy}
                title="Subir de galería"
                aria-label="Subir de galería"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Paperclip className="h-5 w-5" />
              </button>
            )}

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                autoGrow(e.target)
              }}
              onKeyDown={handleKeyDown}
              placeholder={dictating ? 'Escuchando…' : 'Escribe o dicta lo que has comido'}
              disabled={loading}
              className="max-h-40 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />

            <button
              onClick={() => (dictating ? speech.stop() : void speech.start('dictation'))}
              disabled={loading}
              title={dictating ? 'Parar y transcribir' : 'Dictar'}
              aria-label={dictating ? 'Parar y transcribir' : 'Dictar'}
              className={cn(
                'rounded-lg p-2 transition-colors disabled:opacity-40',
                dictating
                  ? 'bg-destructive text-destructive-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {dictating ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            <button
              onClick={() => void speech.start('conversation')}
              disabled={busy}
              title="Modo conversación"
              aria-label="Modo conversación"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <AudioLines className="h-5 w-5" />
            </button>

            <button
              onClick={() => void askAgent(input)}
              disabled={busy || !input.trim()}
              title="Enviar"
              aria-label="Enviar"
              className="rounded-lg bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>

          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            {dictating
              ? 'Pulsa el cuadrado para transcribir. Podrás revisarlo antes de enviar.'
              : 'MacrAI puede equivocarse. Revisa los macros antes de confirmar.'}
          </p>
        </div>
      </div>
    </div>
  )
}
