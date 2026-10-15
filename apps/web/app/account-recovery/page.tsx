import type { Metadata } from "next";
import { safeAppPath } from "../../lib/security/safe-navigation";
import { AccountRecoveryClient } from "./account-recovery-client";

export const metadata: Metadata = {
  title: "Recover your account",
  robots: { index: false },
};

export default async function AccountRecoveryPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AccountRecoveryClient nextPath={safeAppPath(next, "/dashboard")} />;
}
