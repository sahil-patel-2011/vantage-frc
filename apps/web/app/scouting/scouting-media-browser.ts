import {
  DOWNSCALE_JPEG_QUALITY,
  downscaleDimensions,
  exceedsMediaCap,
  isDownscalableImageType,
} from "../../lib/scouting/media-downscale";

/**
 * Canvas re-encode of a still image so queued photos fit the server media cap
 * (max edge / quality live in lib/scouting/media-downscale.ts with the pure
 * geometry math). Falls back to the original file on any decode failure.
 */
/**
 * The canvas re-encode hands back a bare Blob; prepareScoutMediaFile inspects name/type, so
 * re-wrap it as a File carrying the re-encoded type and a matching extension.
 */
export function asMediaFile(blob: Blob, original: File): File {
  if (blob instanceof File) return blob;
  const jpeg = blob.type === "image/jpeg" && original.type !== "image/jpeg";
  const name = jpeg ? `${original.name.replace(/\.[^.]+$/, "")}.jpg` : original.name;
  return new File([blob], name, { type: blob.type || original.type });
}

export async function downscaleImageInBrowser(file: File): Promise<Blob> {
  if (!isDownscalableImageType(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height, scaled } = downscaleDimensions(bitmap.width, bitmap.height);
      // Small-but-heavy files (huge PNGs) still get a JPEG re-encode.
      if (!scaled && !exceedsMediaCap(file.size)) return file;
      if (width < 1 || height < 1) return file;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      const encoded = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", DOWNSCALE_JPEG_QUALITY),
      );
      if (!encoded || encoded.size === 0) return file;
      return encoded.size < file.size ? encoded : file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
