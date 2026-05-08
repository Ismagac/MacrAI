'use client'

import { useState } from 'react'
import type { Consumo, GroupingMode } from '@/types'
import { groupConsumos } from '@/lib/utils/grouping'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, ChevronDown, ChevronUp, Pencil, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { format } from 'date-fns'

interface Props {
  consumos: Consumo[]
  groupingMode: GroupingMode
  onDelete: (id: string) => void
  onUpdateCantidad: (id: string, cantidadGr: number) => Promise<void>
}

export function DailyLogTable({ consumos, groupingMode, onDelete, onUpdateCantidad }: Props) {
  const t = useTranslations('log')
  const tc = useTranslations('common')
  const tDash = useTranslations('dashboard')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCantidad, setEditCantidad] = useState<string>('')

  const groups = groupConsumos(consumos, groupingMode)

  if (consumos.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {tDash('noData')}
      </div>
    )
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function saveCantidad(consumo: Consumo) {
    const next = Number(editCantidad.replace(',', '.'))
    if (!Number.isFinite(next) || next <= 0) return
    await onUpdateCantidad(consumo.id, next)
    setEditingId(null)
    setEditCantidad('')
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="rounded-2xl border border-border/75 bg-card/75 backdrop-blur-sm overflow-hidden shadow-[0_16px_36px_-26px_hsl(var(--foreground)/0.35)]">
            {/* Group header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3.5 bg-muted/35 hover:bg-muted/60 transition-colors text-left"
              onClick={() => toggleGroup(group.key)}
            >
              <div>
                <span className="font-semibold text-sm tracking-tight">{group.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {group.items.length} alimentos · {Math.round(group.totalKcal)} kcal
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="hidden sm:block">
                  P:{Math.round(group.totalProteinas)}g C:{Math.round(group.totalCarbohidratos)}g G:{Math.round(group.totalGrasas)}g
                </span>
                {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </div>
            </button>

            {/* Group items */}
            {!isCollapsed && (
              <div className="divide-y">
                {group.items.map((consumo) => {
                  const qtyLabel =
                    consumo.macros_basis === 'per_unit'
                      ? `${consumo.cantidad_unit ?? consumo.cantidad_gr}u`
                      : `${consumo.cantidad_gr}g`

                  return (
                  <div
                    key={consumo.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{consumo.nombre_alimento}</p>
                      {editingId === consumo.id ? (
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            className="h-7 w-24 text-xs"
                            value={editCantidad}
                            onChange={(e) => setEditCantidad(e.target.value)}
                            type="number"
                            step="0.5"
                            min={0.1}
                          />
                          <span className="text-xs text-muted-foreground">{consumo.macros_basis === 'per_unit' ? 'u' : 'g'}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => saveCantidad(consumo)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingId(null)
                              setEditCantidad('')
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {qtyLabel} · {Math.round(consumo.kcal)} kcal · P:{Math.round(consumo.proteinas)}g · C:{Math.round(consumo.carbohidratos)}g · G:{Math.round(consumo.grasas)}g
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => {
                        setEditingId(consumo.id)
                        setEditCantidad(String(consumo.cantidad_gr))
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(consumo.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
