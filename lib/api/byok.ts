import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/utils/crypto";
import type { LlmProviderId, UserLlmKey } from "./llm";

// Recupera y descifra la clave LLM propia del usuario; null si no tiene o no se puede descifrar
export async function getUserLlmKey(
  supabase: SupabaseClient,
  userId: string
): Promise<UserLlmKey | null> {
  const { data } = await supabase
    .from("user_llm_keys")
    .select("provider, api_key_enc")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.api_key_enc) return null;

  try {
    return {
      provider: data.provider as LlmProviderId,
      apiKey: decryptSecret(data.api_key_enc),
    };
  } catch {
    return null;
  }
}
