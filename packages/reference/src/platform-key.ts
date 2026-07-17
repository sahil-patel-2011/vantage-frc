/** Platform TBA Read API key from env. Canonical: TBA_AUTH_KEY; TBA_API_KEY accepted as alias. */
export function readPlatformTbaAuthKey(): string | null {
  const auth = process.env.TBA_AUTH_KEY?.trim();
  if (auth) return auth;
  const alias = process.env.TBA_API_KEY?.trim();
  return alias || null;
}

export function platformTbaEnvConfigured(): boolean {
  return Boolean(readPlatformTbaAuthKey());
}
