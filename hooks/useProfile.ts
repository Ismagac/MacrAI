'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Objetivo } from '@/types'

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [objetivoDiario, setObjetivoDiario] = useState<Objetivo | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: profileData }, { data: objData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('objetivos')
        .select('*')
        .eq('user_id', user.id)
        .eq('periodo', 'diario')
        .eq('activo', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ])

    if (profileData) setProfile(profileData as Profile)
    if (objData) setObjetivoDiario(objData as Objetivo)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const updateProfile = useCallback(async (updates: Partial<Profile>) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single()

    if (!error && data) setProfile(data as Profile)
    return error
  }, [])

  return { profile, objetivoDiario, loading, updateProfile, refetch: fetchProfile }
}
