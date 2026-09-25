import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";
import { expectPausedPage, mediaPaused } from "./media-paused";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Hard cut-off", "Hosted by Vantage", "3D Print Farm", "Inspection copilot"];

const LEAVES = [
  { path: "/team/usage", heading: /AI usage|Where the team's AI spend goes|Choose your team|Usage/ },
  /*
    /team/budgets redirects into the AI hub, which supplies the page's h1 and
    hides the feature's own with display:none — so the page title is not
    something a person or a role locator can find there. This entry passed
    only when the org had not resolved yet and the team gate was briefly on
    screen, which is to say it passed by accident and failed the rest of the
    time.

    Every other leaf here shows its own heading; this is the one that does
    not, so it names what the tab actually puts on screen.
  */
  { path: "/team/budgets", heading: /Team AI limits|An owner or mentor sets the AI limits|Choose your team/ },
  { path: "/files", heading: "Files" },
  // A media tool: the paused page while media is switched off.
  { path: "/media", heading: "Media", pausedAs: "Media" },
  { path: "/help", heading: "Help centre" },
  { path: "/whats-new", heading: "What’s new" },
  { path: "/print-farm", heading: "Print farm" },
  { path: "/team/knowledge", heading: /Playbook|Team|Choose your team/ },
  { path: "/inspection", heading: /Inspection|Robot Inspection/ },
  { path: "/scout-accuracy", heading: /Scout Accuracy|Choose your team/ },
] as const;

test("leftover-product boards speak student chrome", async ({ page }) => {
  test.setTimeout(180_000);
  for (const leaf of LEAVES) {
    await page.goto(leaf.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    if (mediaPaused && "pausedAs" in leaf) {
      await expectPausedPage(page, leaf.pausedAs);
      continue;
    }
    await expect(page.getByRole("heading", { name: leaf.heading }).first()).toBeVisible();
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
    }
    const setup = page.getByText("Needs setup", { exact: true });
    if (await setup.isVisible().catch(() => false)) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
      const choose = page.locator("main").getByRole("link", { name: "Choose your team" });
      if (await choose.count()) {
        await expect(choose).toHaveCount(1);
      }
    }
  }
});
