import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createWaitlistStore, waitlistBackend } from "../../../../lib/marketing/waitlist";
import { LifecycleError, sessionIsFresh } from "../../../../lib/team-lifecycle/model";
import {
  expireSessionCookies,
  forgetRememberedTeam,
  lifecycleErrorResponse,
} from "../../../../lib/team-lifecycle/respond";
import { deleteMyAccount } from "../../../../lib/team-lifecycle/store";

/**
 * Delete my account: `{ confirm }`, the person's own email address as they typed it.
 *
 * Open to everyone, including someone who never joined a team (this path is allowed before team
 * approval, like the rest of /api/account). The last owner of a team hands it over or deletes it
 * first. What goes and what stays is in migration 0720 (delete_my_account) and the Privacy Policy.
 */
export async function POST(request: Request) {
  try {
    const current = await auth.api.getSession({ headers: await headers() });
    if (!current) throw new Error("Authentication required");
    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
    const confirm = typeof body?.confirm === "string" ? body.confirm : "";
    if (!sessionIsFresh(current.session.createdAt)) throw new LifecycleError("reauth_required");
    await withRls({ userId: current.user.id }, (client) => deleteMyAccount(client, confirm));
    await forgetWaitlistEntry(current.user.email);
    const response = Response.json({ deleted: true, next: "/?accountDeleted=1" }, {
      headers: { "cache-control": "private, no-store" },
    });
    expireSessionCookies(response.headers);
    forgetRememberedTeam(response.headers);
    return response;
  } catch (error) {
    return lifecycleErrorResponse(error, "delete_account");
  }
}

/**
 * 0720 removes the waitlist row in the app database. When the public waitlist lives in its own
 * marketing database, remove it there too. The account is already gone, so a failure here is
 * logged for the operator rather than shown to the person.
 */
async function forgetWaitlistEntry(email: string | null | undefined) {
  if (!email || waitlistBackend() === "unavailable") return;
  try {
    await createWaitlistStore().remove(email);
  } catch {
    console.error("account_delete_waitlist", { outcome: "error" });
  }
}
