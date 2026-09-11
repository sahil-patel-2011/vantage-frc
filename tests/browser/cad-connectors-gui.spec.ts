import { expect, test } from "@playwright/test";
import { loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Connectors, CAD connections, and pair pages stay student-usable", async ({ page }) => {
  await page.goto("/connectors");
  await expect(page.locator("body")).not.toContainText("Application error");
  const connectorsHeading = page.getByRole("heading", { level: 1, name: "Connectors" });
  const connectorsTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  await expect(connectorsHeading.or(connectorsTeam).or(loadFailureHeading(page))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
  await expect(page.getByText("CLIENT_SECRET")).toHaveCount(0);
  await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);

  await page.goto("/cad/connections");
  await expect(page.locator("body")).not.toContainText("Application error");
  const connectionsHeading = page.getByRole("heading", { level: 1, name: "CAD connections" });
  const connectionsTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  await expect(connectionsHeading.or(connectionsTeam).or(loadFailureHeading(page))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
  await expect(page.getByText("CLIENT_SECRET")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);

  await page.goto("/cad/pair");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: /Pair this computer/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Organization / workspace")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);
  await expect(
    page.locator("label", { hasText: /^Team$/ }).or(page.getByRole("link", { name: "Choose your team" })),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve pairing" }).or(page.getByRole("link", { name: "Choose your team" })),
  ).toBeVisible();

  await page.goto("/editor/pair");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: "Pair VS Code" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Organization / workspace")).toHaveCount(0);
  await expect(
    page
      .locator("label", { hasText: /^Team$/ })
      .or(page.getByRole("heading", { name: "Choose your team" }))
      .or(page.getByRole("link", { name: "Choose your team" })),
  ).toBeVisible();
});
