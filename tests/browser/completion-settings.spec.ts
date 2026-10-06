import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { baseOrigin, signInAs } from "./session";
import { defaultIslandHrefs } from "../../apps/web/lib/nav/island-preferences";

const orgId = "6925a000-0000-4000-8000-000000000001";
test.beforeEach(async ({ context }) => { expect(await signInAs(context, "owner")).toBe(true); });

for (const width of [390, 1440]) {
  test(`display choices save without opening extra settings at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    const original = await (await context.request.get("/api/branding")).json();
    const theme = await (await context.request.get("/api/theme")).json();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await page.goto(`/account?tab=appearance&orgId=${orgId}`);
      const extras = page.locator("details.appearance-more").filter({ hasText: "More display settings" });
      await expect(page.getByRole("radio", { name: "Compact", exact: true })).toBeEnabled({ timeout: 30_000 });
      await expect(extras).not.toHaveAttribute("open");
      // Native radios: arrow keys choose the next setting, rather than tabbing to every card.
      await page.getByRole("radio", { name: "Comfortable", exact: true }).check();
      await page.getByRole("radio", { name: "Comfortable", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("radio", { name: "Compact", exact: true })).toBeChecked();
      const save = page.getByRole("button", { name: "Save appearance", exact: true });
      await expect(save).toBeVisible();
      await save.click();
      await expect(page.getByText("Saved to your profile — it follows you to every device.")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("radio", { name: "Compact", exact: true })).toBeChecked();
      await expect(extras).not.toHaveAttribute("open");
      await extras.locator("summary").press("Enter");
      for (const name of ["Clear", "Regular", "Solid"]) {
        await page.getByRole("radio", { name, exact: true }).check();
        if (name === "Regular") await expect(page.locator("html")).not.toHaveAttribute("data-clarity");
        else await expect(page.locator("html")).toHaveAttribute("data-clarity", name.toLowerCase());
      }
      for (const [name, value] of [["Reduced motion", "reduced"], ["Full motion", "full"]]) {
        await page.getByRole("radio", { name, exact: true }).check();
        if (value === "full") await expect(page.locator("html")).not.toHaveAttribute("data-motion");
        else await expect(page.locator("html")).toHaveAttribute("data-motion", value);
      }
      await save.click();
      await page.reload();
      await extras.locator("summary").press("Enter");
      await expect(page.getByRole("radio", { name: "Solid", exact: true })).toBeChecked();
      await expect(page.getByRole("radio", { name: "Full motion", exact: true })).toBeChecked();
      for (const name of ["Dark", "Light", "System"]) {
        await page.getByRole("radio", { name, exact: true }).check();
        await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
      }
      const result = await new AxeBuilder({ page }).include(".appearance-panel").analyze();
      expect(result.violations.map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      await extras.locator("summary").press("Enter");
      await page.screenshot({ path: info.outputPath(`appearance-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally {
      await context.request.put("/api/branding/appearance", { data: { appearance: original.appearance } });
      await context.request.put("/api/theme", { data: { theme: theme.theme ?? "light" } });
    }
  });
}

test("every code preference persists and a failed save offers a retry", async ({ page, context }) => {
  const original = await (await context.request.get("/api/account/cockpit")).json();
  try {
    await page.goto(`/account?tab=appearance&orgId=${orgId}`);
    await page.getByText("More display settings", { exact: true }).click();
    for (const name of ["Confirm before Bugbot opens a pull request", "Pause live boards (My Day, schedule, rankings) when this tab is hidden", "Include our own tests when Bugbot scans a repo"]) {
      const field = page.getByRole("checkbox", { name, exact: true });
      await field.setChecked(!await field.isChecked());
    }
    await page.getByLabel("Default Bugbot mode").selectOption("ultra");
    await page.getByLabel("Bugbot instructions").fill("Check the team's real robot code.");
    await page.route("**/api/account/cockpit", route => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Could not save. Try again." } }) : route.continue());
    await page.getByRole("button", { name: "Save code preferences", exact: true }).click();
    await expect(page.getByText("Could not save. Try again.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save code preferences", exact: true })).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: "Save code preferences", exact: true }).click();
    await expect(page.getByText("Saved. Bugbot and live boards will use these next time they load.")).toBeVisible();
    await page.reload();
    await page.getByText("More display settings", { exact: true }).click();
    await expect(page.getByLabel("Default Bugbot mode")).toHaveValue("ultra");
    await expect(page.getByLabel("Bugbot instructions")).toHaveValue("Check the team's real robot code.");
    const stored = await (await context.request.get("/api/account/cockpit")).json();
    for (const key of ["confirmWrites", "pauseLiveWhenHidden", "includeScanTests"] as const) expect(stored.cockpit[key]).toBe(!original.cockpit[key]);
  } finally { await context.request.put("/api/account/cockpit", { data: { cockpit: original.cockpit } }); }
});

