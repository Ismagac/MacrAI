'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DayStats } from '@/types'
import { format, eachDayOfInterval, parseISO } from 'date-fns'

export function useHistorial() {
  const [stats, setStats] = useState<DayStats[]>([])
  const [loading, setLoading] = useState(false)

  const fetchRange = useCallback(async (from: string, to: string) => {
    setLoading(true)
    const supabase = createClient()

    const { data, error } = await supabase
      .from('consumos')
      .select('fecha, kcal, proteinas, grasas, carbohidratos, fibra')
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha', { ascending: true })

    if (error || !data) {
      setLoading(false)
      return
    }

    // Group by date
    const byDate = new Map<string, DayStats>()

    // Pre-fill all days in range with zeros
    const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) })
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd')
      byDate.set(key, {
        fecha: key,
        kcal: 0,
        proteinas: 0,
        grasas: 0,
        carbohidratos: 0,
        fibra: 0,
        num_consumos: 0,
      })
    }

    for (const row of data) {
      const existing = byDate.get(row.fecha)
      if (existing) {
        existing.kcal += row.kcal
        existing.proteinas += row.proteinas
        existing.grasas += row.grasas
        existing.carbohidratos += row.carbohidratos
        existing.fibra += row.fibra ?? 0
        existing.num_consumos += 1
      }
    }

    setStats(Array.from(byDate.values()))
    setLoading(false)
  }, [])

  return { stats, loading, fetchRange }
}
