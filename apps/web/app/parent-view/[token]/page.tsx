import type { Metadata } from "next";
import ParentViewClient from "./parent-view-client";
import "./parent-view.css";

/**
 * Public, read-only parent view (no session). Authorized solely by the opaque
 * per-contact token in the path — see /api/parent-view/[token] and the
 * isPublicParentView allow-list in proxy.ts. Renders only org name/team
 * number, upcoming events, and the linked student's own RSVP state.
 */
export const metadata: Metadata = {
  title: "Team schedule — Vantage",
  robots: { index: false, follow: false },
};

export default async function ParentViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ParentViewClient token={token} />;
}
