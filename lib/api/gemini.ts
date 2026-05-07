import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const GEMINI_MODEL_CANDIDATES = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash-latest"];
const GEMINI_MODEL_TIMEOUT_MS = 7000;
const GEMINI_TOTAL_TIMEOUT_MS = 20000;

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
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("not supported") ||
    msg.includes("is not found for API version")
  );
}

async function generateWithModelFallback(parts: Array<{ inlineData: { data: string; mimeType: string } } | string>) {
  let lastError: unknown = null;

  for (const modelName of GEMINI_MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
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

    // Convertir imagen a base64 si es Buffer
    let base64Image: string;
    if (Buffer.isBuffer(imageData)) {
      base64Image = imageData.toString("base64");
    } else if (typeof imageData === "string" && imageData.startsWith("data:")) {
      // Si ya es data URI, extraer la parte base64
      base64Image = imageData.split(",")[1];
    } else {
      base64Image = imageData;
    }

    const prompt = `Analiza esta imagen de comida/etiqueta nutricional y extrae la siguiente información:

1. Nombre del alimento/producto
2. Si los datos nutricionales son por 100g o por unidad (especifica cuál unidad: 1 helado, 1 galleta, 1 porción, etc.)
3. Proteínas (en gramos)
4. Grasas (en gramos)
5. Carbohidratos (en gramos)
6. Calorías (opcional)

Responde en este formato JSON exacto (sin explicaciones adicionales):
{
  "foodName": "nombre del alimento",
  "basis": "per_100g" o "per_unit",
  "unitName": "especificar si es per_unit (ej: 1 helado, 1 galleta, 1 porción)",
  "proteins": número,
  "fats": número,
  "carbs": número,
  "calories": número o null,
  "confidence": número entre 0 y 1
}

Si no puedes determinar algún valor, usa null. Sé lo más preciso posible.`;

    const response = await withTimeout(
      generateWithModelFallback([
        {
          inlineData: {
            data: base64Image,
            mimeType: "image/jpeg",
          },
        },
        prompt,
      ]),
      GEMINI_TOTAL_TIMEOUT_MS,
      "Gemini macro detection"
    );

    const responseText =
      response.response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!responseText) {
      return {
        success: false,
        error: "No response from Gemini API",
      };
    }

    // Extraer JSON de la respuesta
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "Could not parse Gemini response as JSON",
        rawResponse: responseText,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      foodName: parsed.foodName || undefined,
      proteins: parsed.proteins || undefined,
      fats: parsed.fats || undefined,
      carbs: parsed.carbs || undefined,
      calories: parsed.calories || undefined,
      basis: parsed.basis || "per_100g",
      unitName: parsed.unitName || undefined,
      confidence: parsed.confidence || 0.8,
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

    let base64Image: string;
    if (Buffer.isBuffer(imageData)) {
      base64Image = imageData.toString("base64");
    } else if (typeof imageData === "string" && imageData.startsWith("data:")) {
      base64Image = imageData.split(",")[1];
    } else {
      base64Image = imageData;
    }

    const response = await withTimeout(
      generateWithModelFallback([
        {
          inlineData: {
            data: base64Image,
            mimeType: "image/jpeg",
          },
        },
        "¿Esta imagen contiene una etiqueta nutricional legible, información de macros de comida, o es una foto de comida? Responde solo con JSON: {\"isLabel\": boolean, \"confidence\": 0-1, \"description\": \"breve descripción\"}",
      ]),
      GEMINI_TOTAL_TIMEOUT_MS,
      "Gemini nutrition-label detection"
    );

    const responseText =
      response.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { isLabel: false, confidence: 0 };
  } catch (error) {
    console.error("Error in isNutritionLabel:", error);
    return { isLabel: false, confidence: 0 };
  }
}
