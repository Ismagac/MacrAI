'use client'

import { useState, useEffect, useRef } from 'react'
import type { FoodItem } from '@/types'
import { createClient } from '@/lib/supabase/client'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useFoodSearch(query: string) {
  const [results, setResults] = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(false)
  const debouncedQuery = useDebounce(query.trim(), 500)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([])
      return
    }

    // Abort previous search
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setLoading(true)

    const supabase = createClient()

    Promise.all([
      // Source 1: user private catalogue
      supabase
        .from('alimentos_usuario')
        .select('*')
        .ilike('nombre', `%${debouncedQuery}%`)
        .limit(5)
        .then(({ data }) =>
          (data ?? []).map(
            (d): FoodItem => ({
              id: d.id,
              nombre: d.nombre,
              kcal_100g: d.kcal_100g,
              proteinas_100g: d.proteinas_100g,
              grasas_100g: d.grasas_100g,
              carbohidratos_100g: d.carbohidratos_100g,
              fibra_100g: d.fibra_100g,
              macros_basis: d.macros_basis,
              unit_name: d.unit_name,
              kcal_per_unit: d.kcal_per_unit,
              proteinas_per_unit: d.proteinas_per_unit,
              grasas_per_unit: d.grasas_per_unit,
              carbohidratos_per_unit: d.carbohidratos_per_unit,
              source: 'usuario',
            })
          )
        ),

      // Source 2: global Supabase DB with pg_trgm similarity
      supabase
        .from('alimentos_global')
        .select('*')
        .ilike('nombre', `%${debouncedQuery}%`)
        .limit(5)
        .then(({ data }) =>
          (data ?? []).map(
            (d): FoodItem => ({
              id: d.id,
              nombre: d.nombre,
              kcal_100g: d.kcal_100g,
              proteinas_100g: d.proteinas_100g,
              grasas_100g: d.grasas_100g,
              carbohidratos_100g: d.carbohidratos_100g,
              fibra_100g: d.fibra_100g,
              categoria: d.categoria,
              macros_basis: d.macros_basis,
              unit_name: d.unit_name,
              kcal_per_unit: d.kcal_per_unit,
              proteinas_per_unit: d.proteinas_per_unit,
              grasas_per_unit: d.grasas_per_unit,
              carbohidratos_per_unit: d.carbohidratos_per_unit,
              source: 'global',
            })
          )
        ),

      // Source 3: Open Food Facts via server proxy (avoids CORS + caches)
      fetch(`/api/food-search?q=${encodeURIComponent(debouncedQuery)}`, {
        signal: abort.signal,
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []) as Promise<FoodItem[]>,
    ])
      .then(([userFoods, globalFoods, offFoods]) => {
        if (abort.signal.aborted) return

        // Priority: user > global > OFF, deduplicate by similar names
        const seen = new Set<string>()
        const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
        const merged: FoodItem[] = []

        for (const f of [...userFoods, ...globalFoods, ...offFoods]) {
          const key = normalise(f.nombre)
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(f)
          }
        }

        setResults(merged.slice(0, 12))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })

    return () => abort.abort()
  }, [debouncedQuery])

  return { results, loading }
}
