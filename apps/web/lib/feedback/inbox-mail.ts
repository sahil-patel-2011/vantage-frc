import { configuredPlatformOwnerEmail, createEmailProvider, resolveAuthBaseURL } from "@vantage/core";

/**
 * Where help and feedback go: the Send feedback dialog, Report a problem, and support tickets
 * all land in one inbox. FEEDBACK_INBOX_EMAIL overrides it for another deployment. The platform
 * owner's address (PLATFORM_OWNER_EMAIL) still gets support tickets, as it always has.
 */
export const FEEDBACK_INBOX = "vantagefrc@mail.grokbot.com";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function feedbackInbox(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FEEDBACK_INBOX_EMAIL?.trim().toLowerCase() ?? "";
  return EMAIL.test(override) ? override : FEEDBACK_INBOX;
}

/** The inbox first, then the platform owner when asked for and different. */
export function feedbackRecipients(options: { includeOwner: boolean }, env: NodeJS.ProcessEnv = process.env): string[] {
  const inbox = feedbackInbox(env);
  const owner = options.includeOwner ? configuredPlatformOwnerEmail()?.trim().toLowerCase() : null;
  return owner && owner !== inbox && EMAIL.test(owner) ? [inbox, owner] : [inbox];
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
    if (provider.name === "unconfigured") return "skipped";
    const text = feedbackMailText(mail);
    for (const to of feedbackRecipients({ includeOwner: options.includeOwner === true })) {
      await provider.sendFreeform({ to, subject: mail.subject, text });
    }
    return "sent";
  } catch {
    return "failed";
  }
}

/** A link into the admin inbox for a submission. */
export function adminLink(path: string): string {
  return `${resolveAuthBaseURL()}${path}`;
}
