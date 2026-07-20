'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcMacros, calcMacrosFromGrams } from '@/lib/utils/macros'
import type { AgentApiResponse } from '@/app/api/agent/route'
import type { MacroDetectionResult } from '@/lib/api/ai'
import type { FoodItem, MealType } from '@/types'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export type FoodOption = {
  id: string
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  grasas_100g: number
  carbohidratos_100g: number
  fibra_100g?: number
  source: string
}

const MEAL_OPTIONS: MealType[] = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack', 'otro']

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary'

function Done({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm font-medium">
      <Check className="h-4 w-4 text-brand" />
      {children}
    </div>
  )
}

function MacroGrid({
  kcal,
  p,
  c,
  g,
  showKcal = true,
}: {
  kcal?: number | null
  p?: number | null
  c?: number | null
  g?: number | null
  showKcal?: boolean
}) {
  const cells: Array<[string, number | null | undefined, string]> = [
    ...(showKcal ? ([['kcal', kcal, '']] as Array<[string, number | null | undefined, string]>) : []),
    ['Prot', p, 'macro-protein'],
    ['Carb', c, 'macro-carbs'],
    ['Gras', g, 'macro-fat'],
  ]
  return (
    <div className={cn('grid gap-2', showKcal ? 'grid-cols-4' : 'grid-cols-3')}>
      {cells.map(([label, value, cls]) => (
        <div key={label}>
          <p className="label-caps">{label}</p>
          <p className={cn('metric text-lg', cls)}>{value ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}

export function MacroCard({ macros }: { macros: NonNullable<AgentApiResponse['data']>['macros'] }) {
  if (!macros) return null
  const goal = macros.objetivo?.kcal_objetivo
  const pct = goal && goal > 0 ? Math.min(Math.round((macros.kcal / goal) * 100), 100) : null

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <span className="label-caps">Hoy</span>
        <span className="metric text-lg">
          {macros.kcal}
          {goal ? <span className="text-sm font-normal text-muted-foreground"> / {goal}</span> : null} kcal
        </span>
      </div>
      {pct !== null && (
        <div className="macro-track h-1.5 w-full rounded-full">
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
      <MacroGrid p={macros.proteinas} c={macros.carbohidratos} g={macros.grasas} showKcal={false} />
    </div>
  )
}

export function HistoryCard({ days }: { days: NonNullable<AgentApiResponse['data']>['days'] }) {
  if (!days || days.length === 0) return null
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3">
      {days.map((d) => {
        const label = new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-ES', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
        return (
          <div
            key={d.fecha}
            className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0"
          >
            <span className="capitalize text-muted-foreground">{label}</span>
            <span className="metric text-sm">{d.kcal} kcal</span>
          </div>
        )
      })}
    </div>
  )
}

export function CatalogCard({ catalog }: { catalog: NonNullable<AgentApiResponse['data']>['catalog'] }) {
  if (!catalog || catalog.length === 0) return null
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3">
      {catalog.map((f) => (
        <div
          key={f.id}
          className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0"
        >
          <span className="truncate font-medium">{f.nombre}</span>
          <span className="metric shrink-0 text-sm text-muted-foreground">{f.kcal_100g} kcal</span>
        </div>
      ))}
    </div>
  )
}

export function FoodOptionsCard({
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
  const [selected, setSelected] = useState<FoodOption | null>(foods.length === 1 ? foods[0] : null)
  const [qty, setQty] = useState(String(defaultQty ?? 100))
  const [mealType, setMealType] = useState<MealType>((defaultMealType as MealType) ?? 'otro')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const preview = selected
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
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !preview) return

      const { error } = await supabase.from('consumos').insert({
        user_id: user.id,
        alimento_source: selected.source,
        nombre_alimento: selected.nombre,
        cantidad_gr: Number(qty),
        macros_basis: 'per_100g',
        kcal: preview.kcal,
        proteinas: preview.proteinas,
        grasas: preview.grasas,
        carbohidratos: preview.carbohidratos,
        fibra: preview.fibra,
        fecha: new Date().toISOString().split('T')[0],
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

  if (saved) return <Done>Registrado</Done>

  return (
    <div className="mt-2 space-y-2.5 rounded-xl border border-border bg-card p-3 text-sm">
      {!selected ? (
        <>
          <p className="label-caps">Elige el alimento</p>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {foods.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelected(f)}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="block truncate font-medium">{f.nombre}</span>
                <span className="text-xs text-muted-foreground">{f.kcal_100g} kcal/100g</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{selected.nombre}</span>
            {foods.length > 1 && (
              <button
                onClick={() => setSelected(null)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                cambiar
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <label className="flex-1">
              <span className="label-caps">Gramos</span>
              <input
                type="number"
                min="1"
                max="5000"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className={cn(fieldClass, 'mt-0.5')}
              />
            </label>
            <label className="flex-1">
              <span className="label-caps">Comida</span>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as MealType)}
                className={cn(fieldClass, 'mt-0.5 capitalize')}
              >
                {MEAL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {preview && Number(qty) > 0 && (
            <p className="text-xs text-muted-foreground">
              {preview.kcal} kcal · P:{preview.proteinas} · C:{preview.carbohidratos} · G:{preview.grasas}
            </p>
          )}

          <button
            onClick={handleConfirm}
            disabled={saving || !qty}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </>
      )}
    </div>
  )
}

export function DetectedFoodCard({
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
      const {
        data: { user },
      } = await supabase.auth.getUser()
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
        setError('No pude guardarlo en tu catálogo.')
        return
      }

      if (!alsoLog || !preview) {
        setSaved('catalog')
        return
      }

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
        fecha: new Date().toISOString().split('T')[0],
        tipo_comida: mealType,
        numero_comida: 1,
      })

      if (logError) {
        setError('Guardado en el catálogo, pero no pude registrarlo en el diario.')
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
    return <Done>{saved === 'logged' ? 'Guardado y registrado' : 'Guardado en tu catálogo'}</Done>
  }

  return (
    <div className="mt-2 space-y-2.5 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className={cn(fieldClass, 'font-semibold')}
        />
        {typeof detected.confidence === 'number' && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">
            {Math.round(detected.confidence * 100)}%
          </span>
        )}
      </div>

      <MacroGrid kcal={detected.calories} p={detected.proteins} c={detected.carbs} g={detected.fats} />
      <p className="text-[11px] text-muted-foreground">
        {isPerUnit ? `Por ${detected.unitName ?? 'unidad'}` : 'Por 100 g'}
      </p>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="label-caps">{isPerUnit ? 'Unidades' : 'Gramos'}</span>
          <input
            type="number"
            min="1"
            max="5000"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={cn(fieldClass, 'mt-0.5')}
          />
        </label>
        <label className="flex-1">
          <span className="label-caps">Comida</span>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            className={cn(fieldClass, 'mt-0.5 capitalize')}
          >
            {MEAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground">
          {preview.kcal} kcal · P:{preview.proteinas} · C:{preview.carbohidratos} · G:{preview.grasas}
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => save(true)}
          disabled={saving || !nombre.trim() || qtyNum <= 0}
          className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar y registrar'}
        </button>
        <button
          onClick={() => save(false)}
          disabled={saving || !nombre.trim()}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          Solo catálogo
        </button>
      </div>
    </div>
  )
}
