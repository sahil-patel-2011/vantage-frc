/**
 * The JSON contract between the server and `public/sw.js`. Keep this in sync with
 * the `push` handler there — the service worker reads exactly these fields.
 */
import { MAX_PUSH_PAYLOAD_BYTES } from "./encrypt";

export type PushPayload = {
  title: string;
  body?: string;
  /** Same-origin path the notification opens. Absolute URLs are rejected. */
  url?: string;
  /** Collapse key: a newer notification with the same tag replaces the older one. */
  tag?: string;
  type?: string;
  /** Competition-day pings vibrate and stay on screen until dismissed. */
  urgent?: boolean;
};

function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** The ellipsis we append when cutting is 3 UTF-8 bytes. */
const ELLIPSIS_BYTES = 3;

/** Cut on a UTF-8 character boundary, never mid-codepoint, and mark the cut. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) return text;
  if (maxBytes <= ELLIPSIS_BYTES) return "";

  const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes - ELLIPSIS_BYTES);
  // Walk back over continuation bytes to the last lead byte, then keep the whole
  // sequence only if it actually fits inside the slice.
  let end = buffer.length;
  while (end > 0 && ((buffer[end - 1] ?? 0) & 0xc0) === 0x80) end -= 1;
  if (end > 0) {
    const lead = buffer[end - 1] ?? 0;
    const sequenceLength = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    end = sequenceLength <= buffer.length - (end - 1) ? buffer.length : end - 1;
  }
  return `${buffer.subarray(0, end).toString("utf8").trimEnd()}…`;
}

/** Only same-origin app paths reach the service worker's focus-or-open step. */
export function safePushUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/") || url.startsWith("//")) return undefined;
  return url;
}

/**
 * Serialize + fit into one aes128gcm record. Title is preserved (it is the whole
 * point of the notification); the body is what gets trimmed.
 */
export function buildPushPayload(input: PushPayload): string {
  const title = truncateUtf8(input.title.trim() || "Vantage", 200);
  const base: PushPayload = {
    title,
    ...(input.type ? { type: input.type } : {}),
    ...(input.tag ? { tag: truncateUtf8(input.tag, 120) } : {}),
    ...(safePushUrl(input.url) ? { url: safePushUrl(input.url) } : {}),
    ...(input.urgent ? { urgent: true } : {}),
  };

  const body = (input.body ?? "").trim();
  if (!body) return JSON.stringify(base);

  const overhead = utf8Length(JSON.stringify({ ...base, body: "" }));
  const roomForBody = MAX_PUSH_PAYLOAD_BYTES - overhead - 8;
  if (roomForBody <= 8) return JSON.stringify(base);
  return JSON.stringify({ ...base, body: truncateUtf8(body, roomForBody) });
}
