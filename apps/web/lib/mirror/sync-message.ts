const labels = { excel: "Microsoft Excel", google: "Google Sheets" } as const;

/** HTTP 200 alone is not evidence that a provider accepted a spreadsheet write. */
export function mirrorSyncMessage(ok: boolean, data: Record<string, unknown>): { ok: boolean; text: string } {
  const unconfirmed = { ok: false, text: "The update could not be confirmed. Check Last synced before trying again." };
  if (!ok) return { ok: false, text: typeof data.error === "string" ? data.error : unconfirmed.text };
  if (!Array.isArray(data.copies) || !data.copies.length) return unconfirmed;
  const done: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const item of data.copies) {
    if (!item || typeof item !== "object" || (item.copy !== "excel" && item.copy !== "google") || typeof item.status !== "string" || seen.has(item.copy)) return unconfirmed;
    const copy: "excel" | "google" = item.copy;
    seen.add(copy);
    if (item.status === "succeeded") done.push(labels[copy]);
    else failed.push(`${labels[copy]}: ${typeof item.error === "string" && item.error ? item.error : "did not update"}.`);
  }
  return { ok: done.length > 0 && failed.length === 0, text: [done.length ? `${done.join(" and ")} updated.` : "", ...failed].filter(Boolean).join(" ") };
}
