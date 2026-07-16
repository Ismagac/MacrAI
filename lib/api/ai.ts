import { llmChat, type UserLlmKey } from "./llm";

const VISION_TIMEOUT_MS = 20000;

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

async function runVisionPrompt(
  base64Image: string,
  mimeType: string,
  prompt: string,
  userKey?: UserLlmKey | null
): Promise<{ parsed: Record<string, unknown>; responseText: string }> {
  const responseText = await llmChat({
    task: "vision",
    timeoutMs: VISION_TIMEOUT_MS,
    temperature: 0.1,
    maxTokens: 400,
    userKey,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

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
 * Detecta macros de una imagen de comida usando la cadena de proveedores LLM
 * Funciona con fotos de etiquetas nutricionales, paquetes de alimentos, o platos
 */
export async function detectMacrosFromImage(
  imageData: string | Buffer,
  userKey?: UserLlmKey | null
): Promise<MacroDetectionResult> {
  try {
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

    const first = await runVisionPrompt(base64Image, mimeType, prompt, userKey);
    let responseText = first.responseText;
    let parsed = first.parsed;

    if (!responseText) {
      return {
        success: false,
        error: "No response from LLM providers",
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

      const second = await runVisionPrompt(base64Image, mimeType, recoveryPrompt, userKey);
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
    const isTimeout = msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("abort");
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
export async function isNutritionLabel(
  imageData: string | Buffer,
  userKey?: UserLlmKey | null
): Promise<{
  isLabel: boolean;
  confidence: number;
  description?: string;
}> {
  try {
    const { base64Image, mimeType } = normalizeImageInput(imageData);

    const { parsed, responseText } = await runVisionPrompt(
      base64Image,
      mimeType,
      '¿Esta imagen contiene una etiqueta nutricional legible o datos de macros? Responde SOLO JSON: {"isLabel": boolean, "confidence": number, "description": "string"}',
      userKey
    );

    if (!responseText) {
      return { isLabel: false, confidence: 0, description: "No response" };
    }

    if (Object.keys(parsed).length === 0) {
      return { isLabel: false, confidence: 0, description: "No JSON" };
    }

    return {
      isLabel: Boolean(parsed.isLabel),
      confidence: coerceNumber(parsed.confidence) ?? 0,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
    };
  } catch (error) {
    console.error("Error in isNutritionLabel:", error);
    return { isLabel: false, confidence: 0 };
  }
}

// ─── User Intent Parser ───────────────────────────────────────────────────────

export type UserIntent =
  | { type: "log_food"; query: string; qty?: number; mealType?: string }
  | {
      type: "add_catalog_food";
      nombre: string;
      macros_basis: "per_100g" | "per_unit";
      unit_name?: string;
      kcal: number;
      proteinas: number;
      carbohidratos: number;
      grasas: number;
      fibra?: number;
    }
  | { type: "check_macros" }
  | { type: "history" }
  | { type: "catalog" }
  | { type: "edit_log" }
  | { type: "chat"; reply: string };

const INTENT_SYSTEM_PROMPT = `Eres MacrAI. Clasifica el mensaje del usuario. Devuelve SOLO JSON válido.
Tipos válidos:
- "log_food": registrar un alimento. Campos: query (string), qty (número en gramos, opcional), mealType (desayuno|almuerzo|comida|merienda|cena|snack|otro, opcional)
- "add_catalog_food": añadir alimento al catálogo con macros completos. Campos: nombre, macros_basis("per_100g"|"per_unit"), unit_name(opcional), kcal, proteinas, carbohidratos, grasas, fibra(opcional)
- "check_macros": ver macros/calorías de hoy
- "history": ver historial semanal
- "catalog": ver catálogo personal de alimentos
- "edit_log": corregir, editar o borrar un registro del diario
- "chat": conversación general. Campo: reply (respuesta corta y amigable en español, máximo 2 frases)

Ejemplos:
"añade 150 tortitas de maiz" → {"type":"log_food","query":"tortitas de maiz","qty":150}
"ponme 200g de pollo en la comida" → {"type":"log_food","query":"pollo","qty":200,"mealType":"comida"}
"registra desayuno: 2 huevos" → {"type":"log_food","query":"huevos","qty":2,"mealType":"desayuno"}
"añade un café frío light hacendado, por cada 250ml 160 kcal, 3.3 grasas, 23.3 hidratos, 8 proteínas" → {"type":"add_catalog_food","nombre":"Café frío light hacendado","macros_basis":"per_unit","unit_name":"250ml","kcal":160,"proteinas":8,"carbohidratos":23.3,"grasas":3.3}
"guarda pechuga de pollo al catálogo: por 100g 120 kcal, 2 grasas, 0 hidratos, 24 proteínas" → {"type":"add_catalog_food","nombre":"Pechuga de pollo","macros_basis":"per_100g","kcal":120,"proteinas":24,"carbohidratos":0,"grasas":2}
"¿cuánto llevo hoy?" → {"type":"check_macros"}
"mis macros" → {"type":"check_macros"}
"historial semanal" → {"type":"history"}
"mi catálogo" → {"type":"catalog"}
"borra el yogur de esta mañana" → {"type":"edit_log"}
"hola" → {"type":"chat","reply":"¡Hola! ¿Qué quieres registrar hoy? 💪"}
"gracias" → {"type":"chat","reply":"¡De nada! Aquí estoy para lo que necesites. 😊"}

Mensaje del usuario: `;

function heuristicParseCatalogFood(text: string): UserIntent | null {
  const lower = text.toLowerCase();
  const hasKcal = /\b\d+(?:[\.,]\d+)?\s*kcal\b/i.test(text);
  const hasProtein = /\bprote[ií]n(?:a|as)\b/i.test(lower);
  const hasCarbs = /\b(carbohidratos?|hidratos?)\b/i.test(lower);
  const hasFat = /\bgrasas?\b/i.test(lower);

  if (!(hasKcal && hasProtein && hasCarbs && hasFat)) return null;

  const kcal = coerceNumber(text.match(/(\d+(?:[\.,]\d+)?)\s*kcal/i)?.[1]);
  const proteinas = coerceNumber(
    text.match(/(\d+(?:[\.,]\d+)?)\s*(?:g\s*de\s*)?prote[ií]n(?:a|as)/i)?.[1]
  );
  const carbohidratos = coerceNumber(
    text.match(/(\d+(?:[\.,]\d+)?)\s*(?:g\s*de\s*)?(?:carbohidratos?|hidratos?)/i)?.[1]
  );
  const grasas = coerceNumber(text.match(/(\d+(?:[\.,]\d+)?)\s*(?:g\s*de\s*)?grasas?/i)?.[1]);

  if (
    kcal === undefined ||
    proteinas === undefined ||
    carbohidratos === undefined ||
    grasas === undefined
  ) {
    return null;
  }

  const nameMatch =
    text.match(/(?:a(?:ñ|n)ade|agrega|guarda|crea)\s+(?:un|una|el|la)?\s*([^,\.]+?)(?:\s*,|\s+por\s+cada|\s+por\s+100)/i) ||
    text.match(/^([^,\.]+?)\s+(?:por\s+cada|por\s+100)/i);
  const nombre = (nameMatch?.[1] || "Nuevo alimento").trim();

  const perUnitMatch = text.match(/por\s+cada\s*(\d+\s*(?:ml|g|gr|gramos?|unidad(?:es)?))/i);
  const explicitPerUnit = /por\s+unidad|unidad(?:es)?/i.test(lower);

  return {
    type: "add_catalog_food",
    nombre: nombre.length >= 2 ? nombre : "Nuevo alimento",
    macros_basis: perUnitMatch || explicitPerUnit ? "per_unit" : "per_100g",
    unit_name: perUnitMatch?.[1]?.trim(),
    kcal,
    proteinas,
    carbohidratos,
    grasas,
  };
}

export async function parseUserIntent(text: string, userKey?: UserLlmKey | null): Promise<UserIntent> {
  try {
    const raw = await llmChat({
      task: "text",
      temperature: 0.1,
      maxTokens: 150,
      timeoutMs: 6000,
      userKey,
      messages: [{ role: "user", content: INTENT_SYSTEM_PROMPT + JSON.stringify(text) }],
    });

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

      if (type === "add_catalog_food") {
        const kcal = coerceNumber(obj.kcal);
        const proteinas = coerceNumber(obj.proteinas);
        const carbohidratos = coerceNumber(obj.carbohidratos);
        const grasas = coerceNumber(obj.grasas);
        const fibra = coerceNumber(obj.fibra);

        if (
          typeof obj.nombre === "string" &&
          kcal !== undefined &&
          proteinas !== undefined &&
          carbohidratos !== undefined &&
          grasas !== undefined
        ) {
          return {
            type: "add_catalog_food",
            nombre: obj.nombre,
            macros_basis: normalizeBasis(obj.macros_basis),
            unit_name: typeof obj.unit_name === "string" ? obj.unit_name : undefined,
            kcal,
            proteinas,
            carbohidratos,
            grasas,
            fibra,
          };
        }
      }
    }
  } catch {
    // fall through to default food search
  }

  const heuristic = heuristicParseCatalogFood(text);
  if (heuristic) return heuristic;

  return { type: "log_food", query: text };
}

// ─── Agent Conversational Reply ───────────────────────────────────────────────

export type AgentMessage = { role: "user" | "assistant"; content: string };

export async function generateAgentReply(
  userMessage: string,
  context: string,
  history: AgentMessage[] = [],
  userKey?: UserLlmKey | null
): Promise<string> {
  const systemPrompt =
    `Eres MacrAI, el asistente personal de nutrición integrado en la app.\n` +
    `Eres conciso, motivador y directo. Responde siempre en español. Máximo 3 frases.\n` +
    `No expliques lo que vas a hacer, hazlo. Usa los datos del contexto cuando sean relevantes.\n` +
    (context ? `\n[Datos del usuario]\n${context}\n` : "");

  try {
    return await llmChat({
      task: "text",
      temperature: 0.7,
      maxTokens: 350,
      timeoutMs: 10000,
      userKey,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-6).map((m) => ({ role: m.role, content: m.content } as const)),
        { role: "user", content: userMessage },
      ],
    });
  } catch {
    return "Lo siento, no pude procesar tu mensaje ahora mismo. ¿Puedo ayudarte con algo más?";
  }
}
