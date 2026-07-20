'use client'

import type { Consumo } from '@/types'
import { Trash2 } from 'lucide-react'

// Tabla densa del día. En móvil colapsa a filas de dos líneas; en escritorio
// muestra las columnas completas con las cifras alineadas.

export function TodayTable({
  consumos,
  onDelete,
}: {
  consumos: Consumo[]
  onDelete: (id: string) => void
}) {
  if (consumos.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nada registrado todavía. Pídeselo a MacrAI y aparecerá aquí.
      </p>
    )
  }

  const qtyLabel = (c: Consumo) =>
    c.macros_basis === 'per_unit' ? `${c.cantidad_unit ?? c.cantidad_gr} u` : `${c.cantidad_gr} g`

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-border">
            <th className="label-caps py-2 text-left font-semibold">Alimento</th>
            <th className="label-caps py-2 text-right font-semibold">Cantidad</th>
            <th className="label-caps py-2 text-left font-semibold pl-4">Comida</th>
            <th className="label-caps py-2 text-right font-semibold">kcal</th>
            <th className="label-caps py-2 text-right font-semibold">P</th>
            <th className="label-caps py-2 text-right font-semibold">C</th>
            <th className="label-caps py-2 text-right font-semibold">G</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {consumos.map((c) => (
            <tr key={c.id} className="group border-b border-border last:border-0">
              <td className="py-2.5 pr-2">
                <p className="font-medium leading-tight">{c.nombre_alimento}</p>
                <p className="text-xs text-muted-foreground md:hidden">
                  {qtyLabel(c)} · {c.tipo_comida} · P:{Math.round(c.proteinas)} C:
                  {Math.round(c.carbohidratos)} G:{Math.round(c.grasas)}
                </p>
              </td>
              <td className="hidden py-2.5 text-right text-muted-foreground md:table-cell">
                {qtyLabel(c)}
              </td>
              <td className="hidden py-2.5 pl-4 md:table-cell">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {c.tipo_comida}
                </span>
              </td>
              <td className="metric py-2.5 text-right">{Math.round(c.kcal)}</td>
              <td className="hidden py-2.5 text-right text-muted-foreground md:table-cell">
                {Math.round(c.proteinas)}
              </td>
              <td className="hidden py-2.5 text-right text-muted-foreground md:table-cell">
                {Math.round(c.carbohidratos)}
              </td>
              <td className="hidden py-2.5 text-right text-muted-foreground md:table-cell">
                {Math.round(c.grasas)}
              </td>
              <td className="py-2.5 pl-2 text-right">
                <button
                  onClick={() => onDelete(c.id)}
                  aria-label={`Borrar ${c.nombre_alimento}`}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
