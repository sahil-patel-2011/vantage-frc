import { getPublicAuthCapabilities } from "@vantage/core";
import SignInClient from "../sign-in/sign-in-client";
import { safeAppPath } from "../../lib/security/safe-navigation";

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
