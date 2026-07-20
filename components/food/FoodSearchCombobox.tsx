'use client'

import { useState } from 'react'
import { useFoodSearch } from '@/hooks/useFoodSearch'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Search } from 'lucide-react'
import type { FoodItem } from '@/types'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'

interface Props {
  onSelect: (food: FoodItem) => void
  onSuggestedQuantity?: (quantity: number | null) => void
}

const SOURCE_LABELS: Record<string, string> = {
  usuario: 'Mío',
  global: 'BD',
  openfoodfacts: 'OFF',
  manual: 'Manual',
}

const SOURCE_COLORS: Record<string, string> = {
  usuario: 'bg-blue-500/10 text-blue-600 border-blue-200',
  global: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  openfoodfacts: 'bg-orange-500/10 text-orange-600 border-orange-200',
  manual: 'bg-purple-500/10 text-purple-600 border-purple-200',
}

export function FoodSearchCombobox({ onSelect, onSuggestedQuantity }: Props) {
  const [query, setQuery] = useState('')
  const qtyMatch = query.trim().match(/^(\d+(?:[\.,]\d+)?)\s+(.+)$/)
  const proposedQty = qtyMatch ? Number(qtyMatch[1].replace(',', '.')) : null
  const effectiveQuery = qtyMatch ? qtyMatch[2].trim() : query
  const { results, loading } = useFoodSearch(effectiveQuery)
  const t = useTranslations('log')

  function handleSelect(food: FoodItem) {
    onSelect(food)
    onSuggestedQuantity?.(
      proposedQty && Number.isFinite(proposedQty) && proposedQty > 0 ? proposedQty : null
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noResults')}</p>
      )}

      {!loading && results.length > 0 && (
        <ul className="rounded-lg border divide-y overflow-hidden">
          {results.map((food) => (
            <li key={food.id}>
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors"
                onClick={() => handleSelect(food)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{food.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {food.macros_basis === 'per_unit'
                        ? `${food.kcal_per_unit ?? 0} kcal · ${food.proteinas_per_unit ?? 0}g P · ${food.carbohidratos_per_unit ?? 0}g C · ${food.grasas_per_unit ?? 0}g G / ${food.unit_name || 'unidad'}`
                        : `${food.kcal_100g} kcal · ${food.proteinas_100g}g P · ${food.carbohidratos_100g}g C · ${food.grasas_100g}g G / 100g`}
                    </p>
                    {proposedQty && Number.isFinite(proposedQty) && proposedQty > 0 && (
                      <p className="text-xs text-brand">
                        {food.macros_basis === 'per_unit'
                          ? `Para ${proposedQty} ${food.unit_name || 'unidades'}: ${Math.round((food.kcal_per_unit ?? 0) * proposedQty)} kcal · ${Math.round((food.proteinas_per_unit ?? 0) * proposedQty * 10) / 10}g P · ${Math.round((food.carbohidratos_per_unit ?? 0) * proposedQty * 10) / 10}g C · ${Math.round((food.grasas_per_unit ?? 0) * proposedQty * 10) / 10}g G`
                          : `Para ${proposedQty}g: ${Math.round((food.kcal_100g * proposedQty) / 100)} kcal · ${Math.round((food.proteinas_100g * proposedQty) / 100 * 10) / 10}g P · ${Math.round((food.carbohidratos_100g * proposedQty) / 100 * 10) / 10}g C · ${Math.round((food.grasas_100g * proposedQty) / 100 * 10) / 10}g G`}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                      SOURCE_COLORS[food.source]
                    )}
                  >
                    {SOURCE_LABELS[food.source]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
