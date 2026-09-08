import UnsubscribeClient from "./unsubscribe-client";

export const metadata = {
  title: "Email preferences",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; category?: string }>;
}) {
  const params = await searchParams;
  return <UnsubscribeClient token={params.token?.trim() ?? ""} category={params.category?.trim() ?? "all"} />;
}
