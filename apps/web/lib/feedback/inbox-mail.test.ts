import { describe, expect, it, vi } from "vitest";

vi.mock("@vantage/core", () => ({
  configuredPlatformOwnerEmail: () => "owner@example.test",
  createEmailProvider: () => ({ name: "unconfigured", sendFreeform: vi.fn() }),
  resolveAuthBaseURL: () => "https://vantagefrc.vercel.app",
}));

const { FEEDBACK_INBOX, FEEDBACK_INBOXES, feedbackInbox, feedbackInboxes, feedbackMailText, feedbackRecipients, mailFeedbackInbox } = await import("./inbox-mail");

describe("feedback inbox", () => {
  it("sends help and feedback to vantagefrc@mail.grokbot.com unless a deployment overrides it", () => {
    expect(FEEDBACK_INBOX).toBe("vantagefrc@mail.grokbot.com");
    expect(feedbackInbox({} as NodeJS.ProcessEnv)).toBe(FEEDBACK_INBOX);
    expect(feedbackInbox({ FEEDBACK_INBOX_EMAIL: " Help@Example.Test " } as NodeJS.ProcessEnv)).toBe("help@example.test");
    expect(feedbackInbox({ FEEDBACK_INBOX_EMAIL: "not an address" } as NodeJS.ProcessEnv)).toBe(FEEDBACK_INBOX);
  });

  it("goes to all three Vantage inboxes, or the deployment's own list", () => {
    expect(FEEDBACK_INBOXES).toEqual(["vantagefrc@mail.grokbot.com", "vantagefrc@gmail.com", "sahiljpatel2011@gmail.com"]);
    expect(feedbackInboxes({} as NodeJS.ProcessEnv)).toEqual([...FEEDBACK_INBOXES]);
    expect(feedbackInboxes({ FEEDBACK_INBOX_EMAIL: "a@x.test, b@x.test, nope" } as NodeJS.ProcessEnv)).toEqual(["a@x.test", "b@x.test"]);
  });

  it("copies the platform owner on support tickets only", () => {
    expect(feedbackRecipients({ includeOwner: false }, {} as NodeJS.ProcessEnv)).toEqual([...FEEDBACK_INBOXES]);
    expect(feedbackRecipients({ includeOwner: true }, {} as NodeJS.ProcessEnv)).toEqual([...FEEDBACK_INBOXES, "owner@example.test"]);
  });

  it("drops empty lines but keeps blank spacer lines", () => {
    expect(feedbackMailText({ subject: "s", lines: ["a", null, "", false, undefined, "b"] })).toBe("a\n\nb");
  });

  it("never throws or sends when email isn't set up or outside production", async () => {
    await expect(mailFeedbackInbox({ subject: "s", lines: ["x"] })).resolves.toBe("skipped");
  });
});
