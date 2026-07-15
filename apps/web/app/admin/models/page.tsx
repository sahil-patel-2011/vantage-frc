import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import ModelsClient from "./models-client";

export default async function ModelsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const allowed = await withRls({ userId: session.user.id }, async (client) =>
    (await client.query("SELECT is_platform_admin() AS value")).rows[0]?.value === true,
  );
  if (!allowed) redirect("/");
  return <ModelsClient />;
}
