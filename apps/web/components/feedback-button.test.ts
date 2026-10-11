import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { FeedbackButton, FEEDBACK_THANKS_MS } = await import("./feedback-button");

const css = readFileSync(join(__dirname, "feedback-button.css"), "utf8");
const source = readFileSync(join(__dirname, "feedback-button.tsx"), "utf8");

const render = (props: { signedIn: boolean; orgId?: string | null }) =>
  renderToStaticMarkup(createElement(FeedbackButton, props));

describe("the corner button", () => {
  it("is a named round button for a signed-in person on a working page", () => {
    nav.pathname = "/dashboard";
    const html = render({ signedIn: true });
    expect(html).toContain('class="feedback-fab"');
    expect(html).toContain('aria-label="Send feedback"');
    expect(html).toContain('title="Send feedback"');
    expect(html).toContain('aria-haspopup="dialog"');
    // Line-art bug in currentColor, about 20px.
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('width="20"');
    // The dialog is not on the page until it is opened.
    expect(html).not.toContain('role="dialog"');
  });

  it("is not there for someone who is signed out", () => {
    nav.pathname = "/dashboard";
    expect(render({ signedIn: false })).not.toContain("feedback-fab");
  });

  it("is not there on focused task screens or entry pages", () => {
    for (const pathname of ["/scout/match", "/scout/pit", "/hours/kiosk", "/onboarding", "/signin", "/", null]) {
      nav.pathname = pathname;
      expect(render({ signedIn: true }), String(pathname)).not.toContain("feedback-fab");
    }
  });
});

describe("the dialog's contract", () => {
  it("closes itself 1.5 seconds after the thanks", () => {
    expect(FEEDBACK_THANKS_MS).toBe(1500);
    expect(source).toContain("Thanks — we got it.");
  });

  it("is the shared Modal: focus trap, Escape, and focus back to the button", () => {
    expect(source).toContain('from "./ui/modal"');
    expect(source).toContain('title="Send feedback"');
    expect(source).toContain("hideClose");
    expect(source).toContain("data-autofocus");
  });

  it("asks with the words from the brief", () => {
    expect(source).toContain("BUG_KIND_LABELS[value]");
    expect(source).toContain("BUG_KIND_PLACEHOLDERS[kind]");
    expect(source).toContain("It goes to the Vantage");
    expect(source).toContain("not your team.");
    expect(source).toContain("Cancel");
    expect(source).toContain('type="submit"');
  });

  it("shows a character count only near the limit", () => {
    expect(source).toContain("Math.floor(BUG_DESCRIPTION_MAX * 0.9)");
    expect(source).toContain("{nearLimit ?");
  });
});

describe("the stylesheet's promises", () => {
  it("steps aside while a dialog or the menu is up, and on the phone scouting form", () => {
    expect(css).toContain('[role="dialog"][aria-modal="true"]:not(.tour-root)');
    expect(css).toContain("body.has-app-shell.soft-nav-open .feedback-fab");
    expect(css).toContain("body.has-app-shell.is-scouting-form .feedback-fab");
  });

  it("hides during the tour until its last stop points at the button", () => {
    expect(css).toContain('[data-tour-step]:not([data-tour-step="feedback"]) .feedback-fab');
  });

  it("sits above the bottom bar on a phone and clear of the safe area", () => {
    expect(css).toContain("var(--island-clearance, 80px)");
    expect(css).toContain("env(safe-area-inset-right");
    expect(css).toContain("var(--safe-bottom");
    expect(css).toContain("@media (max-width: 1099.98px)");
  });

  it("is hidden when printing, and only inside the app frame", () => {
    expect(css).toMatch(/@media print\s*{\s*\.feedback-fab\s*{\s*display: none !important;/);
    expect(css).toMatch(/\.feedback-fab\s*{\s*display: none;\s*}/);
    expect(css).toContain("body.has-app-shell .feedback-fab {");
  });

  it("moves only on the shared motion tokens, and stands still for reduced motion", () => {
    expect(css).not.toMatch(/cubic-bezier\(/);
    expect(css).toContain("var(--dur-press) var(--ease-spring)");
    expect(css).toContain("scale: 0.94");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain('html[data-motion="reduced"]');
  });

  it("keeps Send the same width while it shows the spinner", () => {
    expect(css).toContain(".feedback-send-label[data-sending] {\n  visibility: hidden;");
    expect(css).toContain("min-width: 84px");
  });

  it("uses 16px text in the box so a phone does not zoom", () => {
    expect(css).toMatch(/\.feedback-text\s*{[^}]*font: 400 16px/);
  });
});
