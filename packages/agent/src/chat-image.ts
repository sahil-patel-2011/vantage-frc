/** Transient screenshot or drawing; separate from the persisted text-history contract. */
export type ChatPngImage = { mimeType: "image/png"; dataBase64: string };
export const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_IMAGE_BASE64_CHARS = 4 * Math.ceil(MAX_CHAT_IMAGE_BYTES / 3);
export const MAX_CHAT_IMAGE_DIMENSION = 4096;
export const MAX_CHAT_IMAGE_PIXELS = 8_388_608;
/** Conservative reservation only; billing still records provider-reported usage. */
export const CHAT_IMAGE_PREFLIGHT_TOKENS = 32_768;

export function validateChatPngImage(input: unknown): { image: ChatPngImage; width: number; height: number; bytes: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide one PNG screenshot.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["mimeType", "dataBase64"].includes(key)) || value.mimeType !== "image/png" ||
      typeof value.dataBase64 !== "string" || value.dataBase64.length > MAX_CHAT_IMAGE_BASE64_CHARS ||
      value.dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value.dataBase64)) {
    throw new Error("Use a PNG screenshot of at most 3 MiB, encoded as plain base64.");
  }
  const png = Buffer.from(value.dataBase64, "base64");
  if (png.length < 57 || png.length > MAX_CHAT_IMAGE_BYTES || png.toString("base64") !== value.dataBase64 ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.readUInt32BE(8) !== 13 || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("The screenshot must contain PNG image data.");
  }
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height || width > MAX_CHAT_IMAGE_DIMENSION || height > MAX_CHAT_IMAGE_DIMENSION || width * height > MAX_CHAT_IMAGE_PIXELS) {
    throw new Error("Use a screenshot up to 4096 pixels per side and 8 megapixels total.");
  }
  // Bound structure without decompressing potentially hostile image data locally.
  let offset = 8, chunks = 0, hasImageData = false, complete = false;
  while (offset + 12 <= png.length && ++chunks <= 4096) {
    const length = png.readUInt32BE(offset);
    if (length > png.length - offset - 12) break;
    const kind = png.toString("ascii", offset + 4, offset + 8);
    if (kind === "acTL") throw new Error("Use one still PNG screenshot, not an animation.");
    if (kind === "IDAT") hasImageData = true;
    offset += length + 12;
    if (kind === "IEND") { complete = length === 0 && offset === png.length; break; }
  }
  if (!hasImageData || !complete) throw new Error("The PNG screenshot is incomplete.");
  return { image: { mimeType: "image/png", dataBase64: value.dataBase64 }, width, height, bytes: png.length };
}

export function assertRemoteImageAdapter(adapter: { readonly supportsImages?: boolean }): void {
  if (adapter.supportsImages !== true) {
    throw new Error("CAD screenshots require a supported remote image provider. Local models, subscription bridges and public swarms are not used.");
  }
}

export function assertTextOnlyChatInput(input: unknown): void {
  if (input && typeof input === "object" && (("image" in input && input.image !== undefined) || ("images" in input && input.images !== undefined))) {
    throw new Error("This chat route does not accept screenshots. Choose a supported remote image provider.");
  }
}

/** Current viewport first, optional user drawing second; one combined byte budget. */
export function validateChatPngImages(input: unknown): ReturnType<typeof validateChatPngImage>[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 2) throw new Error("Provide one screenshot and at most one PNG drawing.");
  const images = input.map(validateChatPngImage);
  if (images.reduce((total, item) => total + item.bytes, 0) > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("The screenshot and drawing must total at most 3 MiB.");
  }
  return images;
}

/** Fixed remote destinations prevent screenshots reaching custom/local proxies. */
export function isRemoteImageEndpoint(kind: string, baseUrl: string): boolean {
  if (kind === "anthropic") return baseUrl === "https://api.anthropic.com";
  if (kind !== "openai" && kind !== "openai-compatible") return false;
  return new Set([
    "https://api.openai.com/v1", "https://generativelanguage.googleapis.com/v1beta/openai",
    "https://openrouter.ai/api/v1", "https://api.groq.com/openai/v1", "https://api.mistral.ai/v1",
    "https://api.together.xyz/v1", "https://api.together.ai/v1", "https://api.cerebras.ai/v1",
  ]).has(baseUrl);
}
