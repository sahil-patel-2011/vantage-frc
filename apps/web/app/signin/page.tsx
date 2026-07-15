import { getAuthCapabilities } from "@vantage/core";
import SignInClient from "../sign-in/sign-in-client";

function safeDestination(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const status = getAuthCapabilities();
  return (
    <SignInClient
      googleEnabled={status.googleSignInAvailable}
      nextPath={safeDestination(next)}
      initialStatus={status}
    />
  );
}
