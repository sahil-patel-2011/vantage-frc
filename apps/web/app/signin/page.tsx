import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPublicAuthCapabilities } from "@vantage/core";
import { isBackupMode } from "@vantage/db/backup-mode";
import { productForHost } from "../../lib/products/products";
import SignInClient from "../sign-in/sign-in-client";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { BackupModeNotice } from "./backup-mode-notice";

export const dynamic = "force-dynamic";

const DESCRIPTION = `Sign in with Google or email. Existing teams can sign in, with early access by invitation.`;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<Metadata> {
  const { next } = await searchParams;
  const scouting =
    productForHost((await headers()).get("host")) === "scouting" || (typeof next === "string" && next.startsWith("/scout"));
  // Root layout templates "%s — Vantage"; absolute keeps this from becoming
  // "Sign in · Vantage — Vantage".
  return {
    title: { absolute: scouting ? "Sign in · Vantage Scouting" : "Sign in · Vantage" },
    description: DESCRIPTION,
    // Scouting is installed from a phone before anyone signs in: this page is where "Add to Home
    // Screen" happens, and it offered Vantage's manifest ("Vantage Competition Operations").
    ...(scouting
      ? { manifest: "/scout.webmanifest", appleWebApp: { capable: true, title: "Scouting", statusBarStyle: "default" as const } }
      : {}),
  };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Backup mode: no database to sign in against, so say so instead of showing a form that fails.
  if (isBackupMode()) return <BackupModeNotice returning={Boolean(next && next !== "/dashboard")} />;
  const status = getPublicAuthCapabilities();
  const scouting = productForHost((await headers()).get("host")) === "scouting";
  return (
    <SignInClient
      scouting={scouting}
      googleEnabled={status.googleSignInAvailable}
      nextPath={safeAppPath(next, "/dashboard")}
      initialStatus={status}
    />
  );
}
