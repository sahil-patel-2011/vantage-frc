import { LEGAL_DOC_VERSION, configuredPlatformOwnerEmail, createEmailProvider } from "@vantage/core";
import type { WaitlistEntry, WaitlistInput, WaitlistStore } from "./waitlist";

export type WaitlistMail = { to: string; subject: string; text: string };

/** Thrown when no email provider is set up, so the form says "email us" instead of failing. */
export class WaitlistEmailUnavailableError extends Error {
  constructor() {
    super("No email provider is configured for backup-mode waitlist requests.");
    this.name = "WaitlistEmailUnavailableError";
  }
}

async function sendWithConfiguredProvider(mail: WaitlistMail) {
  const provider = createEmailProvider();
  if (provider.name === "unconfigured") throw new WaitlistEmailUnavailableError();
  await provider.sendFreeform(mail);
}

/** The owner's copy of one request: everything the waitlist table would have kept. */
export function waitlistRequestMail(input: WaitlistInput, to: string, now = new Date()): WaitlistMail {
  const phone = input.phone ? `${input.phone} (texts: ${input.smsConsent ? "yes" : "no"})` : "none given";
  return {
    to,
    subject: `Waitlist request: team ${input.teamNumber}`,
    text: [
      "Someone joined the Vantage waitlist while Vantage runs in backup mode, so it was emailed to you instead of saved.",
      "",
      `Email: ${input.email}`,
      `Team: ${input.teamNumber}`,
      `Phone: ${phone}`,
      `Accepted the terms and privacy policy (version ${LEGAL_DOC_VERSION}) and agreed to email about access.`,
      `Received: ${now.toISOString()}`,
      "",
      "Add it to the waitlist once the NAS is connected and backup mode is off.",
    ].join("\n"),
  };
}

/**
 * The waitlist in backup mode (VANTAGE_BACKUP_MODE): with no database to keep names in, each
 * request is emailed to the platform owner, so a public launch loses no sign-ups while the NAS
 * is offline. It only ever adds; listing, marking and removing need the database.
 */
export class EmailedWaitlistStore implements WaitlistStore {
  constructor(
    private readonly send: (mail: WaitlistMail) => Promise<void> = sendWithConfiguredProvider,
    private readonly to: string = configuredPlatformOwnerEmail(),
  ) {}

  async upsert(input: WaitlistInput) {
    await this.send(waitlistRequestMail(input, this.to));
  }

  async list(): Promise<WaitlistEntry[]> {
    return [];
  }

  async markLaunchInvited(): Promise<WaitlistEntry | null> {
    return null;
  }

  async markConverted(): Promise<WaitlistEntry | null> {
    return null;
  }

  async remove(): Promise<boolean> {
    return false;
  }
}
