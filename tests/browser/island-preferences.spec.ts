import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

const defaults = ["/dashboard", "/competition?tab=scouting", "/competition?tab=teams", "/competition?tab=strategy"];
const personal = [...defaults.slice(0, 3), "/team"];

// The four-app bottom bar is the phone layout; from 1024px up the left rail carries the apps.
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ context }) => { expect(await signInAs(context, "owner")).toBe(true); });

for (const phase of ["editing", "saved"] as const) {
  test(`late preference loading preserves ${phase} island choices`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let loading = false;
    await page.route("**/api/navigation/preferences", async route => {
      if (route.request().method() === "GET") {
        loading = true;
        await held;
        await route.fulfill({ json: { tabs: defaults } });
      } else {
        expect(route.request().postDataJSON().tabs).toEqual(personal);
        await route.fulfill({ json: { tabs: personal } });
      }
    });
    await page.goto("/dashboard");
    await expect.poll(() => loading).toBe(true);
    await page.getByRole("navigation", { name: "Primary apps" }).click({ button: "right" });
    const editor = page.getByRole("dialog", { name: "Your four apps" });
    await editor.getByRole("button", { name: /^Match plan App/ }).click();
    await editor.getByRole("button", { name: /^Team Add$/ }).click();
    if (phase === "saved") await editor.getByRole("button", { name: "Save", exact: true }).click();
    const finished = page.waitForResponse(response => response.url().endsWith("/api/navigation/preferences") && response.request().method() === "GET");
    release();
    await finished;
    if (phase === "editing") {
      await expect(editor.getByRole("button", { name: /^Team App 4 of 4$/ })).toHaveAttribute("aria-pressed", "true");
      await expect(editor.getByRole("button", { name: /^Match plan Add$/ })).toHaveAttribute("aria-pressed", "false");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
    }
    await expect(editor).toBeHidden();
    const island = page.getByRole("navigation", { name: "Primary apps" });
    await expect(island.getByRole("link", { name: "Team", exact: true })).toBeVisible();
    await expect(island.getByRole("link", { name: "Match plan", exact: true })).toHaveCount(0);
  });
}

test("a saved app unavailable to this team can be removed without granting access", async ({ page }) => {
  await page.route("**/api/me**", route => route.fulfill({ json: {
    authenticated: true, userId: "island-fixture-person", orgId: "island-fixture-team", role: "scout", name: "Island fixture",
    memberships: [{ orgId: "island-fixture-team", orgName: "Island fixture", role: "scout" }],
    hubAccess: [{ hubId: "competition", allowedTabIds: [] }, { hubId: "team", allowedTabIds: [] }],
  } }));
  await page.route("**/api/navigation/preferences", route => route.fulfill({ json: { tabs: [...defaults.slice(0, 3), "/build"] } }));
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Primary apps" }).getByRole("link", { name: "Build", exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Primary apps" }).click({ button: "right" });
  const editor = page.getByRole("dialog", { name: "Your four apps" });
  const remove = editor.getByRole("button", { name: "Remove Build. Unavailable for this team.", exact: true });
  await expect(remove).toBeVisible();
  await expect(editor.getByRole("link", { name: "Build", exact: true })).toHaveCount(0);
  await remove.press("Enter");
  await expect(remove).toHaveCount(0);
  await expect(editor.locator(".soft-island-slot-preview")).toHaveAttribute("aria-label", "3 of 4 island apps selected");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: /^Team Add$/ })).toBeEnabled();
  await expect(editor.getByRole("button", { name: /^Home App/ })).toBeFocused();
});
