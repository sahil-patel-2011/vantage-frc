import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Pick a team", "Stripe", "OAuth", "ONSHAPE_"];

const ROUTES = [
  "/impact",
  "/team/awards",
  "/impact-essay",
  "/outreach-calendar",
  "/judge-sim",
  "/award-tracker",
  "/mock-judging",
] as const;

async function openStudentPage(page: Parameters<typeof waitForLoadingGone>[0], path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
}

test("Impact / community student boards keep Needs setup and skip invented scoreboards", async ({
  page,
}) => {
  test.setTimeout(120_000);

  for (const route of ROUTES) {
    await openStudentPage(page, route);
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }

    const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
    if ((await chooseTeam.count()) > 0 && (await chooseTeam.isVisible())) {
      await expect(page.getByText("Needs setup")).toBeVisible();
      await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    }
  }
});
