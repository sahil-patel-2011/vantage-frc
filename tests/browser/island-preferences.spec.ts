import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

// The stock pins: the sidebar's Pinned group on a computer, the top of search on a phone.
const defaults = [
  "/dashboard", "/competition?tab=scouting", "/competition?tab=teams", "/competition?tab=strategy",
  "/competition?tab=my-day", "/team?tab=todos", "/learn/team",
];
// Match plan un-pinned and Stats pinned at the end.
const personal = [...defaults.filter(href => href !== "/competition?tab=strategy"), "/rankings"];

// From 1100px up the sidebar's Pinned group carries the pins and the pencil that edits them.
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ context }) => { expect(await signInAs(context, "owner")).toBe(true); });

for (const phase of ["editing", "saved"] as const) {
  test(`late preference loading preserves ${phase} pins`, async ({ page }) => {
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
    await page.getByRole("button", { name: "Edit pinned places", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Pinned" });
    await editor.getByRole("button", { name: "Remove Match plan", exact: true }).click();
    await editor.getByRole("button", { name: "Pin Stats", exact: true }).click();
    if (phase === "saved") await editor.getByRole("button", { name: "Done", exact: true }).click();
    const finished = page.waitForResponse(response => response.url().endsWith("/api/navigation/preferences") && response.request().method() === "GET");
    release();
    await finished;
    if (phase === "editing") {
      // The late answer must not wipe the draft being edited.
      await expect(editor.locator(".pins-editor-list li")).toHaveCount(personal.length);
      await expect(editor.getByRole("button", { name: "Remove Stats", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Remove Match plan", exact: true })).toHaveCount(0);
      await editor.getByRole("button", { name: "Done", exact: true }).click();
    }
    await expect(editor).toBeHidden();
    // Home is one of the five places, so Pinned does not repeat it.
    const pinned = page.getByRole("navigation", { name: "Pinned", exact: true });
    await expect(pinned.getByRole("link")).toHaveText(["Scout", "Teams", "My Day", "Tasks", "Team resources", "Stats"]);
    await expect(pinned.getByRole("link", { name: "Match plan", exact: true })).toHaveCount(0);
  });
}

test("a saved app unavailable to this team can be removed without granting access", async ({ page }) => {
  await page.route("**/api/me**", route => route.fulfill({ json: {
    authenticated: true, userId: "island-fixture-person", orgId: "island-fixture-team", role: "scout", name: "Island fixture",
    memberships: [{ orgId: "island-fixture-team", orgName: "Island fixture", role: "scout" }],
    hubAccess: [{ hubId: "competition", allowedTabIds: [] }, { hubId: "team", allowedTabIds: [] }],
  } }));
  await page.route("**/api/navigation/preferences", route => route.fulfill({ json: { tabs: [...defaults.slice(0, 3), "/build"] } }));
  const preferences = page.waitForResponse(response => response.url().endsWith("/api/navigation/preferences") && response.request().method() === "GET");
  await page.goto("/dashboard");
  expect((await preferences).ok()).toBe(true);
  // Wait until the saved choices are applied before opening their editor. The
  // separate late-loading stories above intentionally preserve an open draft.
  const pinned = page.getByRole("navigation", { name: "Pinned", exact: true });
  await expect(pinned).toBeVisible();
  await expect(pinned.getByRole("link", { name: "Build", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit pinned places", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Pinned" });
  const unavailable = editor.locator(".pins-editor-list li").filter({ hasText: "Not on this team" });
  await expect(unavailable).toHaveCount(1);
  await expect(unavailable).toContainText("Build");
  await expect(editor.getByRole("link", { name: "Build", exact: true })).toHaveCount(0);
  // Nothing this team can't open is offered to pin.
  await expect(editor.getByRole("button", { name: "Pin Kickoff", exact: true })).toHaveCount(0);
  const remove = editor.getByRole("button", { name: "Remove Build", exact: true });
  await remove.press("Enter");
  await expect(remove).toHaveCount(0);
  await expect(editor.locator(".pins-editor-list li")).toHaveCount(3);
  await expect(editor.getByRole("button", { name: "Pin Team chat", exact: true })).toBeEnabled();
  // Focus stays in the list, on the row that took the removed one's place.
  await expect(editor.getByRole("button", { name: "Remove Teams", exact: true })).toBeFocused();
});
