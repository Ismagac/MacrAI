'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Consumo, ConsumoFormData } from '@/types'
import { calcMacros } from '@/lib/utils/macros'
import { format } from 'date-fns'

export function useConsumos(fecha: string) {
  const [consumos, setConsumos] = useState<Consumo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConsumos = useCallback(async () => {
    const supabase = createClient()
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('consumos')
      .select('*')
      .eq('fecha', fecha)
      .order('hora_insercion', { ascending: true })

    if (err) setError(err.message)
    else setConsumos(data as Consumo[])
    setLoading(false)
  }, [fecha])

  useEffect(() => {
    fetchConsumos()
  }, [fetchConsumos])

  const addConsumo = useCallback(
    async (formData: ConsumoFormData): Promise<Consumo | null> => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return null

      const macros = calcMacros(
        formData.alimento,
        formData.cantidad_gr,
        formData.cantidad_unit
      )

      const payload = {
        user_id: user.id,
        alimento_ref_id:
          formData.alimento.source !== 'openfoodfacts' &&
          formData.alimento.source !== 'manual'
            ? formData.alimento.id
            : null,
        alimento_source: formData.alimento.source,
        nombre_alimento: formData.alimento.nombre,
        cantidad_gr: formData.cantidad_gr,
        macros_basis: formData.macros_basis || formData.alimento.macros_basis || 'per_100g',
        cantidad_unit: formData.cantidad_unit ?? null,
        kcal: macros.kcal,
        proteinas: macros.proteinas,
        grasas: macros.grasas,
        carbohidratos: macros.carbohidratos,
        fibra: macros.fibra,
        fecha: formData.fecha,
        tipo_comida: formData.tipo_comida,
        numero_comida: formData.numero_comida,
      }

      const { data, error: err } = await supabase
        .from('consumos')
        .insert(payload)
        .select()
        .single()

      if (err) {
        setError(err.message)
        return null
      }

      const newConsumo = data as Consumo
      setConsumos((prev) => [...prev, newConsumo])
      return newConsumo
    },
    []
  )

  const deleteConsumo = useCallback(async (id: string) => {
    const supabase = createClient()
    const { error: err } = await supabase.from('consumos').delete().eq('id', id)
    if (!err) setConsumos((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const updateConsumoCantidad = useCallback(async (id: string, nuevaCantidadGr: number) => {
    if (!Number.isFinite(nuevaCantidadGr) || nuevaCantidadGr <= 0) return null

    const prev = consumos.find((c) => c.id === id)
    if (!prev || prev.cantidad_gr <= 0) return null

    const factor = nuevaCantidadGr / prev.cantidad_gr
    const payload = {
      cantidad_gr: nuevaCantidadGr,
      cantidad_unit: prev.macros_basis === 'per_unit' ? Math.round(nuevaCantidadGr * 100) / 100 : prev.cantidad_unit,
      kcal: Math.round(prev.kcal * factor * 100) / 100,
      proteinas: Math.round(prev.proteinas * factor * 100) / 100,
      grasas: Math.round(prev.grasas * factor * 100) / 100,
      carbohidratos: Math.round(prev.carbohidratos * factor * 100) / 100,
      fibra: Math.round((prev.fibra ?? 0) * factor * 100) / 100,
    }

    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('consumos')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (err || !data) {
      if (err) setError(err.message)
      return null
    }

    const updated = data as Consumo
    setConsumos((prevConsumos) =>
      prevConsumos.map((c) => (c.id === id ? updated : c))
    )
    return updated
  }, [consumos])

  return {
    consumos,
    loading,
    error,
    addConsumo,
    deleteConsumo,
    updateConsumoCantidad,
    refetch: fetchConsumos,
  }
}
