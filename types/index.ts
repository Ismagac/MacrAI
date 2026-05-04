// ─── Enums ───────────────────────────────────────────────────────────────────

export type FoodSource = 'usuario' | 'global' | 'openfoodfacts' | 'manual'
export type MealType =
  | 'desayuno'
  | 'almuerzo'
  | 'comida'
  | 'merienda'
  | 'cena'
  | 'snack'
  | 'otro'
export type GroupingMode = 'tipo_comida' | 'numero_comida' | 'hora'
export type ActivityLevel =
  | 'sedentario'
  | 'ligero'
  | 'moderado'
  | 'activo'
  | 'muy_activo'
export type Periodo = 'diario' | 'semanal' | 'mensual'
export type Sexo = 'hombre' | 'mujer' | 'otro'

// ─── Food ─────────────────────────────────────────────────────────────────────

export interface FoodItem {
  id: string
  nombre: string
  kcal_100g: number
  proteinas_100g: number
  grasas_100g: number
  carbohidratos_100g: number
  fibra_100g?: number
  categoria?: string
  source: FoodSource
}

export interface FoodItemUsuario extends FoodItem {
  user_id: string
  created_at: string
  updated_at: string
}

// ─── Consumo ──────────────────────────────────────────────────────────────────

export interface Consumo {
  id: string
  user_id: string
  alimento_ref_id?: string
  alimento_source: FoodSource
  nombre_alimento: string
  cantidad_gr: number
  kcal: number
  proteinas: number
  grasas: number
  carbohidratos: number
  fibra?: number
  fecha: string            // ISO date string YYYY-MM-DD
  hora_insercion: string   // ISO timestamp
  tipo_comida: MealType
  numero_comida: number
  created_at: string
}

export interface ConsumoFormData {
  alimento: FoodItem
  cantidad_gr: number
  tipo_comida: MealType
  numero_comida: number
  fecha: string
}

// ─── Macros summary ───────────────────────────────────────────────────────────

export interface MacrosSummary {
  kcal: number
  proteinas: number
  grasas: number
  carbohidratos: number
  fibra: number
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  username?: string
  avatar_url?: string
  peso_kg?: number
  altura_cm?: number
  edad?: number
  sexo?: Sexo
  nivel_actividad?: ActivityLevel
  telegram_chat_id?: number | null
  updated_at?: string
}

// ─── Objetivo ─────────────────────────────────────────────────────────────────

export interface Objetivo {
  id: string
  user_id: string
  periodo: Periodo
  fecha_inicio: string
  fecha_fin?: string
  kcal_objetivo: number
  proteinas_objetivo: number
  grasas_objetivo: number
  carbohidratos_objetivo: number
  activo: boolean
  created_at: string
}

export interface ObjetivoFormData {
  periodo: Periodo
  kcal_objetivo: number
  proteinas_objetivo: number
  grasas_objetivo: number
  carbohidratos_objetivo: number
}

// ─── TDEE ─────────────────────────────────────────────────────────────────────

export interface TDEEResult {
  bmr: number
  tdee: number
  factorActividad: number
}

// ─── Historial ────────────────────────────────────────────────────────────────

export interface DayStats {
  fecha: string
  kcal: number
  proteinas: number
  grasas: number
  carbohidratos: number
  fibra: number
  num_consumos: number
}

// ─── Open Food Facts ──────────────────────────────────────────────────────────

export interface OFFProduct {
  id: string
  product_name: string
  nutriments: {
    'energy-kcal_100g'?: number
    proteins_100g?: number
    fat_100g?: number
    carbohydrates_100g?: number
    fiber_100g?: number
  }
  categories?: string
}

export interface OFFSearchResponse {
  products: OFFProduct[]
  count: number
  page: number
}
