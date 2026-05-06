interface OcrSpaceParsedResult {
  ParsedText: string
}

interface OcrSpaceResponse {
  IsErroredOnProcessing: boolean
  ErrorMessage?: string[]
  ParsedResults?: OcrSpaceParsedResult[]
}

export interface DetectedFoodMacros {
  kcal_100g: number
  proteinas_100g: number
  carbohidratos_100g: number
  grasas_100g: number
  fibra_100g: number
}

export interface DetectedFoodFromImage {
  suggestedName: string
  macros: DetectedFoodMacros
  rawText: string
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 10) / 10
}

function parseNumberLike(value: string): number | null {
  const normalized = value.replace(',', '.').trim()
  const num = parseFloat(normalized)
  return Number.isFinite(num) ? num : null
}

function firstMatch(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re)
    if (!m?.[1]) continue
    const parsed = parseNumberLike(m[1])
    if (parsed !== null) return parsed
  }
  return null
}

function parseMacrosFromText(text: string): DetectedFoodMacros {
  const source = text.toLowerCase()

  const kcal = firstMatch(source, [
    /(?:energia|energía|energy|kcal)[^\d]{0,20}(\d+[\.,]?\d*)\s*k?cal/i,
    /(\d+[\.,]?\d*)\s*k?cal/i,
  ])

  const proteinas = firstMatch(source, [
    /(?:prote[ií]nas?|protein)[^\d]{0,20}(\d+[\.,]?\d*)\s*g/i,
  ])

  const carbohidratos = firstMatch(source, [
    /(?:carbohidratos?|hidratos?(?:\s+de\s+carbono)?|carbs?|carbohydrates?)[^\d]{0,20}(\d+[\.,]?\d*)\s*g/i,
  ])

  const grasas = firstMatch(source, [
    /(?:grasas?|fat|fats)[^\d]{0,20}(\d+[\.,]?\d*)\s*g/i,
  ])

  const fibra = firstMatch(source, [
    /(?:fibra|fiber)[^\d]{0,20}(\d+[\.,]?\d*)\s*g/i,
  ])

  return {
    kcal_100g: clampNonNegative(kcal ?? 0),
    proteinas_100g: clampNonNegative(proteinas ?? 0),
    carbohidratos_100g: clampNonNegative(carbohidratos ?? 0),
    grasas_100g: clampNonNegative(grasas ?? 0),
    fibra_100g: clampNonNegative(fibra ?? 0),
  }
}

function extractSuggestedName(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .filter((line) => !/^informaci[oó]n\s+nutricional/i.test(line))
    .filter((line) => !/^nutrition\s+facts/i.test(line))
    .filter((line) => !/^valor(es)?\s+nutricional/i.test(line))

  const candidate = lines[0] ?? 'Nuevo alimento'
  return candidate.slice(0, 60)
}

export async function detectFoodFromImageUrl(imageUrl: string): Promise<DetectedFoodFromImage | null> {
  const apiKey = process.env.OCR_SPACE_API_KEY || 'helloworld'

  const form = new FormData()
  form.append('apikey', apiKey)
  form.append('url', imageUrl)
  form.append('language', 'spa')
  form.append('isOverlayRequired', 'false')
  form.append('detectOrientation', 'true')
  form.append('scale', 'true')

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: form,
    cache: 'no-store',
  })

  if (!res.ok) return null

  const data = (await res.json()) as OcrSpaceResponse
  if (data.IsErroredOnProcessing) return null

  const rawText = (data.ParsedResults ?? [])
    .map((r) => r.ParsedText)
    .join('\n')
    .trim()

  if (!rawText) return null

  return {
    suggestedName: extractSuggestedName(rawText),
    macros: parseMacrosFromText(rawText),
    rawText,
  }
}
