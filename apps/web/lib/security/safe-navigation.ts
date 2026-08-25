/** Only permit an in-app path. Blocks scheme-relative and backslash URL parser tricks. */
export function safeAppPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  const pathOnly = value.split(/[?#]/, 1)[0] ?? value;
  if (/%(?:2f|5c)/i.test(pathOnly)) return fallback;
  try {
    const parsed = new URL(value, "https://vantage.invalid");
    if (parsed.origin !== "https://vantage.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
