import type { Metadata } from "next";
import { Button, EmptyState } from "../../components/ui";
import { MEDIA_PAUSED_MESSAGE } from "../../lib/media-availability";

export const metadata: Metadata = {
  title: "Paused",
  robots: { index: false, follow: false },
};

/**
 * What a person sees when they open a media tool while media is paused.
 *
 * Media and video tools are switched off to save storage (`MEDIA_ENABLED` in
 * lib/media-availability.ts — reversible, nothing is deleted). The proxy used to
 * answer every such request, pages included, with the API's JSON:
 *
 *     {"error":"Media and photo/video uploads are temporarily paused…","code":"media_paused"}
 *
 * so a student tapping "Match video" in the menu got a raw error object where a
 * page should be. API callers still get that JSON; page requests are rewritten
 * here instead, keeping the address they asked for, so the page can name the
 * tool and say what to use meanwhile.
 */

/** The friendly name for each paused tool, so the heading says what is paused. */
const TOOL_NAMES: Record<string, string> = {
  media: "Media",
  "media-kit": "Media kit",
  "media-library": "Media library",
  video: "Match video",
  "video-analysis": "Video analysis",
  "match-video-index": "Match video index",
  "content-calendar": "Content calendar",
  "content-drafts": "Content drafts",
  "content-reminders": "Content reminders",
};

function toolFrom(from: string | undefined): string | null {
  if (!from) return null;
  // `from` is "/video" or "/competition?tab=video" — the first path segment,
  // or the tab when the tool lives inside a hub.
  let url: URL;
  try {
    url = new URL(from, "https://vantage.local");
  } catch {
    return null;
  }
  const tab = url.searchParams.get("tab");
  if (tab && TOOL_NAMES[tab]) return TOOL_NAMES[tab]!;
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  return TOOL_NAMES[first] ?? null;
}

export default async function MediaPausedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const tool = toolFrom(from);
  const title = tool ? `${tool} is paused` : "Media is paused";

  return (
    <main className="module-page media-paused-page">
      {/* One heading. A page header above the empty state said the same words
          twice; like the 404, the empty state is the page here. */}
      <EmptyState
        headingLevel={1}
        badge="Paused"
        badgeTone="setup"
        title={title}
        description={`${MEDIA_PAUSED_MESSAGE} Nothing has been deleted — photos, videos and their notes come back exactly as they were when media is switched on again.`}
      >
        <Button as="a" variant="primary" href="/dashboard">
          Go to Home
        </Button>
        <Button as="a" variant="secondary" href="/files">
          Open Files
        </Button>
      </EmptyState>
      <p className="app-muted media-paused-note">
        Files still takes team documents, CAD exports and paperwork. Only photo and video uploads are paused.
      </p>
    </main>
  );
}
