import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_COOKIE, verifyConsoleToken } from "../../../lib/outage/console-token";
import { OutageConsole } from "./outage-console";
import "./outage-console.css";

export const metadata: Metadata = {
  title: "Outage console",
  robots: { index: false, follow: false },
  // The link carries the console's key: never hand it to another site in a Referer header.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

const LINK_PROBLEMS: Record<string, string> = {
  expired: "This link has expired (they last 24 hours). The next alert email brings a fresh one, and so does the reminder every 6 hours while the database stays down.",
  secret_missing: "The console can't check links because BETTER_AUTH_SECRET isn't set on this deployment.",
};

/**
 * The outage console. Opened from the owner's alert email while the database is down, so it
 * needs no sign-in and no database: the signed link is checked here and by every call it makes.
 */
export default async function OutageConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; problem?: string | string[] }>;
}) {
  const params = await searchParams;
  // An older link with the key in the address: swap it for the cookie before anything renders.
  if (typeof params.t === "string" && params.t) redirect(`/status/outage/open?t=${encodeURIComponent(params.t)}`);
  const token = (await cookies()).get(CONSOLE_COOKIE)?.value ?? "";
  const problem = typeof params.problem === "string" ? params.problem : null;
  const checked = token ? verifyConsoleToken(token) : ({ ok: false, reason: problem ?? "malformed" } as const);
  if (!checked.ok) {
    return (
      <main className="outage-console">
        <p className="outage-console-brand">Vantage</p>
        <h1>Outage console</h1>
        <p className="outage-console-lead">
          {LINK_PROBLEMS[checked.reason] ?? "This link isn't valid. Open the console from the button in your most recent alert email."}
        </p>
        <p className="outage-console-lead">
          <a href="/api/health">Check whether the database answers now</a>
        </p>
      </main>
    );
  }
  return <OutageConsole token={token} />;
}
