/**
 * Escapes text for HTML element bodies and quoted attributes (either quote style).
 * Server-built HTML (emails, exports, plain HTML responses) must use this one copy.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
