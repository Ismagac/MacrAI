'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { calcMacrosFromGrams } from '@/lib/utils/macros'
import type { AgentApiResponse } from '@/app/api/agent/route'
import type { MealType } from '@/types'

// ─── Types ─────────────────────────────────────────────────────────────────────

type AgentHistory = { role: 'user' | 'assistant'; content: string }

type FoodOption = {
  id: string
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  grasas_100g: number
  carbohidratos_100g: number
  fibra_100g?: number
  source: string
}

type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string
      role: 'assistant'
      content: string
      action?: AgentApiResponse['action']
      data?: AgentApiResponse['data']
    }

// ─── Sub-components ────────────────────────────────────────────────────────────

function MacroCard({ macros }: { macros: NonNullable<AgentApiResponse['data']>['macros'] }) {
  if (!macros) return null
  const obj = macros.objetivo
  const pct = (val: number, goal?: number | null) =>
    goal && goal > 0 ? Math.min(Math.round((val / goal) * 100), 100) : null

  const kcalPct = pct(macros.kcal, obj?.kcal_objetivo)

  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">🔥 Calorías hoy</span>
        <span className="font-bold text-primary">
          {macros.kcal} {obj?.kcal_objetivo ? `/ ${obj.kcal_objetivo}` : ''} kcal
        </span>
      </div>
      {kcalPct !== null && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${kcalPct}%` }}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground pt-1">
        <div>🥩 P: <span className="text-foreground font-medium">{macros.proteinas}g</span></div>
        <div>🍞 C: <span className="text-foreground font-medium">{macros.carbohidratos}g</span></div>
        <div>🧈 G: <span className="text-foreground font-medium">{macros.grasas}g</span></div>
      </div>
    </div>
  )
}

function HistoryCard({ days }: { days: NonNullable<AgentApiResponse['data']>['days'] }) {
  if (!days || days.length === 0) return null
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-xs space-y-1">
      {days.map((d) => {
        const date = new Date(d.fecha + 'T12:00:00')
        const label = date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
        return (
          <div key={d.fecha} className="flex justify-between items-center py-0.5 border-b border-border/40 last:border-0">
            <span className="text-muted-foreground capitalize">{label}</span>
            <span className="font-semibold text-foreground">{d.kcal} kcal</span>
          </div>
        )
      })}
    </div>
  )
}

function CatalogCard({ catalog }: { catalog: NonNullable<AgentApiResponse['data']>['catalog'] }) {
  if (!catalog || catalog.length === 0) return null
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-xs space-y-1">
      {catalog.map((f) => (
        <div key={f.id} className="flex justify-between items-center py-0.5 border-b border-border/40 last:border-0">
          <span className="font-medium text-foreground truncate max-w-[120px]">{f.nombre}</span>
          <span className="text-muted-foreground shrink-0">{f.kcal_100g} kcal</span>
        </div>
      ))}
    </div>
  )
}

function FoodOptionsCard({
  foods,
  defaultQty,
  defaultMealType,
  onLogged,
}: {
  foods: FoodOption[]
  defaultQty?: number
  defaultMealType?: string
  onLogged: () => void
}) {
  const [selected, setSelected] = useState<FoodOption | null>(null)
  const [qty, setQty] = useState(String(defaultQty ?? 100))
  const [mealType, setMealType] = useState<MealType>((defaultMealType as MealType) ?? 'otro')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const macroPreview = selected
    ? calcMacrosFromGrams(
        { ...selected, source: selected.source as never, macros_basis: 'per_100g' },
        Number(qty) || 0
      )
    : null

  async function handleConfirm() {
    if (!selected || !qty) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const m = calcMacrosFromGrams(
        { ...selected, source: selected.source as never, macros_basis: 'per_100g' },
        Number(qty)
      )
      const today = new Date().toISOString().split('T')[0]

      const { error } = await supabase.from('consumos').insert({
        user_id: user.id,
        alimento_source: selected.source,
        nombre_alimento: selected.nombre,
        cantidad_gr: Number(qty),
        macros_basis: 'per_100g',
        kcal: m.kcal,
        proteinas: m.proteinas,
        grasas: m.grasas,
        carbohidratos: m.carbohidratos,
        fibra: m.fibra,
        fecha: today,
        tipo_comida: mealType,
        numero_comida: 1,
      })

      if (!error) {
        setSaved(true)
        onLogged()
      }
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="mt-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400 font-medium">
        ✅ ¡Registrado correctamente!
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-2">
      {!selected ? (
        <>
          <p className="text-xs text-muted-foreground font-medium">Selecciona el alimento:</p>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {foods.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelected(f)}
                className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors border border-border/50"
              >
                <span className="font-medium block truncate">{f.nombre}</span>
                <span className="text-xs text-muted-foreground">{f.kcal_100g} kcal/100g</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="font-semibold truncate max-w-[160px]">{selected.nombre}</span>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground hover:text-foreground ml-1 shrink-0"
            >
              cambiar
            </button>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Gramos</label>
              <input
                type="number"
                min="1"
                max="5000"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Comida</label>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as MealType)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="desayuno">Desayuno</option>
                <option value="almuerzo">Almuerzo</option>
                <option value="comida">Comida</option>
                <option value="merienda">Merienda</option>
                <option value="cena">Cena</option>
                <option value="snack">Snack</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          {macroPreview && Number(qty) > 0 && (
            <p className="text-xs text-muted-foreground">
              {macroPreview.kcal} kcal · P:{macroPreview.proteinas}g · C:{macroPreview.carbohidratos}g · G:{macroPreview.grasas}g
            </p>
          )}

          <button
            onClick={handleConfirm}
            disabled={saving || !qty}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando…' : '✅ Confirmar registro'}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Main chat component ───────────────────────────────────────────────────────

export function MacrAIChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '¡Hola! Soy MacrAI, tu asistente de nutrición. Puedes pedirme cosas como "añade 150g de tortitas de maiz al desayuno", "¿cuánto llevo hoy?" o "muéstrame el historial". ¿En qué te ayudo?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (open) {
      scrollToBottom()
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, scrollToBottom])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history: AgentHistory[] = messages
        .filter((m) => m.id !== 'welcome')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      if (!res.ok) throw new Error('API error')

      const data = (await res.json()) as AgentApiResponse

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.reply,
          action: data.action,
          data: data.data,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Lo siento, ha habido un error. Inténtalo de nuevo.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleLogged() {
    router.refresh()
  }

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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-1' : ''}`}>
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-muted text-foreground rounded-tl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {/* Action cards for assistant messages */}
                  {msg.role === 'assistant' && msg.action === 'macros_data' && (
                    <MacroCard macros={msg.data?.macros} />
                  )}
                  {msg.role === 'assistant' && msg.action === 'history_data' && (
                    <HistoryCard days={msg.data?.days} />
                  )}
                  {msg.role === 'assistant' && msg.action === 'catalog_data' && (
                    <CatalogCard catalog={msg.data?.catalog} />
                  )}
                  {msg.role === 'assistant' && msg.action === 'food_options' && msg.data?.foods && (
                    <FoodOptionsCard
                      foods={msg.data.foods as FoodOption[]}
                      defaultQty={msg.data.qty}
                      defaultMealType={msg.data.mealType}
                      onLogged={handleLogged}
                    />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-muted-foreground flex items-center gap-1">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse delay-75">●</span>
                  <span className="animate-pulse delay-150">●</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escríbeme algo…"
                disabled={loading}
                className="flex-1 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                ↑
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Ej: "añade 150g de pollo en la comida"
            </p>
          </div>
        </div>
      )}
    </>
  )
}
