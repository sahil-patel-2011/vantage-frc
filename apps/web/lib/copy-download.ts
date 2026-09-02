// Browser-only helpers for "Copy" / "Download" buttons on drafted text (award answers, grant
// narratives). Safe to import from client components; each function no-ops on the server.

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Triggers a plain-text (or JSON) file download without leaving the page. */
export function downloadTextFile(filename: string, text: string, mime = "text/plain;charset=utf-8"): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return false;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
