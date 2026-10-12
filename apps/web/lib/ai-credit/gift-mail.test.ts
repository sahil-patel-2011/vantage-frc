import { describe, expect, it, vi } from "vitest";

vi.mock("@vantage/db", () => ({ withRls: vi.fn() }));
vi.mock("@vantage/core", () => ({
  createEmailProvider: () => ({ name: "unconfigured" }),
  resolveAuthBaseURL: () => "https://vantage.example",
}));

const { emailGiftNotice, giftEmailText } = await import("./gift-mail");

const gift = { amountUsd: 10, usedUsd: 8.25, familyLabel: "Claude Sonnet 5.5 and Opus 5.5" };

describe("gift emails", () => {
  it("say what was given, that it stops at the amount, and link to AI settings", () => {
    const granted = giftEmailText("granted", { ...gift, usedUsd: 0, note: "Good luck!", expiresAt: "2026-12-31T23:59:59Z" }, "https://vantage.example/");
    expect(granted.subject).toBe("Vantage gave your team $10 of AI credit");
    expect(granted.text).toContain("until December 31, 2026");
    expect(granted.text).toContain("It stops at $10, so there is never a bill.");
    expect(granted.text).toContain("Note from Vantage: Good luck!");
    expect(granted.text).toContain("https://vantage.example/team/ai-keys");
  });

  it("at 80% and when used up, give the numbers and what to do next", () => {
    expect(giftEmailText("80", gift, "https://x").text).toContain("$8.25 of $10.00");
    const usedUp = giftEmailText("exhausted", { ...gift, usedUsd: 10 }, "https://x");
    expect(usedUp.subject).toBe("Your free AI credit from Vantage is used up");
    expect(usedUp.text).toMatch(/Add your own AI key/);
  });

  it("is skipped quietly when no mail is set up", async () => {
    const client = { query: vi.fn() };
    expect(await emailGiftNotice(client, { orgId: "o", kind: "granted", gift }, { name: "unconfigured" } as never)).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("sends one to each owner and admin, and one bad address doesn't stop the rest", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ email: "owner@example.test" }, { email: "bad@example.test" }, { email: "mentor@example.test" }] })) };
    const sent: string[] = [];
    const provider = {
      name: "resend",
      sendFreeform: vi.fn(async (mail: { to: string }) => {
        if (mail.to.startsWith("bad")) throw new Error("rejected");
        sent.push(mail.to);
      }),
    };
    expect(await emailGiftNotice(client, { orgId: "o", kind: "80", gift }, provider as never)).toBe(2);
    expect(sent).toEqual(["owner@example.test", "mentor@example.test"]);
    expect(String(client.query.mock.calls[0]![0])).toMatch(/m\.role IN \('owner', 'admin'\)/);
  });
});
