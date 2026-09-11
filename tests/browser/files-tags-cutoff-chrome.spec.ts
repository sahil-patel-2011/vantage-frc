import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Files, Drive-team tags, Help, and Account drop leftover engineering chrome", async ({
  page,
}) => {
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("body")).not.toContainText("Application error");
  const layout = page.getByRole("group", { name: "Layout" });
  if ((await layout.count()) > 0) {
    await expect(layout.getByRole("button", { name: "Grid" })).toBeVisible();
    await expect(layout.getByRole("button", { name: "List" })).toBeVisible();
  }
  await expect(page.getByText("HTTP")).toHaveCount(0);

  await page.goto("/team-tags");
  await expect(page.getByRole("heading", { name: "Drive-team tags" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Pairwise 2.0")).toHaveCount(0);
  await expect(page.getByText("object storage")).toHaveCount(0);

  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help centre" })).toBeVisible({
    timeout: 20_000,
  });
  const helpSearch = page.getByPlaceholder("e.g. library, pricing, scouting…");
  await expect(helpSearch).toBeVisible();
  await expect(helpSearch).not.toHaveAttribute("placeholder", /subscription|bridge/i);

  await page.goto("/account");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("SMS OTP is setup-required")).toHaveCount(0);
  await expect(page.getByText("Twilio env")).toHaveCount(0);
  await expect(page.getByText("Hard cut-off")).toHaveCount(0);
});
