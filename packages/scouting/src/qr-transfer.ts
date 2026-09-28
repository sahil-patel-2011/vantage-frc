import { encodeScoutQrPayload, SCOUT_QR_MAX_EMBEDDED_BYTES, type ScoutQrRecord } from "./qr-handoff";

/** Multipart transfer is local and lossless. Its digest detects incomplete or
 * corrupted transfers; it never substitutes for receiving-user authorization. */
export const SCOUT_QR_PART_PREFIX = "vantage://scout-part/";
const PART_CHARS = 900;
const MAX_PARTS = 256;
export type ScoutQrPart = { id: string; index: number; total: number; content: string };
export type ScoutQrAssembly = { id: string; total: number; parts: Record<string, string> };

async function digest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

export async function encodeScoutQrFrames(records: ScoutQrRecord[]): Promise<string[]> {
  const payload = encodeScoutQrPayload(records);
  if (payload.length <= SCOUT_QR_MAX_EMBEDDED_BYTES) return [payload];
  const total = Math.ceil(payload.length / PART_CHARS);
  if (total > MAX_PARTS) throw new Error("This batch is too large for QR transfer. Hand off fewer reports at a time.");
  const id = await digest(payload);
  return Array.from({ length: total }, (_, index) =>
    `${SCOUT_QR_PART_PREFIX}${id}/${index + 1}/${total}/${payload.slice(index * PART_CHARS, (index + 1) * PART_CHARS)}`);
}

export function decodeScoutQrPart(content: string): ScoutQrPart | null {
  const text = content.trim();
  if (!text.startsWith(SCOUT_QR_PART_PREFIX)) return null;
  const match = text.slice(SCOUT_QR_PART_PREFIX.length).match(/^([a-f0-9]{64})\/(\d+)\/(\d+)\/([A-Za-z0-9_:/-]+)$/);
  if (!match) throw new Error("That QR transfer part is invalid. Scan it again.");
  const index = Number(match[2]), total = Number(match[3]), chunk = match[4]!;
  if (total < 2 || total > MAX_PARTS || index < 1 || index > total || chunk.length > PART_CHARS) {
    throw new Error("That QR transfer part is invalid. Scan it again.");
  }
  return { id: match[1]!, index, total, content: chunk };
}

export function addScoutQrPart(previous: ScoutQrAssembly | null, part: ScoutQrPart): ScoutQrAssembly {
  if (previous && (previous.id !== part.id || previous.total !== part.total)) throw new Error("These codes belong to different transfers.");
  if (previous?.parts[part.index] && previous.parts[part.index] !== part.content) throw new Error("This QR part conflicts with an earlier scan. Scan the original code.");
  return { id: part.id, total: part.total, parts: { ...previous?.parts, [part.index]: part.content } };
}

export async function completeScoutQrTransfer(assembly: ScoutQrAssembly): Promise<string | null> {
  const parts = Array.from({ length: assembly.total }, (_, i) => assembly.parts[i + 1]);
  if (parts.some(part => part === undefined)) return null;
  const payload = parts.join("");
  if (await digest(payload) !== assembly.id) throw new Error("The QR transfer is damaged. Rescan the original codes.");
  return payload;
}
