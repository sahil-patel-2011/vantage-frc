import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Files hub still loads after the panel split", async ({ page }) => {
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: "Loading your files…" })).toBeHidden({ timeout: 20_000 });

  const spaces = page.getByRole("navigation", { name: "File spaces" });
  const recovery = page.getByRole("heading", { name: "Files needs a database" });
  await expect(spaces.or(recovery)).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "Who can see what" })).toBeVisible();
  await expect(page.getByText("A share link works without a Vantage account.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related files tools" }).getByRole("link", { name: "Playbook" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related files tools" }).getByRole("link", { name: "Team chat" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related files tools" }).getByRole("link", { name: "CAD" })).toBeVisible();

  if ((await spaces.count()) === 0) {
    return;
  }

  await expect(spaces.getByRole("button", { name: /My files/ })).toBeVisible();
  await expect(spaces.getByRole("button", { name: /Team files/ })).toBeVisible();
  await expect(spaces.getByRole("tab")).toHaveCount(0);

  await spaces.getByRole("button", { name: /My files/ }).click();
  await expect(spaces.getByRole("button", { name: /My files/ })).toHaveAttribute("aria-current", "page");
  await spaces.getByRole("button", { name: /Team files/ }).click();

  if (process.env.FILES_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/files-after-split.png", fullPage: true });
  }
});
