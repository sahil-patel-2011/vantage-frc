import { createHash, createHmac } from "node:crypto";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import {
  authEmailFrom,
  gmailSmtpPassword,
  gmailSmtpUser,
  isConsumerMailboxFrom,
  isGmailSmtpConfigured,
  isResendConfigured,
  resendApiKey,
  resolveAuthBaseURL,
  shouldDeliverOutboundEmail,
} from "./access-policy";
import { gmailSmtpFrom, sendGmailSmtp } from "./gmail-smtp";

export type OtpEmail = {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
};
export type InviteEmail = {
  email: string;
  organization: string;
  role: string;
  token: string;
  expiresAt: Date;
};
export type SecurityNotice = { email:string; subject:string; message:string };
/** `html` is optional; providers must always deliver the plain-text body. */
export type FreeformEmail = { to: string; subject: string; text: string; html?: string };

export interface EmailProvider {
  readonly name: string;
  sendOtp(message: OtpEmail): Promise<void>;
  sendInvite(message: InviteEmail): Promise<void>;
  sendSecurityNotice(message: SecurityNotice): Promise<void>;
  /** Freeform send for team-authored content (sponsor/grant outreach) — no fixed template. */
  sendFreeform(message: FreeformEmail): Promise<void>;
}

export const localMailbox = new Map<string, OtpEmail[]>();
export const localInviteMailbox = new Map<string, InviteEmail[]>();
export const localFreeformMailbox = new Map<string, FreeformEmail[]>();

export class LocalMailboxProvider implements EmailProvider {
  readonly name = "local-mailbox";
  async sendOtp(message: OtpEmail) {
    const email = message.email.trim().toLowerCase();
    localMailbox.set(email, [...(localMailbox.get(email) ?? []), { ...message, email }]);
  }
  async sendInvite(message: InviteEmail) {
    const email = message.email.trim().toLowerCase();
    localInviteMailbox.set(email, [
      ...(localInviteMailbox.get(email) ?? []),
      { ...message, email },
    ]);
  }
  async sendSecurityNotice() {}
  async sendFreeform(message: FreeformEmail) {
    const to = message.to.trim().toLowerCase();
    localFreeformMailbox.set(to, [...(localFreeformMailbox.get(to) ?? []), { ...message, to }]);
  }
}

