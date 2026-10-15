import { configuredPlatformOwnerEmail, createEmailProvider, resolveAuthBaseURL } from "@vantage/core";

/**
 * Where help, feedback and account-recovery requests go: the Send feedback dialog, Report a
 * problem, support tickets and the Account recovery form all land in these inboxes, sent with
 * the email account the app already has (Gmail SMTP or Resend). FEEDBACK_INBOX_EMAIL (one
 * address, or several separated by commas) overrides them for another deployment. Support
 * tickets also copy the platform owner (PLATFORM_OWNER_EMAIL), as they always have.
 */
export const FEEDBACK_INBOXES = ["vantagefrc@mail.grokbot.com", "vantagefrc@gmail.com", "sahiljpatel2011@gmail.com"] as const;
export const FEEDBACK_INBOX = FEEDBACK_INBOXES[0];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function feedbackInboxes(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = (env.FEEDBACK_INBOX_EMAIL ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter((address) => EMAIL.test(address));
  return override.length ? [...new Set(override)] : [...FEEDBACK_INBOXES];
}

/** The first inbox (for log lines). */
export function feedbackInbox(env: NodeJS.ProcessEnv = process.env): string {
  return feedbackInboxes(env)[0]!;
}

/** Every inbox, then the platform owner when asked for and not already on the list. */
export function feedbackRecipients(options: { includeOwner: boolean }, env: NodeJS.ProcessEnv = process.env): string[] {
  const inboxes = feedbackInboxes(env);
  const owner = options.includeOwner ? configuredPlatformOwnerEmail()?.trim().toLowerCase() : null;
  return owner && EMAIL.test(owner) && !inboxes.includes(owner) ? [...inboxes, owner] : inboxes;
}

export type FeedbackMail = { subject: string; lines: (string | null | undefined | false)[] };

/** Plain text, one fact per line, nothing empty. */
export function feedbackMailText(mail: FeedbackMail): string {
  return mail.lines.filter((line): line is string => typeof line === "string").join("\n");
}

/**
 * Email a submission to the inbox. Never throws and never blocks the submission: the note is
 * already saved in the database, and email that isn't set up (no RESEND_API_KEY / SMTP) or a
 * failed send just means it isn't mailed. Outside production it is logged, not sent.
 */
export async function mailFeedbackInbox(mail: FeedbackMail, options: { includeOwner?: boolean } = {}): Promise<"sent" | "skipped" | "failed"> {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[feedback] (not production) would email ${feedbackInbox()}: ${mail.subject}`);
      return "skipped";
    }
    const provider = createEmailProvider();
    if (provider.name === "unconfigured") {
      console.error("[feedback] email is not set up; not sent:", mail.subject);
      return "skipped";
    }
    const text = feedbackMailText(mail);
    // One inbox that refuses must not stop the others.
    let delivered = 0;
    for (const to of feedbackRecipients({ includeOwner: options.includeOwner === true })) {
      try {
        await provider.sendFreeform({ to, subject: mail.subject, text });
        delivered += 1;
      } catch (error) {
        console.error("[feedback] not delivered to one inbox", provider.name, error instanceof Error ? error.message.slice(0, 160) : "");
      }
    }
    return delivered > 0 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** A link into the admin inbox for a submission. */
export function adminLink(path: string): string {
  return `${resolveAuthBaseURL()}${path}`;
}
