/** Shared YouTube URL allowlist helpers for pit-screen embeds. */

const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

export function parseYouTubeEmbed(raw: string): { videoId: string; embedUrl: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;

  let videoId = "";
  if (url.hostname.includes("youtu.be")) videoId = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
  else if (url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/")[2] ?? "";
  else videoId = url.searchParams.get("v") ?? "";

  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  return {
    videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`,
  };
}
