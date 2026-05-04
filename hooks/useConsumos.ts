'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Consumo, ConsumoFormData } from '@/types'
import { calcMacrosFromGrams } from '@/lib/utils/macros'
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

      const macros = calcMacrosFromGrams(formData.alimento, formData.cantidad_gr)

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

  return { consumos, loading, error, addConsumo, deleteConsumo, refetch: fetchConsumos }
}
