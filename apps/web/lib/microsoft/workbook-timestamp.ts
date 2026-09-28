/** Canonical UTC text without passing fractional seconds through a millisecond Date. */
export function normalizeUtcTimestamp(value: string): string | null {
  let text = value.trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) text += "Z";
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(text)?.[1]?.replace(/0+$/, "");
  const seconds = new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, "");
  return `${seconds}${fraction ? `.${fraction}` : ""}Z`;
}
