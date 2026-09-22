/** Reversible storage-saving switch. No stored media or schemas are deleted. */
export const MEDIA_ENABLED: boolean = false;
export const MEDIA_PAUSED_MESSAGE = "Media and photo/video uploads are temporarily paused to save storage.";

const MEDIA_TOOLS = new Set([
  "media", "media-kit", "media-library", "video", "video-analysis", "match-video-index",
  "content-calendar", "content-drafts", "content-reminders",
]);

export function isMediaTool(id: string): boolean {
  return MEDIA_TOOLS.has(id);
}

export function isPausedMediaRoute(pathname: string, tab?: string | null): boolean {
  if (MEDIA_ENABLED) return false;
  const parts = pathname.split("/").filter(Boolean);
  const feature = parts[0] === "api" ? parts[1] : parts[0];
  if (feature && isMediaTool(feature)) return true;
  if (pathname.startsWith("/api/scouting/media") && (pathname === "/api/scouting/media" || pathname.startsWith("/api/scouting/media/"))) return true;
  return ["/competition", "/business"].includes(pathname) && Boolean(tab && isMediaTool(tab));
}

export function isPausedMediaFile(name: string, contentType: string): boolean {
  return !MEDIA_ENABLED && (
    /^(image|video)\//i.test(contentType) ||
    /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp|raw|dng|cr2|nef|arw|mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|wmv|mts|m2ts|3gp)$/i.test(name)
  );
}
