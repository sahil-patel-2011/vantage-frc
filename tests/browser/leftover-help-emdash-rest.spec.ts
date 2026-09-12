import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Edit Home Parts catalog Team agent config and Reimbursements drop em-dash titles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/help/edit-home");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Edit Home|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Edit Home —", {
    ignoreCase: false,
  });
  await page.goto("/help/parts-catalog");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Parts catalog|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Parts catalog —", {
    ignoreCase: false,
  });
  await page.goto("/help/agent-config");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Team agent config|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Team agent config —", {
    ignoreCase: false,
  });
  await page.goto("/help/reimbursements");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(
    /Reimbursements|Choose your team|Needs setup|Your session ended|Sign in|Help/,
  );
  await expect(page.locator("body")).not.toContainText("Reimbursements —", {
    ignoreCase: false,
  });
});
