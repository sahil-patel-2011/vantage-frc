import {
  readFreeRelayConfig,
  tryCreateGroqFreeAdapter,
  tryCreateFreeRelayAdapter,
  tryCreateOpenRouterFreeAdapter,
  openRouterFreeModel,
  type ChatAdapter,
} from "@vantage/agent";

/**
 * Adapter for background / Pi worker jobs. Prefers FREE_RELAY_* (Freebuff proxy on Pi),
 * then platform OPENROUTER_API_KEY free pool.
 */
export function createFreeRelayChatAdapter(capability?: string): ChatAdapter {
  const groq = tryCreateGroqFreeAdapter({ capability });
  if (groq) return groq;

  const freeRelay = tryCreateFreeRelayAdapter({ capability });
  if (freeRelay) return freeRelay;

  const openrouter = tryCreateOpenRouterFreeAdapter({ capability });
  if (openrouter) return openrouter;

  throw new Error(
    "Free relay is not configured. Set FREE_RELAY_BASE_URL (Pi Freebuff proxy) or OPENROUTER_API_KEY.",
  );
}

export function isFreeRelayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readFreeRelayConfig(env)) || Boolean(env.GROQ_API_KEY?.trim()) || Boolean(env.OPENROUTER_API_KEY?.trim());
}

export function describeFreeRelayBackend(env: NodeJS.ProcessEnv = process.env): string {
  const relay = readFreeRelayConfig(env);
  if (relay) return `${relay.providerLabel}@${relay.baseUrl}`;
  if (env.OPENROUTER_API_KEY?.trim()) {
    return `openrouter/${openRouterFreeModel(env)}`;
  }
  return "unset";
}

/** Features that should use free relay when available (overnight / background / low-priority). */
export const FREE_RELAY_FEATURES = new Set([
  "memory_dream",
  "overnight_intel",
  "bugbot_scan",
  "bugbot",
]);

export function isFreeRelayFeature(feature: string | null | undefined): boolean {
  if (!feature) return false;
  const normalized = feature.trim().toLowerCase();
  if (FREE_RELAY_FEATURES.has(normalized)) return true;
  return normalized.startsWith("bugbot");
}

export type FreeRelayJobKind = "memory_dream" | "overnight_intel" | "bugbot_scan";

export type FreeRelayJobStatus = "queued" | "running" | "completed" | "failed" | "skipped";
