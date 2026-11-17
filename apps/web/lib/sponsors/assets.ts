export const MAX_SPONSOR_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_SPONSOR_NORMALIZED_BYTES = 1024 * 1024;

export type SponsorImageKind = "png" | "jpeg" | "webp" | null;

export function sponsorImageKind(bytes: Uint8Array): SponsorImageKind {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

export function internalSponsorAssetUrl(publicId: string): string {
  return `/api/partner-assets/${encodeURIComponent(publicId)}`;
}

export function safeSponsorFilename(value: string): string {
  const file = value
    .replace(/(?:\.\.[/\\])+/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+(?=\.[a-zA-Z0-9]+$)/, "")
    .replace(/^\.+/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return file || "sponsor-artwork";
}
