import type { Metadata } from "next";
import RespondClient from "./respond-client";

/**
 * Public self-serve exit interview (no session). Authorized solely by the
 * one-time token in ?token= — see /api/exit-interview/respond and the
 * allow-list entry in proxy.ts. Shows only the team name and the invitee's own
 * name; nothing else about the org leaves the server.
 */
export const metadata: Metadata = {
  title: "Exit interview — Vantage",
  robots: { index: false, follow: false },
};

export default async function ExitInterviewRespondPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <RespondClient token={typeof token === "string" ? token : ""} />;
}