async function assertResendAccepted(response: Response) {
  if (response.ok) return;
  let hint = "";
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      hint = `: ${body.message.replace(/\s+/g, " ").trim().slice(0, 160)}`;
    }
  } catch {
    // Keep the status-only error when Resend returns a non-JSON body.
  }
  throw new Error(`Email provider returned ${response.status}${hint}`);
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  private async postEmail(body: Record<string, unknown>) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await assertResendAccepted(response);
  }
  async sendOtp(message: OtpEmail) {
    await this.postEmail({
      from: this.from,
      to: [message.email],
      subject: "Your Vantage verification code",
      text: `Your Vantage verification code is ${message.otp}. It expires in 5 minutes. If you did not request this, you can ignore this email.`,
    });
  }
  async sendInvite(message: InviteEmail) {
    const acceptUrl = inviteAcceptUrl(message.token);
    const role = message.role.trim() || "member";
    await this.postEmail({
      from: this.from,
      to: [message.email],
      subject: `Join ${message.organization} on Vantage`,
      text:
        `You were invited to join ${message.organization} on Vantage as ${role}.\n\n` +
        `Sign in with ${message.email}, then open this link to accept:\n${acceptUrl}\n\n` +
        `This invite expires ${message.expiresAt.toUTCString()}. If you were not expecting this, you can ignore it.`,
    });
  }
  async sendSecurityNotice(message: SecurityNotice) {
    await this.postEmail({
      from: this.from,
      to: [message.email],
      subject: message.subject,
      text: message.message,
    });
  }
  async sendFreeform(message: FreeformEmail) {
    await this.postEmail({
      from: this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }
}

class UnconfiguredProductionEmailProvider implements EmailProvider {
  readonly name = "unconfigured";
  async sendOtp() {
    throw new Error("RESEND_API_KEY and AUTH_EMAIL_FROM, or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD, are required for production email");
  }
  async sendInvite() {
    throw new Error("RESEND_API_KEY and AUTH_EMAIL_FROM, or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD, are required for production email");
  }
  async sendSecurityNotice(){throw new Error("RESEND_API_KEY and AUTH_EMAIL_FROM, or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD, are required for production email");}
  async sendFreeform(){throw new Error("RESEND_API_KEY and AUTH_EMAIL_FROM, or GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD, are required for production email");}
}

export class GmailSmtpEmailProvider implements EmailProvider {
  readonly name = "gmail-smtp";
  constructor(
    private readonly user: string,
    private readonly appPassword: string,
    private readonly from: string,
  ) {}
  private async send(to: string, subject: string, text: string) {
    await sendGmailSmtp({
      user: this.user,
      appPassword: this.appPassword,
      from: this.from,
      to,
      subject,
      text,
    });
  }
  async sendOtp(message: OtpEmail) {
    await this.send(
      message.email,
      "Your Vantage verification code",
      `Your Vantage verification code is ${message.otp}. It expires in 5 minutes. If you did not request this, you can ignore this email.`,
    );
  }
  async sendInvite(message: InviteEmail) {
    const acceptUrl = inviteAcceptUrl(message.token);
    const role = message.role.trim() || "member";
    await this.send(
      message.email,
      `Join ${message.organization} on Vantage`,
      `You were invited to join ${message.organization} on Vantage as ${role}.\n\n` +
        `Sign in with ${message.email}, then open this link to accept:\n${acceptUrl}\n\n` +
        `This invite expires ${message.expiresAt.toUTCString()}. If you were not expecting this, you can ignore it.`,
    );
  }
  async sendSecurityNotice(message: SecurityNotice) {
    await this.send(message.email, message.subject, message.message);
  }
  async sendFreeform(message: FreeformEmail) {
    await this.send(message.to, message.subject, message.text);
  }
}

export function resolveOutboundEmailProvider(): EmailProvider | null {
  const resendKey = resendApiKey();
  const from = authEmailFrom();
  const gmailUser = gmailSmtpUser();
  const gmailPass = gmailSmtpPassword();
  const gmailReady = Boolean(gmailUser && gmailPass);
  const resendReady = Boolean(resendKey && from && !isConsumerMailboxFrom(from));
  if (gmailReady && isConsumerMailboxFrom(from || gmailUser)) {
    return new GmailSmtpEmailProvider(gmailUser, gmailPass, gmailSmtpFrom(gmailUser, from));
  }
  if (resendReady) return new ResendEmailProvider(resendKey, from);
  if (gmailReady) return new GmailSmtpEmailProvider(gmailUser, gmailPass, gmailSmtpFrom(gmailUser, from));
  return null;
}

export function createEmailProvider(): EmailProvider {
  if (!shouldDeliverOutboundEmail()) {
    if (process.env.NODE_ENV === "production" && !isResendConfigured() && !isGmailSmtpConfigured()) {
      return new UnconfiguredProductionEmailProvider();
    }
    return new LocalMailboxProvider();
  }
  return resolveOutboundEmailProvider() ?? new UnconfiguredProductionEmailProvider();
}

export function deterministicLocalOtp(email: string, type: string) {
  const secret = process.env.DEV_OTP_SECRET ?? "vantage-local-otp";
  const digest = createHmac("sha256", secret)
    .update(`${email.trim().toLowerCase()}:${type}`)
    .digest()
    .readUInt32BE(0);
  return String(digest % 1_000_000).padStart(6, "0");
}

export function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** Public origin + `/invite?token=` for invite emails and one-time admin copy links. */
export function inviteAcceptUrl(token: string) {
  return `${resolveAuthBaseURL()}/invite?token=${encodeURIComponent(token.trim())}`;
}

export async function auditAuthEvent(input: {
  action: string;
  email?: string;
  userId?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  const connectionString = firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL");
  if (!connectionString) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_AUTH_URL is required");
    return;
  }
  const pool = createSqlPool(connectionString, { max: 1 });
  try {
    await pool.query(
      `INSERT INTO auth_audit_events(action,email_hash,user_id,success,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        input.action,
        input.email ? hashEmail(input.email) : null,
        input.userId ?? null,
        input.success,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } finally {
    await pool.end();
  }
}
