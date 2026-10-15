import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecoveryRequest, recoveryMail } from "./request";

const NOW = new Date("2026-10-15T12:00:00Z");
const good = {
  firstName: " Test ",
  lastName: "Person",
  email: "Test.Person@Example.Test",
  dateOfBirth: "2010-05-01",
  lastPassword: "",
  recoveryEmail: "",
};

describe("account recovery request", () => {
  it("accepts the six fields and tidies them", () => {
    const parsed = parseRecoveryRequest(good, NOW);
    expect(parsed).toEqual({ ok: true, request: { ...good, firstName: "Test", email: "test.person@example.test" } });
  });

  it("names the first field to fix", () => {
    expect(parseRecoveryRequest({ ...good, firstName: "" }, NOW)).toMatchObject({ ok: false, field: "firstName" });
    expect(parseRecoveryRequest({ ...good, email: "nope" }, NOW)).toMatchObject({ ok: false, field: "email" });
    expect(parseRecoveryRequest({ ...good, dateOfBirth: "2030-01-01" }, NOW)).toMatchObject({ ok: false, field: "dateOfBirth" });
    expect(parseRecoveryRequest({ ...good, recoveryEmail: "bad" }, NOW)).toMatchObject({ ok: false, field: "recoveryEmail" });
  });

  it("asks for a manual check and never claims a reset", () => {
    const parsed = parseRecoveryRequest({ ...good, lastPassword: "old one" }, NOW);
    if (!parsed.ok) throw new Error("expected ok");
    const mail = recoveryMail(parsed.request, { ip: "net-1", at: NOW });
    expect(mail.subject).toContain("account recovery");
    const text = mail.lines.join("\n");
    expect(text).toContain("nothing has been reset or unlocked");
    expect(text).toContain("Last remembered password: old one");
    expect(text).toContain("Date of birth: 2010-05-01");
  });
});

const sent = vi.hoisted(() => ({ result: "sent" as "sent" | "failed" | "skipped", calls: 0 }));
vi.mock("../feedback/inbox-mail", () => ({ mailFeedbackInbox: async () => { sent.calls += 1; return sent.result; } }));

describe("POST /api/account-recovery", () => {
  beforeEach(() => { sent.result = "sent"; sent.calls = 0; });
  const post = async (body: unknown, ip = "1.2.3.4") => {
    const { POST } = await import("../../app/api/account-recovery/route");
    return POST(new Request("https://vantage.test/api/account-recovery", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  };

  it("emails the inboxes and says it was received", async () => {
    const response = await post(good, "10.0.0.1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent.calls).toBe(1);
  });

  it("answers a bot's hidden field without sending anything", async () => {
    const response = await post({ ...good, website: "spam" }, "10.0.0.2");
    expect(response.status).toBe(200);
    expect(sent.calls).toBe(0);
  });

  it("says plainly when the request could not be sent", async () => {
    sent.result = "failed";
    const response = await post(good, "10.0.0.3");
    expect(response.status).toBe(503);
  });
});
