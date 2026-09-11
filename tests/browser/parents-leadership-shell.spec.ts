import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const LEAVES = [
  {
    path: "/parents",
    heading: "Parent updates",
    related: "Related team tools",
    relatedBits: ["Calendar", "People", "Forms"],
  },
  {
    path: "/leadership",
    heading: "Leadership Continuity",
    related: "Related team tools",
    relatedBits: ["Season roles", "Skills", "Safety"],
  },
] as const;

for (const leaf of LEAVES) {
  test(`${leaf.path} is student-readable with Needs setup, not a blank board`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(leaf.path, { waitUntil: "domcontentloaded" });
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Setup required");
    const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading });
    const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
      await page.screenshot({
        path: `/opt/cursor/artifacts/${leaf.path.slice(1)}-student-readable.png`,
        fullPage: true,
      });
      return;
    }
    await expect(heading.first()).toBeVisible();
    const related = page.getByRole("navigation", { name: leaf.related });
    await expect(related).toBeVisible();
    for (const bit of leaf.relatedBits) {
      await expect(related).toContainText(bit);
    }
    const chooseTeam = page.getByRole("link", { name: "Choose your team" });
    if ((await chooseTeam.count()) > 0) {
      await expect(chooseTeam).toHaveCount(1);
      await expect(page.getByText("Needs setup").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    } else if (await page.getByRole("heading", { name: "Add your first leadership role" }).isVisible()) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    } else if (await page.getByRole("heading", { name: "Add a parent contact" }).isVisible()) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    }
  });
}
