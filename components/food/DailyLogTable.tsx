'use client'

import { useState } from 'react'
import type { Consumo, GroupingMode } from '@/types'
import { groupConsumos } from '@/lib/utils/grouping'
import { Button } from '@/components/ui/button'
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { format } from 'date-fns'

interface Props {
  consumos: Consumo[]
  groupingMode: GroupingMode
  onDelete: (id: string) => void
}

export function DailyLogTable({ consumos, groupingMode, onDelete }: Props) {
  const t = useTranslations('log')
  const tc = useTranslations('common')
  const tDash = useTranslations('dashboard')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="rounded-xl border overflow-hidden">
            {/* Group header */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
              onClick={() => toggleGroup(group.key)}
            >
              <div>
                <span className="font-semibold text-sm">{group.label}</span>
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
                {group.items.map((consumo) => (
                  <div
                    key={consumo.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{consumo.nombre_alimento}</p>
                      <p className="text-xs text-muted-foreground">
                        {consumo.cantidad_gr}g · {Math.round(consumo.kcal)} kcal · P:{Math.round(consumo.proteinas)}g · C:{Math.round(consumo.carbohidratos)}g · G:{Math.round(consumo.grasas)}g
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(consumo.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
