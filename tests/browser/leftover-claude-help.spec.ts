import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Your Claude Code Help drops CLI on the AI subscription bridge article", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/ai-bridge");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /AI subscription bridge|Your Claude Code|Choose your team|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Claude Code CLI", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("Codex CLI", {
    ignoreCase: false,
  });
  await expect(page.locator("body")).not.toContainText("AI subscription bridge —", {
    ignoreCase: false,
  });
});
