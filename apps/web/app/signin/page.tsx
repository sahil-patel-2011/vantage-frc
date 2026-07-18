import type { Metadata } from "next";
import { getPublicAuthCapabilities } from "@vantage/core";
import SignInClient from "../sign-in/sign-in-client";
import { safeAppPath } from "../../lib/security/safe-navigation";

export const metadata: Metadata = {
  title: "Sign in · Vantage",
  description:
    "Soft-UI sign-in for authorized Vantage accounts — Google, password, or email OTP. Closed waitlist access; no public signup.",
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
