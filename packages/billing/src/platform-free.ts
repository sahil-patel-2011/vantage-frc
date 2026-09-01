/** Env-only check — mirrors @vantage/agent hosted-platform-keys (no agent import). */
export function isPlatformHostedFreeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  // The relay leg requires a key, which is stricter than readFreeRelayConfig (that also
  // accepts a keyless loopback relay). Deliberate: on a hosted deployment the relay is
  // always a tunnel hostname, where keyless is refused anyway, and under-claiming a free
  // path is harmless where over-claiming would promise a team AI that cannot serve it.
  const relayUsable = Boolean(env.FREE_RELAY_BASE_URL?.trim() && env.FREE_RELAY_API_KEY?.trim());
  return Boolean(env.GROQ_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || relayUsable);
}
