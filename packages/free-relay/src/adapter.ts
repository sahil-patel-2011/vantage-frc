import {
  readFreeRelayConfig,
  tryCreateGroqFreeAdapter,
  tryCreateFreeRelayAdapter,
  tryCreateOpenRouterFreeAdapter,
  tryCreatePetalsPublicAdapter,
  isPetalsPublicPoolEnabled,
  petalsPublicModel,
  openRouterFreeModel,
  type ChatAdapter,
} from "@vantage/agent";

/**
 * Adapter for background / Pi worker jobs. Prefers FREE_RELAY_* (local OpenAI proxy
 * on the Pi), then Groq / OpenRouter free pools, then the public Petals swarm.
 */
export function createFreeRelayChatAdapter(capability?: string): ChatAdapter {
  const freeRelay = tryCreateFreeRelayAdapter({ capability });
  if (freeRelay) return freeRelay;

  const groq = tryCreateGroqFreeAdapter({ capability });
  if (groq) return groq;

  const openrouter = tryCreateOpenRouterFreeAdapter({ capability });
  if (openrouter) return openrouter;

  const petals = tryCreatePetalsPublicAdapter({ capability });
  if (petals) return petals;

  throw new Error(
    "Free relay is not configured. Set FREE_RELAY_BASE_URL, a Groq/OpenRouter key, or leave PETALS_PUBLIC_POOL on for the public swarm.",
  );
}

export function isFreeRelayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(readFreeRelayConfig(env)) ||
    Boolean(env.GROQ_API_KEY?.trim()) ||
    Boolean(env.OPENROUTER_API_KEY?.trim()) ||
    isPetalsPublicPoolEnabled(env)
  );
}

export function describeFreeRelayBackend(env: NodeJS.ProcessEnv = process.env): string {
  const relay = readFreeRelayConfig(env);
  if (relay) return `${relay.providerLabel}@${relay.baseUrl}`;
  if (env.GROQ_API_KEY?.trim()) return "groq";
  if (env.OPENROUTER_API_KEY?.trim()) {
    return `openrouter/${openRouterFreeModel(env)}`;
  }
  if (isPetalsPublicPoolEnabled(env)) return `petals/${petalsPublicModel(env)}`;
  return "unset";
}

/** Features that should use free relay when available (overnight / background / low-priority). */
export const FREE_RELAY_FEATURES = new Set([
  "memory_dream",
  "overnight_intel",
  "bugbot_scan",
  "bugbot",
  "video_analysis",
  "assembly_manual",
]);

export function isFreeRelayFeature(feature: string | null | undefined): boolean {
  if (!feature) return false;
  const normalized = feature.trim().toLowerCase();
  if (FREE_RELAY_FEATURES.has(normalized)) return true;
  return normalized.startsWith("bugbot");
}

export type FreeRelayJobKind = "memory_dream" | "overnight_intel" | "bugbot_scan";

export type FreeRelayJobStatus = "queued" | "running" | "completed" | "failed" | "skipped";
