import { expect, type Page } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";

export type ChromeSnapshotLeaf = { path: string; heading: string };

export async function assertChromeSnapshotLeaf(
  page: Page,
  leaf: ChromeSnapshotLeaf,
): Promise<void> {
  await page.goto(leaf.path);
  await expect(page.locator("body")).not.toContainText("Application error");
  const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: leaf.heading });
  const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, heading, setup.or(unavailable)))) {
    await page.screenshot({
      path: `/opt/cursor/artifacts/${leaf.path.slice(1)}-last-snapshot.png`,
      fullPage: true,
    });
    return;
  }
  await expect(heading.first()).toBeVisible();
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
}
