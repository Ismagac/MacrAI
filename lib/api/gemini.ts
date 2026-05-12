import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

const PREFERRED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
];

const LIST_MODELS_TIMEOUT_MS = 2500;
const GEMINI_MODEL_TIMEOUT_MS = 7000;
const GEMINI_TOTAL_TIMEOUT_MS = 20000;

type CachedModels = {
  expiresAt: number;
  models: string[];
};

let modelCache: CachedModels | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function shouldTryNextModel(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const normalized = msg.toLowerCase();
  return (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("not supported") ||
    normalized.includes("is not found for api version") ||
    normalized.includes("permission") ||
    normalized.includes("quota") ||
    normalized.includes("429")
  );
}

async function listAvailableGenerateModels(apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(fetch(url), LIST_MODELS_TIMEOUT_MS, "Gemini listModels");
  if (!response.ok) {
    throw new Error(`listModels failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    models?: Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  const available = (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);

  return available;
}

async function getModelCandidates(): Promise<string[]> {
  const now = Date.now();
  if (modelCache && modelCache.expiresAt > now && modelCache.models.length > 0) {
    return modelCache.models;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return PREFERRED_MODELS;

  try {
    const available = await listAvailableGenerateModels(apiKey);
    const ranked = [
      ...PREFERRED_MODELS.filter((m) => available.includes(m)),
      ...available.filter((m) => !PREFERRED_MODELS.includes(m) && m.includes("flash")),
    ];

    const models = ranked.length > 0 ? ranked : PREFERRED_MODELS;
    modelCache = {
      models,
      expiresAt: now + 30 * 60 * 1000,
    };
    return models;
  } catch {
    return PREFERRED_MODELS;
  }
}

async function generateWithModelFallback(
  parts: Array<{ inlineData: { data: string; mimeType: string } } | string>
) {
  let lastError: unknown = null;
  const candidates = await getModelCandidates();

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.1,
          maxOutputTokens: 400,
        },
      });

      const response = await withTimeout(
        model.generateContent(parts),
        GEMINI_MODEL_TIMEOUT_MS,
        `Gemini model ${modelName}`
      );
      return response;
    } catch (error) {
      lastError = error;
      if (!shouldTryNextModel(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("No Gemini model available");
}

function normalizeImageInput(imageData: string | Buffer): { base64Image: string; mimeType: string } {
  if (Buffer.isBuffer(imageData)) {
    return { base64Image: imageData.toString("base64"), mimeType: "image/jpeg" };
  }

  if (typeof imageData === "string" && imageData.startsWith("data:")) {
    const [header, payload = ""] = imageData.split(",");
    const mimeMatch = header.match(/^data:([^;]+);base64$/i);
    return {
      base64Image: payload,
      mimeType: mimeMatch?.[1] || "image/jpeg",
    };
  }

  return { base64Image: imageData, mimeType: "image/jpeg" };
}

function extractJsonObject(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    const braces = candidate.match(/\{[\s\S]*\}/);
    if (braces?.[0]) return braces[0];
  }

  const direct = text.match(/\{[\s\S]*\}/);
  return direct?.[0] ?? null;
}

function coerceNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const cleaned = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (!cleaned) return undefined;
    const num = Number(cleaned[0]);
    return Number.isFinite(num) ? num : undefined;
  }

  return undefined;
}

function normalizeBasis(value: unknown): "per_100g" | "per_unit" {
  if (typeof value !== "string") return "per_100g";
  const v = value.toLowerCase();
  if (v.includes("unit") || v.includes("unidad") || v.includes("portion") || v.includes("porcion")) {
    return "per_unit";
  }
  return "per_100g";
}

function fallbackFromText(text: string): Partial<MacroDetectionResult> {
  const find = (regex: RegExp) => {
    const m = text.match(regex);
    return coerceNumber(m?.[1]);
  };

  return {
    proteins: find(/(?:proteins?|protein|prote[ií]nas?)\D{0,25}(\d+(?:[\.,]\d+)?)/i),
    fats: find(/(?:fats?|fat|grasas?(?:\s+totales?)?)\D{0,25}(\d+(?:[\.,]\d+)?)/i),
    carbs: find(/(?:carbs?|carbohydrates?|carbohidratos?|hidratos?(?:\s+de\s+carbono)?)\D{0,30}(\d+(?:[\.,]\d+)?)/i),
    calories: find(/(?:valor\s+energ[eé]tico|energy|kcal|calor[ií]as?)\D{0,30}(\d+(?:[\.,]\d+)?)(?:\s*kcal)?/i),
  };
}

function parseKeyValueMacros(text: string): Partial<MacroDetectionResult> {
  const findKV = (keys: string[]) => {
    for (const key of keys) {
      const re = new RegExp(`${key}\\s*[:=]\\s*(-?\\d+(?:[\\.,]\\d+)?)`, "i");
      const match = text.match(re);
      const value = coerceNumber(match?.[1]);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  return {
    proteins: findKV(["proteins", "protein", "proteinas", "proteina"]),
    fats: findKV(["fats", "fat", "grasas", "grasa", "grasas_totales"]),
    carbs: findKV(["carbs", "carbohydrates", "carbohidratos", "hidratos", "hidratos_de_carbono"]),
    calories: findKV(["calories", "kcal", "calorias", "calorías", "valor_energetico", "energia"]),
  };
}

function fromJsonAliases(obj: Record<string, unknown>): Partial<MacroDetectionResult> {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const val = coerceNumber(obj[key]);
      if (val !== undefined) return val;
    }
    return undefined;
  };

  return {
    proteins: pick("proteins", "protein", "proteinas", "proteina", "prot"),
    fats: pick("fats", "fat", "grasas", "grasa", "grasas_totales"),
    carbs: pick("carbs", "carbohydrates", "carbohidratos", "hidratos", "hidratos_de_carbono"),
    calories: pick("calories", "kcal", "calorias", "calorias", "calorías", "energia", "valor_energetico"),
  };
}

function hasAnyMacro(values: {
  proteins?: number;
  fats?: number;
  carbs?: number;
  calories?: number;
}): boolean {
  return (
    values.proteins !== undefined ||
    values.fats !== undefined ||
    values.carbs !== undefined ||
    values.calories !== undefined
  );
}

async function runPrompt(
  base64Image: string,
  mimeType: string,
  prompt: string
): Promise<{ parsed: Record<string, unknown>; responseText: string }> {
  const response = await withTimeout(
    generateWithModelFallback([
      {
        inlineData: {
          data: base64Image,
          mimeType,
        },
      },
      prompt,
    ]),
    GEMINI_TOTAL_TIMEOUT_MS,
    "Gemini macro detection"
  );

  const responseText = response.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonChunk = extractJsonObject(responseText);
  let parsed: Record<string, unknown> = {};

  if (jsonChunk) {
    try {
      parsed = JSON.parse(jsonChunk) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  return { parsed, responseText };
}

export interface MacroDetectionResult {
  success: boolean;
  foodName?: string;
  proteins?: number;
  fats?: number;
  carbs?: number;
  calories?: number;
  basis?: "per_100g" | "per_unit";
  unitName?: string;
  confidence?: number;
  rawResponse?: string;
  error?: string;
}

/**
 * Detecta macros de una imagen de comida usando Google Gemini Vision API
 * Funciona con fotos de etiquetas nutricionales, paquetes de alimentos, o platos
 */
export async function detectMacrosFromImage(
  imageData: string | Buffer
): Promise<MacroDetectionResult> {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return {
        success: false,
        error: "GOOGLE_API_KEY not configured",
      };
    }

    const { base64Image, mimeType } = normalizeImageInput(imageData);

    const prompt = `Extrae macros nutricionales de esta imagen.

Devuelve SOLO JSON válido con este esquema exacto:
{
  "foodName": "string",
  "basis": "per_100g" | "per_unit",
  "unitName": "string o null",
  "proteins": number | null,
  "fats": number | null,
  "carbs": number | null,
  "calories": number | null,
  "confidence": number
}

Reglas:
- Usa números en gramos para proteins/fats/carbs.
- Si dudas entre porción/unidad o 100g, indica la más probable.
- Si un valor no es legible, usa null.
- No añadas texto fuera del JSON.`;

    const first = await runPrompt(base64Image, mimeType, prompt);
    let responseText = first.responseText;
    let parsed = first.parsed;

    if (!responseText) {
      return {
        success: false,
        error: "No response from Gemini API",
      };
    }

    const extractMacros = (rawText: string, obj: Record<string, unknown>) => {
      const aliases = fromJsonAliases(obj);
      const fallback = fallbackFromText(rawText);
      const kv = parseKeyValueMacros(rawText);
      return {
        proteins: coerceNumber(obj.proteins) ?? aliases.proteins ?? kv.proteins ?? fallback.proteins,
        fats: coerceNumber(obj.fats) ?? aliases.fats ?? kv.fats ?? fallback.fats,
        carbs: coerceNumber(obj.carbs) ?? aliases.carbs ?? kv.carbs ?? fallback.carbs,
        calories: coerceNumber(obj.calories) ?? aliases.calories ?? kv.calories ?? fallback.calories,
      };
    };

    let { proteins, fats, carbs, calories } = extractMacros(responseText, parsed);

    const hasAllMacros =
      proteins !== undefined &&
      fats !== undefined &&
      carbs !== undefined &&
      calories !== undefined

    // Segundo intento más permisivo si falta cualquier macro (misma prioridad para todos)
    if (!hasAllMacros) {
      const recoveryPrompt = `Lee la etiqueta nutricional de la imagen y devuelve SOLO uno de estos formatos:
1) JSON válido con keys proteins, fats, carbs, calories
o
2) texto plano exacto con líneas:
proteins=<numero>
fats=<numero>
carbs=<numero>
calories=<numero>

Si un valor no se ve, usa null.`;

      const second = await runPrompt(base64Image, mimeType, recoveryPrompt);
      responseText = second.responseText || responseText;
      parsed = second.parsed;
      const secondMacros = extractMacros(responseText, parsed);
      proteins = proteins ?? secondMacros.proteins;
      fats = fats ?? secondMacros.fats;
      carbs = carbs ?? secondMacros.carbs;
      calories = calories ?? secondMacros.calories;
    }

    if (!hasAnyMacro({ proteins, fats, carbs, calories })) {
      return {
        success: false,
        error: "No pude extraer macros de la respuesta del modelo",
        rawResponse: responseText,
      };
    }

    return {
      success: true,
      foodName: (typeof parsed.foodName === "string" && parsed.foodName.trim()) || "Nuevo alimento",
      proteins,
      fats,
      carbs,
      calories,
      basis: normalizeBasis(parsed.basis),
      unitName: typeof parsed.unitName === "string" ? parsed.unitName : undefined,
      confidence: coerceNumber(parsed.confidence) ?? 0.75,
      rawResponse: responseText,
    };
  } catch (error) {
    console.error("Error in detectMacrosFromImage:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = msg.toLowerCase().includes("timed out");
    return {
      success: false,
      error: isTimeout
        ? "Tiempo de espera agotado analizando la imagen. Prueba con una foto más recortada o mejor iluminada."
        : msg,
    };
  }
}

/**
 * Detecta si una imagen contiene una etiqueta nutricional legible
 */
export async function isNutritionLabel(imageData: string | Buffer): Promise<{
  isLabel: boolean;
  confidence: number;
  description?: string;
}> {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return { isLabel: false, confidence: 0 };
    }

    const { base64Image, mimeType } = normalizeImageInput(imageData);

    const response = await withTimeout(
      generateWithModelFallback([
        {
          inlineData: {
            data: base64Image,
            mimeType,
          },
        },
        '¿Esta imagen contiene una etiqueta nutricional legible o datos de macros? Responde SOLO JSON: {"isLabel": boolean, "confidence": number, "description": "string"}',
      ]),
      GEMINI_TOTAL_TIMEOUT_MS,
      "Gemini nutrition-label detection"
    );

    const responseText = response.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonChunk = extractJsonObject(responseText);

    if (!jsonChunk) {
      return { isLabel: false, confidence: 0, description: "No JSON" };
    }

    try {
      const parsed = JSON.parse(jsonChunk) as {
        isLabel?: boolean;
        confidence?: number | string;
        description?: string;
      };

      return {
        isLabel: Boolean(parsed.isLabel),
        confidence: coerceNumber(parsed.confidence) ?? 0,
        description: parsed.description,
      };
    } catch {
      return { isLabel: false, confidence: 0, description: "JSON inválido" };
    }
  } catch (error) {
    console.error("Error in isNutritionLabel:", error);
    return { isLabel: false, confidence: 0 };
  }
}

// ─── Text-only generation helper ──────────────────────────────────────────────

async function generateTextWithFallback(
  prompt: string,
  config?: { temperature?: number; maxOutputTokens?: number }
): Promise<string> {
  let lastError: unknown = null;
  const candidates = await getModelCandidates();

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: config?.temperature ?? 0.1,
          topP: 0.8,
          maxOutputTokens: config?.maxOutputTokens ?? 300,
        },
      });

      const response = await withTimeout(
        model.generateContent([prompt]),
        GEMINI_MODEL_TIMEOUT_MS,
        `Gemini text ${modelName}`
      );
      return response.response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } catch (error) {
      lastError = error;
      if (!shouldTryNextModel(error)) throw error;
    }
  }

  throw lastError ?? new Error("No Gemini model available");
}

// ─── User Intent Parser ───────────────────────────────────────────────────────

export type UserIntent =
  | { type: "log_food"; query: string; qty?: number; mealType?: string }
  | { type: "check_macros" }
  | { type: "history" }
  | { type: "catalog" }
  | { type: "edit_log" }
  | { type: "chat"; reply: string };

const INTENT_SYSTEM_PROMPT = `Eres MacrAI. Clasifica el mensaje del usuario. Devuelve SOLO JSON válido.
Tipos válidos:
- "log_food": registrar un alimento. Campos: query (string), qty (número en gramos, opcional), mealType (desayuno|almuerzo|comida|merienda|cena|snack|otro, opcional)
- "check_macros": ver macros/calorías de hoy
- "history": ver historial semanal
- "catalog": ver catálogo personal de alimentos
- "edit_log": corregir, editar o borrar un registro del diario
- "chat": conversación general. Campo: reply (respuesta corta y amigable en español, máximo 2 frases)

Ejemplos:
"añade 150 tortitas de maiz" → {"type":"log_food","query":"tortitas de maiz","qty":150}
"ponme 200g de pollo en la comida" → {"type":"log_food","query":"pollo","qty":200,"mealType":"comida"}
"registra desayuno: 2 huevos" → {"type":"log_food","query":"huevos","qty":2,"mealType":"desayuno"}
"¿cuánto llevo hoy?" → {"type":"check_macros"}
"mis macros" → {"type":"check_macros"}
"historial semanal" → {"type":"history"}
"mi catálogo" → {"type":"catalog"}
"borra el yogur de esta mañana" → {"type":"edit_log"}
"hola" → {"type":"chat","reply":"¡Hola! ¿Qué quieres registrar hoy? 💪"}
"gracias" → {"type":"chat","reply":"¡De nada! Aquí estoy para lo que necesites. 😊"}

Mensaje del usuario: `;

export async function parseUserIntent(text: string): Promise<UserIntent> {
  if (!process.env.GOOGLE_API_KEY) {
    return { type: "log_food", query: text };
  }

  try {
    const raw = await withTimeout(
      generateTextWithFallback(INTENT_SYSTEM_PROMPT + JSON.stringify(text), {
        temperature: 0.1,
        maxOutputTokens: 150,
      }),
      6000,
      "Gemini intent parse"
    );

    const jsonStr = extractJsonObject(raw);
    if (jsonStr) {
      const obj = JSON.parse(jsonStr) as Record<string, unknown>;
      const type = obj.type as string;

      if (type === "check_macros") return { type: "check_macros" };
      if (type === "history") return { type: "history" };
      if (type === "catalog") return { type: "catalog" };
      if (type === "edit_log") return { type: "edit_log" };
      if (type === "chat" && typeof obj.reply === "string") {
        return { type: "chat", reply: obj.reply };
      }
      if (type === "log_food") {
        return {
          type: "log_food",
          query: typeof obj.query === "string" ? obj.query : text,
          qty: coerceNumber(obj.qty),
          mealType: typeof obj.mealType === "string" ? obj.mealType : undefined,
        };
      }
    }
  } catch {
    // fall through to default food search
  }

  return { type: "log_food", query: text };
}

// ─── Agent Conversational Reply ───────────────────────────────────────────────

export type AgentMessage = { role: "user" | "assistant"; content: string };

export async function generateAgentReply(
  userMessage: string,
  context: string,
  history: AgentMessage[] = []
): Promise<string> {
  const systemPrompt =
    `Eres MacrAI, el asistente personal de nutrición integrado en la app.\n` +
    `Eres conciso, motivador y directo. Responde siempre en español. Máximo 3 frases.\n` +
    `No expliques lo que vas a hacer, hazlo. Usa los datos del contexto cuando sean relevantes.\n` +
    (context ? `\n[Datos del usuario]\n${context}\n` : "");

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Usuario" : "MacrAI"}: ${m.content}`)
    .join("\n");

  const fullPrompt =
    systemPrompt +
    (historyText ? `\n[Conversación previa]\n${historyText}\n` : "") +
    `\nUsuario: ${userMessage}\nMacrAI:`;

  try {
    return await withTimeout(
      generateTextWithFallback(fullPrompt, { temperature: 0.7, maxOutputTokens: 350 }),
      10000,
      "Gemini agent reply"
    );
  } catch {
    return "Lo siento, no pude procesar tu mensaje ahora mismo. ¿Puedo ayudarte con algo más?";
  }
}
