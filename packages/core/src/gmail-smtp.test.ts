import { describe, expect, it } from "vitest";
import { buildSmtpData, gmailSmtpFrom } from "./gmail-smtp";

describe("gmailSmtpFrom", () => {
  it("keeps AUTH_EMAIL_FROM when it already uses the Gmail user", () => {
    expect(gmailSmtpFrom("sahil@gmail.com", "Vantage <sahil@gmail.com>")).toBe("Vantage <sahil@gmail.com>");
  });

  it("does not send From a different mailbox than the SMTP user", () => {
    expect(gmailSmtpFrom("sahil@gmail.com", "Vantage <access@example.com>")).toBe("Vantage <sahil@gmail.com>");
  });
});

describe("buildSmtpData", () => {
  it("uses CRLF and a plain-text body", () => {
    const data = buildSmtpData({
      from: "Vantage <sahil@gmail.com>",
      to: "coach@example.com",
      subject: "Your Vantage verification code",
      text: "Your Vantage verification code is 123456.",
    });
    expect(data).toContain("From: Vantage <sahil@gmail.com>");
    expect(data).toContain("To: coach@example.com");
    expect(data).toContain("123456");
    expect(data).toMatch(/\r\n\r\n/);
  });
});
