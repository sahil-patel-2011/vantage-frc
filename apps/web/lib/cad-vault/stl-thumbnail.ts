/**
 * Server-only STL thumbnail: parses the STL with the same module the browser
 * preview uses, rasterizes an isometric view, and PNG-encodes it with sharp.
 * Returns null (silently skipped) on any parse or encode failure — a missing
 * thumbnail is honest; a fabricated one is not.
 */

import sharp from "sharp";
import { parseStl } from "./stl-geometry";
import { rasterizeStl } from "./stl-render";

export const MAX_THUMBNAIL_BYTES = 64 * 1024;
const THUMBNAIL_SIZE = 220;

export async function renderStlThumbnail(data: Uint8Array): Promise<Buffer | null> {
  try {
    const triangles = parseStl(data);
    if (triangles.length === 0) return null;
    const raster = rasterizeStl(triangles, { size: THUMBNAIL_SIZE });
    const png = await sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), {
      raw: { width: raster.width, height: raster.height, channels: 4 },
    })
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer();
    return png.length <= MAX_THUMBNAIL_BYTES ? png : null;
  } catch {
    return null;
  }
}
