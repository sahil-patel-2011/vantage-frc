/** Env-only check — mirrors @vantage/agent hosted-platform-keys (no agent import). */
export function isPlatformHostedFreeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.GROQ_API_KEY?.trim() ||
      env.OPENROUTER_API_KEY?.trim() ||
      env.FREE_RELAY_BASE_URL?.trim(),
  );
}
