import { redirect } from "next/navigation";

export default async function LegacySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
}
