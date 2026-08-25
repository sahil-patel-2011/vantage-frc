/**
 * Browser side of the in-place export. No round trip in the normal path: the CSV is
 * built from the rows already on screen and handed to the browser as a Blob, so an
 * export works at a venue with dead Wi-Fi exactly like it works at home.
 *
 * Not unit-tested (DOM-only); the logic worth testing lives in to-csv.ts.
 */

/** Server fallback used only when this browser cannot download a Blob URL. */
export const EXPORT_TABLE_ENDPOINT = "/api/export/table";

/** Matches the server cap in app/api/export/table/route.ts. */
export const EXPORT_FALLBACK_MAX_BYTES = 6_000_000;

export type CsvDownloadResult = "downloaded" | "posted" | "too-large" | "unsupported";

function canBlobDownload(): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  if (typeof URL.createObjectURL !== "function") return false;
  return "download" in document.createElement("a");
}

/** Hidden-form POST so the browser's own download machinery handles the file. */
function postToServer(fileName: string, csv: string): CsvDownloadResult {
  if (typeof document === "undefined") return "unsupported";
  if (new Blob([csv]).size > EXPORT_FALLBACK_MAX_BYTES) return "too-large";
  const form = document.createElement("form");
  form.method = "POST";
  form.action = EXPORT_TABLE_ENDPOINT;
  form.style.display = "none";
  for (const [name, value] of [
    ["fileName", fileName],
    ["csv", csv],
  ]) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name as string;
    field.value = value as string;
    form.append(field);
  }
  document.body.append(form);
  form.submit();
  form.remove();
  return "posted";
}

/**
 * Save `csv` as `fileName`. Returns what actually happened so the caller can say so
 * out loud instead of leaving the user staring at a button that did nothing.
 */
export function downloadCsv(fileName: string, csv: string): CsvDownloadResult {
  if (!canBlobDownload()) return postToServer(fileName, csv);
  // The BOM is already inside `csv`; charset=utf-8 keeps well-behaved tools happy too.
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    return "downloaded";
  } catch {
    return postToServer(fileName, csv);
  } finally {
    // Revoke on the next tick so the click has taken the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
