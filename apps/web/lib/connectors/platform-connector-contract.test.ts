/**
 * The two connectors nobody clicks Connect on — email delivery and Stripe.
 *
 * They have no OAuth dance and no per-team row, so the only thing that can be
 * wrong is the answer they give when they are unconfigured. Both gave a bad
 * one: email reported plain `available` outside production even though nothing
 * is delivered, and Stripe's webhook answered a missing secret with exactly the
 * body and status it uses for a forged payload.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emailNotificationsSetupStatus } from "@vantage/core";
import { isStripeNotConfigured, StripeNotConfiguredError, stripeMissingEnv } from "@vantage/billing";
import { describeConnector, connectorById } from "./catalog";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("email delivery status", () => {
  it("admits that a development build delivers nothing, however it is configured", () => {
    const status = emailNotificationsSetupStatus();
    expect(status.detail).toMatch(/NOT delivered/);
    expect(status.missingEnv).toEqual(["RESEND_API_KEY", "AUTH_EMAIL_FROM"]);
  });

  it("still says nothing is delivered in development even with Resend credentials present", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.AUTH_EMAIL_FROM = "Vantage <a@b.org>";
    const status = emailNotificationsSetupStatus();
    expect(status.missingEnv).toEqual([]);
    expect(status.detail).toMatch(/NOT delivered/);
  });

  it("names the variables, the location, the console and the domain step in production", () => {
    const previous = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    try {
      const status = emailNotificationsSetupStatus();
      expect(status.status).toBe("setup_required");
      expect(status.missingEnv).toEqual(["RESEND_API_KEY", "AUTH_EMAIL_FROM"]);
      expect(status.detail).toContain("RESEND_API_KEY and AUTH_EMAIL_FROM");
      expect(status.detail).toContain("Environment Variables");
      expect(status.detail).toContain("resend.com");
      expect(status.detail).toContain("Domains");
      expect(status.detail).toMatch(/no callback URL/i);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: previous, configurable: true });
    }
  });

  it("keeps warning about domain verification once configured — the silent-drop failure", () => {
    const previous = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    process.env.RESEND_API_KEY = "re_x";
    process.env.AUTH_EMAIL_FROM = "Vantage <a@b.org>";
    try {
      const status = emailNotificationsSetupStatus();
      expect(status.status).toBe("available");
      expect(status.detail).toMatch(/verified/);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: previous, configurable: true });
    }
  });

  it("names what stops arriving, so the reader knows what they are missing", () => {
    const previous = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    try {
      expect(emailNotificationsSetupStatus().detail).toMatch(/invites, dues reminders/i);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: previous, configurable: true });
    }
  });
});

describe("Stripe not-configured is its own failure, not a bad signature", () => {
  it("lists the missing variables in dashboard order", () => {
    expect(stripeMissingEnv({} as NodeJS.ProcessEnv)).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(stripeMissingEnv({ STRIPE_SECRET_KEY: "sk" } as NodeJS.ProcessEnv)).toEqual([
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(
      stripeMissingEnv({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "whsec" } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("treats a whitespace-only key as unset rather than handing Stripe a blank secret", () => {
    expect(stripeMissingEnv({ STRIPE_SECRET_KEY: "  ", STRIPE_WEBHOOK_SECRET: "whsec" } as NodeJS.ProcessEnv)).toEqual([
      "STRIPE_SECRET_KEY",
    ]);
  });

  it("is recognisable so the webhook can answer 503 instead of 400", () => {
    const error = new StripeNotConfiguredError(["STRIPE_WEBHOOK_SECRET"]);
    expect(isStripeNotConfigured(error)).toBe(true);
    expect(isStripeNotConfigured(new Error("Invalid signature"))).toBe(false);
  });

  it("names both consoles, because the two secrets come from different screens", () => {
    const message = new StripeNotConfiguredError(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]).message;
    expect(message).toContain("Developers → API keys");
    expect(message).toContain("Developers → Webhooks");
    expect(message).toContain("Environment Variables");
    expect(message).toContain("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
  });

  it("carries the missing list so a caller can render it as chips", () => {
    expect(new StripeNotConfiguredError(["STRIPE_SECRET_KEY"]).missingEnv).toEqual(["STRIPE_SECRET_KEY"]);
  });
});

describe("the connectors page agrees with each connector's own setup check", () => {
  it("gives Stripe the webhook endpoint URL to register", () => {
    const status = describeConnector(connectorById("stripe"), {
      BETTER_AUTH_URL: "https://vantage.example.com",
    });
    expect(status.callbackUrl).toBe("https://vantage.example.com/api/stripe/webhook");
    expect(status.permissions).toContain("checkout.session.completed");
    expect(status.statusLine).toBe("Not configured — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
  });

  it("gives email no callback URL and points at the Resend consoles", () => {
    const status = describeConnector(connectorById("email"), {
      BETTER_AUTH_URL: "https://vantage.example.com",
    });
    expect(status.callbackUrl).toBeNull();
    expect(status.detail).toContain("resend.com");
    expect(status.statusLine).toBe("Not configured — set RESEND_API_KEY and AUTH_EMAIL_FROM");
  });

  it("uses the same variable names as the runtime checks — a drift guard", () => {
    const stripe = describeConnector(connectorById("stripe"), {});
    expect(stripe.missingEnv).toEqual(stripeMissingEnv({} as NodeJS.ProcessEnv));
    const email = describeConnector(connectorById("email"), {});
    expect(email.missingEnv).toEqual(emailNotificationsSetupStatus().missingEnv);
  });
});
