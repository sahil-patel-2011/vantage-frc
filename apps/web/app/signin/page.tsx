import type { Metadata } from "next";
import { getPublicAuthCapabilities } from "@vantage/core";
import SignInClient from "../sign-in/sign-in-client";
import { safeAppPath } from "../../lib/security/safe-navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Root layout templates "%s — Vantage"; absolute keeps this from becoming
  // "Sign in · Vantage — Vantage".
  title: { absolute: "Sign in · Vantage" },
  description: "Sign in with Google or email. Invite-only — no public signup.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const status = getPublicAuthCapabilities();
  return (
    <SignInClient
      googleEnabled={status.googleSignInAvailable}
      nextPath={safeAppPath(next, "/dashboard")}
      initialStatus={status}
    />
  );
}
