import { createEmailProvider } from "@vantage/core";
import { z } from "zod";
import {
  jobRunning,
  jobStalled,
  readBroadcastJob,
  runBroadcast,
  broadcastKey,
  noticeEmailText,
  type BroadcastJob,
  type NoticeKind,
} from "../../../../../lib/outage/broadcast";
import { consoleJson, openConsole } from "../../../../../lib/outage/console";
import { deferOutageWork } from "../../../../../lib/outage/defer";
import { turnOffNotice, turnOnNotice } from "../../../../../lib/outage/notice";
import { readRecipientEmails } from "../../../../../lib/outage/recipients";
import { EMAIL_SETUP_MESSAGE, outageOwnerEmail } from "../../../../../lib/outage/runtime";
import { writeJson, type OutageStore } from "../../../../../lib/outage/status-store";

export const dynamic = "force-dynamic";
// Sending runs after the response, a couple of emails a second; give it the room to finish.
export const maxDuration = 300;

const bodySchema = z.object({
  token: z.string().min(10).max(600),
  kind: z.enum(["limited", "recovered"]),
  audience: z.enum(["everyone", "owner"]),
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(4000),
  confirm: z.literal("SEND"),
  again: z.boolean().optional(),
  resume: z.boolean().optional(),
});

/**
 * POST /api/status/outage/broadcast — "Email everyone" from the outage console.
 *
 * Goes to every address in the saved contact list (plus the owner), one email each. A second
 * send of the same kind in the same outage needs `again: true`; a run that was cut off can be
 * continued with `resume: true`. "Limited" turns the in-app banner on; "back" turns it off.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return consoleJson({ error: "Send the form as JSON." }, 400);
  }
  const opened = await openConsole(request, { body: raw as { token?: unknown }, write: true });
  if (!opened.ok) return opened.response;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return consoleJson({ error: "Fill in a subject and a message, and type SEND to confirm.", code: "invalid" }, 400);
  }
  const input = parsed.data;
  const { store, incidentId } = opened.context;

  const provider = createEmailProvider();
  if (provider.name === "unconfigured") return consoleJson({ error: EMAIL_SETUP_MESSAGE, code: "email_not_configured" }, 503);

  const owner = outageOwnerEmail();
  if (input.audience === "owner") {
    // Only the owner: one email now, no "already sent" record — it is a test, or the fallback
    // when there is no contact list to send to.
    if (!owner) return consoleJson({ error: "PLATFORM_OWNER_EMAIL isn't set, so there is no one to send it to.", code: "no_owner" }, 409);
    try {
      await provider.sendFreeform({ to: owner, subject: input.subject, text: noticeEmailText(input.message) });
    } catch {
      return consoleJson({ error: "The email provider didn't accept the email. Try again in a minute.", code: "send_failed" }, 502);
    }
    // A test to the owner changes nothing anyone else sees: the banner stays as it was
    // ("Turn on the banner" and "Turn off the banner" are their own buttons).
    return consoleJson({ sentTo: "owner" });
  }
  const saved = await readRecipientEmails(store).catch(() => null);
  if (!saved?.length) {
    return consoleJson(
      { error: "There's no saved contact list on this server, so only you can be emailed.", code: "no_contact_list" },
      409,
    );
  }
  const recipients = [...new Set([...(owner ? [owner] : []), ...saved])];

  const existing = await readBroadcastJob(store, incidentId, input.kind);
  if (input.resume) {
    if (!existing || !jobStalled(existing)) return consoleJson({ error: "There's nothing to continue.", code: "nothing_to_resume" }, 409);
  } else if (existing && jobRunning(existing)) {
    // A second run alongside the first would email everyone twice and mix their progress.
    return consoleJson({ error: "This is still sending. Wait for it to finish before sending again.", code: "in_progress", job: existing }, 409);
  } else if (existing && !input.again) {
    return consoleJson(
      { error: "This was already sent for this outage. Choose “Send again” to send it a second time.", code: "already_sent", job: existing },
      409,
    );
  }

  const seq = input.resume ? existing!.seq : (existing?.seq ?? 0) + 1;
  const lockKey = `lock:broadcast:${incidentId}:${input.kind}:${seq}${input.resume ? `:from:${existing!.nextIndex}` : ""}`;
  const claimed = await store.set(lockKey, new Date().toISOString(), { onlyIfAbsent: true, ttlSeconds: 24 * 60 * 60 });
  if (!claimed) return consoleJson({ error: "That send has already started.", code: "in_progress", job: existing }, 409);

  const now = new Date().toISOString();
  const job: BroadcastJob = input.resume
    ? { ...existing!, total: recipients.length, updatedAt: now }
    : {
        v: 1,
        kind: input.kind,
        seq,
        audience: "everyone",
        subject: input.subject,
        message: input.message,
        total: recipients.length,
        sent: 0,
        failed: 0,
        nextIndex: 0,
        startedAt: now,
        updatedAt: now,
        finishedAt: null,
      };
  await writeJson(store, broadcastKey(incidentId, input.kind), job, { ttlSeconds: 7 * 24 * 60 * 60 });

  // A resumed run sends what the first recipients got, whatever the form shows now.
  const message = input.resume && existing?.message ? existing.message : input.message;
  const bannerOn = await setBanner(store, input.kind, message, incidentId);

  deferOutageWork(() =>
    runBroadcast({
      store,
      incidentId,
      job,
      recipients,
      message,
      send: (to, subject, text) => provider.sendFreeform({ to, subject, text }),
    }),
  );

  return consoleJson({ job, bannerOn }, 202);
}

/** "Limited" turns the in-app banner on with the message; "back" turns it off. */
async function setBanner(store: OutageStore, kind: NoticeKind, message: string, incidentId: string) {
  if (kind === "limited") {
    await turnOnNotice(store, { message, incidentId });
    return true;
  }
  await turnOffNotice(store);
  return false;
}
