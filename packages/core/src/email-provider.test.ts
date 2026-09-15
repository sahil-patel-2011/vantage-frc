import { afterEach, describe, expect, it } from "vitest";
import { resolveOutboundEmailProvider } from "./email";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("resolveOutboundEmailProvider", () => {
  it("prefers Gmail SMTP when the From address is a Gmail mailbox", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.AUTH_EMAIL_FROM = "Vantage <sahil@gmail.com>";
    process.env.GMAIL_SMTP_USER = "sahil@gmail.com";
    process.env.GMAIL_SMTP_APP_PASSWORD = "abcd efgh ijkl mnop";
    expect(resolveOutboundEmailProvider()?.name).toBe("gmail-smtp");
  });

  it("uses Resend when Gmail SMTP is unset", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.AUTH_EMAIL_FROM = "Vantage <access@example.com>";
    delete process.env.GMAIL_SMTP_USER;
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    expect(resolveOutboundEmailProvider()?.name).toBe("resend");
  });

  it("uses Gmail SMTP when Resend is unset", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    process.env.GMAIL_SMTP_USER = "sahil@gmail.com";
    process.env.GMAIL_SMTP_APP_PASSWORD = "abcd efgh ijkl mnop";
    expect(resolveOutboundEmailProvider()?.name).toBe("gmail-smtp");
  });

  it("does not use Resend when AUTH_EMAIL_FROM is a Gmail address", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.AUTH_EMAIL_FROM = "Vantage <sahil@gmail.com>";
    delete process.env.GMAIL_SMTP_USER;
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    expect(resolveOutboundEmailProvider()).toBeNull();
  });

  it("accepts EMAIL_FROM and GMAIL_USER aliases", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    delete process.env.GMAIL_SMTP_USER;
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    process.env.EMAIL_FROM = "Vantage <access@example.com>";
    process.env.RESEND_KEY = "re_x";
    expect(resolveOutboundEmailProvider()?.name).toBe("resend");
    delete process.env.RESEND_KEY;
    delete process.env.EMAIL_FROM;
    process.env.GMAIL_USER = "sahil@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    expect(resolveOutboundEmailProvider()?.name).toBe("gmail-smtp");
  });
});