test("bottom shortcuts preserve selection order, reload, and reset", async ({ page, context }) => {
  const original = await (await context.request.get("/api/navigation/preferences")).json();
  try {
    await page.goto(`/account?tab=appearance&orgId=${orgId}`);
    await page.getByText("More display settings", { exact: true }).click();
    const choices = page.locator(".appearance-island-grid");
    await expect(choices).toBeVisible();
    while (await choices.locator("button[aria-pressed=true]").count()) await choices.locator("button[aria-pressed=true]").first().click();
    const labels: string[] = [];
    for (const i of [4, 0, 1, 2]) {
      const choice = choices.getByRole("button").nth(i);
      labels.push(await choice.locator("strong").innerText());
      await choice.click();
    }
    await expect(choices.getByRole("button").nth(3)).toBeDisabled();
    await page.getByRole("button", { name: "Save 4/4", exact: true }).click();
    await expect(page.getByText("Shortcuts saved.", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByText("More display settings", { exact: true }).click();
    await expect(page.locator(".appearance-island-slots > span")).toHaveText(labels);
    const reset = page.getByRole("button", { name: "Reset shortcuts", exact: true });
    if (await reset.isEnabled()) {
      await reset.click();
      await expect(page.getByText(/^Shortcuts reset to /)).toBeVisible();
      await page.reload();
      await page.getByText("More display settings", { exact: true }).click();
      await expect(reset).toBeDisabled();
    }
  } finally { expect((await context.request.put("/api/navigation/preferences", { data: { tabs: original.tabs ?? defaultIslandHrefs() } })).ok()).toBe(true); }
});

test("appearance loading failure preserves saved settings until retry", async ({ page, context }) => {
  // On a local dev server this compiles the account API before testing a
  // specific appearance failure, rather than timing out on an unrelated load.
  expect((await context.request.get("/api/account")).ok()).toBe(true);
  await page.route("**/api/branding", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`/account?tab=appearance&orgId=${orgId}`);
  await expect(page.getByRole("button", { name: "Retry appearance", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("radio", { name: "Compact", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save appearance", exact: true })).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Retry appearance", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Compact", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Retry appearance", exact: true })).toBeHidden();
});

test("command copying confirms actual clipboard success and permits retry", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { clipboardFixtureReady?: boolean }).clipboardFixtureReady = true;
    let attempts = 0;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => {
      if (++attempts === 1) throw new Error("Clipboard permission denied");
      (window as Window & { copiedCommand?: string }).copiedCommand = text;
    } } });
  });
  await page.goto("/dev-setup");
  const code = page.locator(".ds-code").first();
  await page.waitForFunction(() => (window as Window & { clipboardFixtureReady?: boolean }).clipboardFixtureReady === true);
  await code.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(code.getByRole("alert")).toContainText("Could not copy.");
  await expect(code.getByRole("button", { name: "Copied", exact: true })).toHaveCount(0);
  await code.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(code.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { copiedCommand?: string }).copiedCommand)).toBe(await code.locator("pre").innerText());
});

