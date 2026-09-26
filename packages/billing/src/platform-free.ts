/** Env-only check — mirrors @vantage/agent hosted-platform-keys (no agent import). */
export function isPlatformHostedFreeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  // Both volunteer swarms are opt-in, matching the adapters that actually route to them
  // (isPetalsPublicPoolEnabled, the AI Horde pool). This check used to read Petals as on when
  // unset, so a deployment reported free AI that the router would never use.
  const petalsOn = ["1", "true", "on", "yes"].includes(
    env.PETALS_PUBLIC_POOL?.trim().toLowerCase() ?? "",
  );
  const hordeOn = ["1", "true", "on", "yes"].includes(
    env.AI_HORDE_POOL?.trim().toLowerCase() ?? "",
  );
  return Boolean(
    env.GROQ_API_KEY?.trim() ||
      env.OPENROUTER_API_KEY?.trim() ||
      env.FREE_RELAY_BASE_URL?.trim() ||
      hordeOn ||
      petalsOn,
  );
}
