'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { calcMacros, calcMacrosFromGrams } from '@/lib/utils/macros'
import type { AgentApiResponse } from '@/app/api/agent/route'
import type { MacroDetectionResult } from '@/lib/api/ai'
import type { FoodItem, MealType } from '@/types'

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
      detected?: MacroDetectionResult
    }

const MEAL_OPTIONS: MealType[] = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro']

// ─── Cards ─────────────────────────────────────────────────────────────────────

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
                {MEAL_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
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

// Macros detectados en una foto: revisar, guardar en catálogo y registrar
function DetectedFoodCard({
  detected,
  onLogged,
}: {
  detected: MacroDetectionResult
  onLogged: () => void
}) {
  const isPerUnit = detected.basis === 'per_unit'
  const [nombre, setNombre] = useState(detected.foodName ?? 'Nuevo alimento')
  const [qty, setQty] = useState(isPerUnit ? '1' : '100')
  const [mealType, setMealType] = useState<MealType>('otro')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<null | 'catalog' | 'logged'>(null)
  const [error, setError] = useState<string | null>(null)

  const food: FoodItem = {
    id: 'detected',
    nombre,
    kcal_100g: isPerUnit ? 0 : detected.calories ?? 0,
    proteinas_100g: isPerUnit ? 0 : detected.proteins ?? 0,
    grasas_100g: isPerUnit ? 0 : detected.fats ?? 0,
    carbohidratos_100g: isPerUnit ? 0 : detected.carbs ?? 0,
    fibra_100g: 0,
    macros_basis: detected.basis ?? 'per_100g',
    unit_name: detected.unitName,
    kcal_per_unit: isPerUnit ? detected.calories ?? 0 : undefined,
    proteinas_per_unit: isPerUnit ? detected.proteins ?? 0 : undefined,
    grasas_per_unit: isPerUnit ? detected.fats ?? 0 : undefined,
    carbohidratos_per_unit: isPerUnit ? detected.carbs ?? 0 : undefined,
    source: 'usuario',
  }

  const qtyNum = Number(qty) || 0
  const preview = qtyNum > 0 ? calcMacros(food, qtyNum, isPerUnit ? qtyNum : undefined) : null

  async function save(alsoLog: boolean) {
    if (!nombre.trim()) return
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { error: catalogError } = await supabase.from('alimentos_usuario').insert({
        user_id: user.id,
        nombre: nombre.trim(),
        macros_basis: food.macros_basis,
        unit_name: food.unit_name ?? null,
        kcal_100g: food.kcal_100g,
        proteinas_100g: food.proteinas_100g,
        grasas_100g: food.grasas_100g,
        carbohidratos_100g: food.carbohidratos_100g,
        fibra_100g: 0,
        kcal_per_unit: food.kcal_per_unit ?? null,
        proteinas_per_unit: food.proteinas_per_unit ?? null,
        grasas_per_unit: food.grasas_per_unit ?? null,
        carbohidratos_per_unit: food.carbohidratos_per_unit ?? null,
      })

      if (catalogError) {
        setError('No pude guardar en tu catálogo.')
        return
      }

      if (!alsoLog || !preview) {
        setSaved('catalog')
        return
      }

      const today = new Date().toISOString().split('T')[0]
      const { error: logError } = await supabase.from('consumos').insert({
        user_id: user.id,
        alimento_source: 'usuario',
        nombre_alimento: nombre.trim(),
        cantidad_gr: qtyNum,
        cantidad_unit: isPerUnit ? qtyNum : undefined,
        macros_basis: food.macros_basis,
        kcal: preview.kcal,
        proteinas: preview.proteinas,
        grasas: preview.grasas,
        carbohidratos: preview.carbohidratos,
        fibra: preview.fibra,
        fecha: today,
        tipo_comida: mealType,
        numero_comida: 1,
      })

      if (logError) {
        setError('Guardado en catálogo, pero no pude registrarlo en el diario.')
        setSaved('catalog')
        return
      }

      setSaved('logged')
      onLogged()
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div className="mt-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400 font-medium">
        {saved === 'logged' ? '✅ Guardado en tu catálogo y registrado en el diario.' : '✅ Guardado en tu catálogo.'}
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-2">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
        <div>🔥 <span className="text-foreground font-medium">{detected.calories ?? '—'} kcal</span></div>
        <div>🥩 P: <span className="text-foreground font-medium">{detected.proteins ?? '—'}g</span></div>
        <div>🍞 C: <span className="text-foreground font-medium">{detected.carbs ?? '—'}g</span></div>
        <div>🧈 G: <span className="text-foreground font-medium">{detected.fats ?? '—'}g</span></div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {isPerUnit ? `Por ${detected.unitName ?? 'unidad'}` : 'Por 100g'}
        {typeof detected.confidence === 'number' ? ` · confianza ${Math.round(detected.confidence * 100)}%` : ''}
      </p>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">{isPerUnit ? 'Unidades' : 'Gramos'}</label>
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
            {MEAL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground">
          {preview.kcal} kcal · P:{preview.proteinas}g · C:{preview.carbohidratos}g · G:{preview.grasas}g
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => save(true)}
          disabled={saving || !nombre.trim() || qtyNum <= 0}
          className="flex-1 rounded-lg bg-primary text-primary-foreground py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Guardando…' : '✅ Guardar y registrar'}
        </button>
        <button
          onClick={() => save(false)}
          disabled={saving || !nombre.trim()}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          Solo catálogo
        </button>
      </div>
    </div>
  )
}

// ─── Main chat core ────────────────────────────────────────────────────────────

export function ChatCore({ fullPage = false }: { fullPage?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '¡Hola! Soy MacrAI, tu asistente de nutrición. Dime qué has comido ("añade 150g de pollo a la comida"), mándame una foto de la etiqueta 📷 o díctamelo con el micro 🎙️. ¿Qué te apunto?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const router = useRouter()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  function pushAssistant(msg: Omit<Extract<ChatMessage, { role: 'assistant' }>, 'id' | 'role'>) {
    setMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: 'assistant', ...msg }])
  }

  async function sendText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', content: trimmed }])
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
        body: JSON.stringify({ message: trimmed, history }),
      })

      if (!res.ok) throw new Error('API error')

      const data = (await res.json()) as AgentApiResponse
      pushAssistant({ content: data.reply, action: data.action, data: data.data })
    } catch {
      pushAssistant({ content: 'Lo siento, ha habido un error. Inténtalo de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  // ── Foto ──
  async function handlePhotoSelected(file: File) {
    if (loading) return
    if (file.size > 6 * 1024 * 1024) {
      pushAssistant({ content: 'La foto es muy grande (máx. 6MB). Prueba con otra más ligera.' })
      return
    }

    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', content: '📷 Foto enviada' }])
    setLoading(true)

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

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
            'No pude leer los macros de la foto. Prueba con una imagen más cercana de la etiqueta, o díctame los macros.',
        })
        return
      }

      pushAssistant({
        content: `He detectado esto en la foto. Revisa los datos y confirma:`,
        detected,
      })
    } catch {
      pushAssistant({ content: 'No pude procesar la foto. Inténtalo de nuevo.' })
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Audio ──
  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1000) return

        setLoading(true)
        try {
          const form = new FormData()
          form.append('audio', blob, 'audio.webm')
          const res = await fetch('/api/transcribe', { method: 'POST', body: form })
          const data = (await res.json()) as { text?: string; error?: string }

          if (!res.ok || !data.text?.trim()) {
            pushAssistant({ content: 'No pude transcribir el audio. Inténtalo de nuevo o escríbeme.' })
            return
          }

          setLoading(false)
          await sendText(data.text)
        } catch {
          pushAssistant({ content: 'Error transcribiendo el audio. Inténtalo de nuevo.' })
        } finally {
          setLoading(false)
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      pushAssistant({ content: 'No tengo acceso al micrófono. Revisa los permisos del navegador.' })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText(input)
    }
  }

  function handleLogged() {
    router.refresh()
  }

  return (
    <div className={`flex flex-col ${fullPage ? 'h-full' : 'flex-1 min-h-0'}`}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`${fullPage ? 'max-w-[75%] md:max-w-[60%]' : 'max-w-[85%]'} ${msg.role === 'user' ? 'order-1' : ''}`}>
              <div
                className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted text-foreground rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>

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
              {msg.role === 'assistant' && msg.action === 'need_details' && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  📷 Enviar foto de la etiqueta
                </button>
              )}
              {msg.role === 'assistant' && msg.detected && (
                <DetectedFoodCard detected={msg.detected} onLogged={handleLogged} />
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
        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handlePhotoSelected(file)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || recording}
            className="rounded-xl border border-border px-2.5 py-2 text-base hover:bg-muted transition-colors disabled:opacity-50"
            aria-label="Enviar foto"
            title="Enviar foto de etiqueta o plato"
          >
            📎
          </button>
          <button
            onClick={toggleRecording}
            disabled={loading}
            className={`rounded-xl px-2.5 py-2 text-base transition-colors disabled:opacity-50 ${
              recording
                ? 'bg-red-500 text-white animate-pulse'
                : 'border border-border hover:bg-muted'
            }`}
            aria-label={recording ? 'Parar grabación' : 'Grabar audio'}
            title={recording ? 'Parar y enviar' : 'Dictar por voz'}
          >
            🎙️
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={recording ? 'Grabando… pulsa 🎙️ para enviar' : 'Escríbeme algo…'}
            disabled={loading || recording}
            className="flex-1 min-w-0 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={() => sendText(input)}
            disabled={loading || recording || !input.trim()}
            className="rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            ↑
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Ej: "añade 150g de pollo en la comida" · foto de etiqueta 📎 · dictado 🎙️
        </p>
      </div>
    </div>
  )
}
