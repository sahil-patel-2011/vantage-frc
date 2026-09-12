import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISCORD_COPY,
  ACCOUNT_EMAIL_COPY,
  ACCOUNT_GITHUB_COPY,
  ACCOUNT_GOOGLE_COPY,
  ACCOUNT_ONSHAPE_COPY,
  ACCOUNT_PHONE_COPY,
  ACCOUNT_TBA_COPY,
  accountApiCopyLeaks,
  accountDiscordDetail,
  accountGithubDetail,
  accountOnshapeDetail,
  studentEmailDelivery,
  studentPhoneOtp,
} from "./account-api-related";

const ALL_COPY = [
  ...Object.values(ACCOUNT_ONSHAPE_COPY),
  ...Object.values(ACCOUNT_GITHUB_COPY),
  ...Object.values(ACCOUNT_GOOGLE_COPY),
  ...Object.values(ACCOUNT_TBA_COPY),
  ...Object.values(ACCOUNT_DISCORD_COPY),
  ...Object.values(ACCOUNT_EMAIL_COPY),
  ...Object.values(ACCOUNT_PHONE_COPY),
];

describe("account API connector copy", () => {
  it("never names OAuth, env vars, or Select a workspace", () => {
    for (const text of ALL_COPY) {
      expect(accountApiCopyLeaks(text), text).toBe(false);
    }
  });

  it("asks a mentor when Onshape is not ready, without the packages/cad setup message", () => {
    expect(accountOnshapeDetail({ configured: false, connected: false, orgId: "org-1" })).toBe(
      ACCOUNT_ONSHAPE_COPY.setupRequired,
    );
    expect(accountOnshapeDetail({ configured: true, connected: true, orgId: "org-1" })).toBe(
      ACCOUNT_ONSHAPE_COPY.connected,
    );
    expect(accountOnshapeDetail({ configured: true, connected: false, orgId: null })).toBe(
      ACCOUNT_ONSHAPE_COPY.chooseTeam,
    );
    expect(accountOnshapeDetail({ configured: true, connected: false, orgId: "org-1" })).toBe(
      ACCOUNT_ONSHAPE_COPY.empty,
    );
  });

  it("keeps GitHub next steps on Invites without OAuth or PAT", () => {
    expect(accountGithubDetail({ configured: true, connected: true, orgId: "org-1" })).toBe(
      ACCOUNT_GITHUB_COPY.connected,
    );
    expect(accountGithubDetail({ configured: false, connected: false, orgId: null })).toBe(
      ACCOUNT_GITHUB_COPY.chooseTeam,
    );
    expect(accountGithubDetail({ configured: true, connected: false, orgId: "org-1" })).toBe(
      ACCOUNT_GITHUB_COPY.emptyConfigured,
    );
    expect(accountGithubDetail({ configured: false, connected: false, orgId: "org-1" })).toBe(
      ACCOUNT_GITHUB_COPY.emptyUnconfigured,
    );
  });

  it("strips Resend env names from email delivery for Account", () => {
    const setup = studentEmailDelivery({
      status: "setup_required",
      missingEnv: ["RESEND_API_KEY", "AUTH_EMAIL_FROM"],
      detail: "Set RESEND_API_KEY and AUTH_EMAIL_FROM.",
    });
    expect(setup.missingEnv).toEqual([]);
    expect(setup.detail).toBe(ACCOUNT_EMAIL_COPY.setupRequired);
    expect(accountApiCopyLeaks(setup.detail)).toBe(false);

    const local = studentEmailDelivery({
      status: "available",
      missingEnv: ["RESEND_API_KEY"],
      detail: "Development build: mail is written to an in-memory local mailbox and is NOT delivered to anyone.",
    });
    expect(local.detail).toBe(ACCOUNT_EMAIL_COPY.localOnly);

    const ready = studentEmailDelivery({
      status: "available",
      missingEnv: [],
      detail: "Resend is configured.",
    });
    expect(ready.detail).toBe(ACCOUNT_EMAIL_COPY.ready);
  });

  it("does not name Twilio in the phone-setup message", () => {
    expect(studentPhoneOtp({ configured: false }).message).toBe(ACCOUNT_PHONE_COPY.setupRequired);
    expect(studentPhoneOtp({ configured: true }).message).toBe(ACCOUNT_PHONE_COPY.ready);
    expect(accountApiCopyLeaks(studentPhoneOtp({ configured: false }).message)).toBe(false);
  });

  it("keeps Discord next steps off DISCORD_BOT_TOKEN", () => {
    expect(
      accountDiscordDetail({ canPost: true, hasWebhook: true, configured: true, orgId: "org-1" }),
    ).toBe(ACCOUNT_DISCORD_COPY.connectedWebhook);
    expect(
      accountDiscordDetail({ canPost: false, hasWebhook: false, configured: false, orgId: "org-1" }),
    ).toBe(ACCOUNT_DISCORD_COPY.setupRequired);
    expect(accountApiCopyLeaks(ACCOUNT_DISCORD_COPY.setupRequired)).toBe(false);
  });
});
