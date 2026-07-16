// Capa única de acceso a LLMs vía endpoints OpenAI-compatible.
// Cadena de fallback: Groq (app) → clave propia del usuario → Gemini (app) → OpenRouter (app).

export type LlmTask = "vision" | "text";

export type LlmProviderId = "groq" | "gemini" | "openrouter" | "xai";

export type UserLlmKey = {
  provider: LlmProviderId;
  apiKey: string;
};

type ProviderSpec = {
  baseUrl: string;
  models: Record<LlmTask, string>;
  extraHeaders?: Record<string, string>;
};

export const LLM_PROVIDERS: Record<LlmProviderId, ProviderSpec> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    models: {
      vision: "meta-llama/llama-4-scout-17b-16e-instruct",
      text: "llama-3.1-8b-instant",
    },
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: {
      vision: "gemini-2.5-flash",
      text: "gemini-2.5-flash-lite",
    },
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    models: {
      vision: "nvidia/nemotron-nano-12b-v2-vl:free",
      text: "nvidia/nemotron-nano-12b-v2-vl:free",
    },
    extraHeaders: {
      "HTTP-Referer": "https://github.com/Ismagac/MacrAI",
      "X-Title": "MacrAI",
    },
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    models: {
      vision: "grok-4-1-fast",
      text: "grok-4-1-fast",
    },
  },
};

export type LlmMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: LlmMessageContent;
};

export type LlmRequest = {
  task: LlmTask;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  userKey?: UserLlmKey | null;
};

const DEFAULT_TIMEOUT_MS = 15000;

function shouldTryNextProvider(status: number | null, message: string): boolean {
  if (status !== null) {
    return status === 401 || status === 402 || status === 403 || status === 404 || status === 429 || status >= 500;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timed out") ||
    normalized.includes("abort") ||
    normalized.includes("fetch failed") ||
    normalized.includes("network")
  );
}

function buildChain(userKey?: UserLlmKey | null): Array<{ provider: LlmProviderId; apiKey: string }> {
  const chain: Array<{ provider: LlmProviderId; apiKey: string }> = [];

  if (process.env.GROQ_API_KEY) {
    chain.push({ provider: "groq", apiKey: process.env.GROQ_API_KEY });
  }
  if (userKey?.apiKey && LLM_PROVIDERS[userKey.provider]) {
    chain.push({ provider: userKey.provider, apiKey: userKey.apiKey });
  }
  if (process.env.GOOGLE_API_KEY) {
    chain.push({ provider: "gemini", apiKey: process.env.GOOGLE_API_KEY });
  }
  if (process.env.OPENROUTER_API_KEY) {
    chain.push({ provider: "openrouter", apiKey: process.env.OPENROUTER_API_KEY });
  }

  return chain;
}

async function callProvider(
  provider: LlmProviderId,
  apiKey: string,
  request: LlmRequest
): Promise<string> {
  const spec = LLM_PROVIDERS[provider];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${spec.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...spec.extraHeaders,
      },
      body: JSON.stringify({
        model: spec.models[request.task],
        messages: request.messages,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 400,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`${provider} HTTP ${response.status}: ${body.slice(0, 200)}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function llmChat(request: LlmRequest): Promise<string> {
  const chain = buildChain(request.userKey);
  if (chain.length === 0) {
    throw new Error("No LLM provider configured (GROQ_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY)");
  }

  let lastError: unknown = null;

  for (const { provider, apiKey } of chain) {
    try {
      const content = await callProvider(provider, apiKey, request);
      if (content) return content;
      lastError = new Error(`${provider} returned empty content`);
    } catch (error) {
      lastError = error;
      const status = (error as Error & { status?: number }).status ?? null;
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldTryNextProvider(status, message)) throw error;
    }
  }

  throw lastError ?? new Error("All LLM providers failed");
}
