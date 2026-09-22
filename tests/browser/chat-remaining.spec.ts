import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = [
  "Setup required",
  "FRC Assistant",
  "AI provider not configured",
  "Configure an AI provider key",
  "UsageCutoffBanner",
];

test("Chat remaining student chrome keeps one primary and drops leftover copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/chat");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");

  /*
    `/chat` redirects into the AI hub, and the hub supplies the page's h1 and
    hides the feature's own with `display:none` — which takes it out of the
    accessibility tree too, so an h1 named "Chat" is not something a person or
    this spec can find. Asking for one was asking the page to be built the way
    it was before the hubs.

    What is actually true, and what a student needs, is that the chat surface
    is on screen under a heading. That is what this waits for.
  */
  const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: /AI|Chat/ });
  const surface = page.locator(".ch-page");
  const chooseTeam = page.getByRole("heading", { name: "Choose your team" });
  await expect(heading.or(surface).or(chooseTeam).first()).toBeVisible();

  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Chat still shows ${phrase}`).not.toContainText(phrase);
  }

  if (await chooseTeam.isVisible()) {
    await expect(page.getByText("Needs setup", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    return;
  }

  await expect(heading.or(surface).first()).toBeVisible();

  /*
    The feature's own "related tools" strip is hidden inside the hub, on
    purpose: the hub's tab bar already navigates, and two rows of links to the
    same places is the duplication the hubs were built to remove. So this
    checks the strip still *points* at the right places — it is the fallback
    if this page is ever rendered on its own — and separately that the hub
    navigation a student actually uses is on screen.
  */
  // A DOM locator, not a role one: the strip is `display:none` inside the
  // hub, which takes it out of the accessibility tree, so `getByRole` cannot
  // see it by design. That is the right behaviour and the wrong tool.
  await expect(page.locator(".ch-related a").first()).toBeAttached({ timeout: 20_000 });
  const relatedLinks = await page.locator(".ch-related a").allTextContents();
  for (const label of ["Budgets", "Memory", "Strategy"]) {
    expect(relatedLinks.map((text) => text.trim()), `.ch-related is missing ${label}`).toContain(
      label,
    );
  }
  // Somewhere on screen there is a way to the rest of the product. Which
  // element carries it — the hub rail, the primary-app bar — is a layout
  // decision that has changed before and will again; that a student can leave
  // this page is not.
  // On a phone the hub rail is a closed drawer — present but hidden — and the
  // primary-app bar is the one on screen. Either counts; what must not happen
  // is both being hidden.
  const wayOut = page
    .locator('nav[aria-label="Hubs"], nav[aria-label="Primary apps"]')
    .locator("visible=true");
  await expect(wayOut.first()).toBeVisible({ timeout: 20_000 });

  const empty = page.getByRole("button", { name: "New private chat" });
  if (await empty.count()) {
    await expect(empty).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Private chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Team-shared chat" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enable" })).toHaveCount(0);
    await expect(page.locator(".ch-empty-actions a")).toHaveCount(0);
  }

  const setup = page.getByText("Needs setup", { exact: true });
  if (await setup.isVisible().catch(() => false)) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("link", { name: "Connect Claude Code" })).toHaveCount(1);
  }
});
