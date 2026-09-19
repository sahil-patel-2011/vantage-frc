/** Env-only check — mirrors @vantage/agent hosted-platform-keys (no agent import). */
export function isPlatformHostedFreeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const petalsOff = ["0", "false", "off", "no"].includes(
    env.PETALS_PUBLIC_POOL?.trim().toLowerCase() ?? "",
  );
  // The AI Horde is opt-in and counts only when it is on. Petals reads the
  // other way round — absent means on — which is how it was written when it
  // was the only swarm; it is left alone rather than quietly flipped, because
  // changing a default is a change to what deployments already do.
  const hordeOn = ["1", "true", "on", "yes"].includes(
    env.AI_HORDE_POOL?.trim().toLowerCase() ?? "",
  );
  return Boolean(
    env.GROQ_API_KEY?.trim() ||
      env.OPENROUTER_API_KEY?.trim() ||
      env.FREE_RELAY_BASE_URL?.trim() ||
      hordeOn ||
      !petalsOff,
  );
}