test("old setup links recover only for members and a missing board link has a useful next step", async ({ page }) => {
  await page.goto(`/team-setup?orgId=${orgId}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard\\?orgId=${orgId}`));
  const unrelated = await page.goto(`/team-setup?orgId=${randomUUID()}`);
  expect(unrelated?.status()).toBe(404);
  await page.goto(`/strategy/board?orgId=${orgId}`);
  await expect(page.getByRole("heading", { name: "Open a shared alliance board", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open pick list", exact: true }).click();
  await expect(page).toHaveURL(/\/competition\?tab=picks/);
});

test("every notification switch saves immediately and survives reload", async ({ page, context }) => {
  test.setTimeout(120_000);
  const original = await (await context.request.get("/api/notifications/preferences")).json();
  try {
    await page.goto("/notifications/preferences");
    await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
    const switches = page.locator(".account-prefs input[type=checkbox]");
    const before: boolean[] = [];
    for (let i = 0; i < await switches.count(); i++) {
      const field = switches.nth(i);
      before.push(await field.isChecked());
      const saved = page.waitForResponse(response => response.url().endsWith("/api/account") && response.request().method() === "PUT");
      await field.setChecked(!before[i]);
      expect((await saved).ok()).toBe(true);
    }
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.reload();
    for (let i = 0; i < before.length; i++) await expect(switches.nth(i)).toBeChecked({ checked: !before[i] });
  } finally {
    await context.request.put("/api/account", { data: { notificationPrefs: original.notificationPrefs, emailPrefs: original.emailPrefs } });
  }
});

test("alliance edits stay inside their slot and survive a reload", async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const database = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
  expect(database.pathname).toMatch(/(?:_test_|^\/vantage_ci$)/);
  const pool = new Pool({ connectionString: database.toString(), ssl: false });
  const marker = `Completion board ${randomUUID()}`;
  let id: string | undefined;
  try {
    const created = await context.request.post("/api/alliance-selection-desk", { headers: { origin: baseOrigin() }, data: { orgId, action: "create-session", eventKey: "2026gacmp", name: marker } });
    expect(created.ok(), await created.text()).toBe(true);
    const data = await created.json();
    id = data.sessionId ?? data.session?.id ?? data.view?.session?.id;
    expect(id).toBeTruthy();
    await page.goto(`/alliance-selection-desk?orgId=${orgId}&sessionId=${id}`);
    const editor = page.locator("details.alliance-desk-slot-editor").first();
    await expect(editor).not.toHaveAttribute("open");
    await expect(page.getByRole("button", { name: "Save pick, Captain, alliance 1", exact: true })).toBeHidden();
    await editor.locator("summary").press("Enter");
    await page.getByRole("textbox", { name: "Team number, Captain, alliance 1", exact: true }).fill("6925");
    await page.getByRole("textbox", { name: "Why this pick, Captain, alliance 1", exact: true }).fill("Strong match scouting evidence");
    await page.getByRole("button", { name: "Save pick, Captain, alliance 1", exact: true }).click();
    await expect(page.locator(".alliance-desk-slot-head").first()).toContainText("6925");
    await page.getByRole("textbox", { name: "Scout note, Captain, alliance 1", exact: true }).fill("Observed consistent autonomous scoring.");
    await page.getByRole("button", { name: "Attach evidence, Captain, alliance 1", exact: true }).click();
    await expect(page.locator(".alliance-desk-slot").first()).toContainText("Observed consistent autonomous scoring.");
    await page.reload();
    await expect(page.locator(".alliance-desk-slot-head").first()).toContainText("6925");
    await expect(page.locator(".alliance-desk-slot").first()).toContainText("Observed consistent autonomous scoring.");
    await expect(editor).not.toHaveAttribute("open");
    const stored = await pool.query("SELECT team_key,rationale FROM alliance_selection_desk_slots WHERE session_id=$1 AND alliance_seed=1 AND pick_slot='captain'", [id]);
    expect(stored.rows[0]).toMatchObject({ team_key: "frc6925", rationale: "Strong match scouting evidence" });
    await page.screenshot({ path: info.outputPath("alliance-board.png") });
  } finally {
    if (id) await pool.query("DELETE FROM alliance_selection_desk_sessions WHERE id=$1 AND name=$2", [id, marker]);
    await pool.end();
  }
});
