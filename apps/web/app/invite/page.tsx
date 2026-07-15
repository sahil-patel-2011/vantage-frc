import InviteClient from "./invite-client";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <InviteClient token={token ?? ""} />;
}
