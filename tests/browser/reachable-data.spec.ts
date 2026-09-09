import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { baseOrigin, signInAs } from "./session";

/**
 * Three places where the database knew something the screen did not.
 *
 *  - `inventory_items.is_spare` (migration 0520) had API support on create and
 *    update and no control anywhere that set it, so Spare Forecast counted a
 *    column no team could ever write.
 *  - Spare Forecast's view carried `consumableSpareCount` beside
 *    `spareBinCount` and showed only the total, so the two numbers read as two
 *    unrelated features.
 *  - `batteryHealth().score` became null for a pack nobody has tested, but
 *    `status` still says "good" for one — because nothing measured contradicts
 *    it. A pack the team has never put a meter on must not wear a health grade.
 *
 * These need a real session: `E2E_AUTH_FIXTURE` mints none, so every product
 * API answers 401 under it and none of this data can load.
 */

type Session = { context: BrowserContext; page: Page };

async function api(
  context: BrowserContext,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await context.request.fetch(`${baseOrigin()}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", origin: baseOrigin() },
    ...(body ? { data: body } : {}),
    failOnStatusCode: false,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    /* an HTML redirect body */
  }
  return { status: response.status(), json };
}

test.describe.configure({ mode: "serial" });

let owner: Session;
let orgId: string | null = null;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const signedIn = await signInAs(context, "owner");
  owner = { context, page: await context.newPage() };
  if (!signedIn) return;
  const inventory = await api(context, "/api/inventory");
  const seen = (inventory.json.context ?? {}) as { orgId?: string; role?: string };
  // Only an owner or admin may write inventory, and only a workspace with a
  // real org id can hold any of these rows.
  if (seen.role === "owner" || seen.role === "admin") orgId = seen.orgId ?? null;
});

test.afterAll(async () => {
  await owner?.context.close();
});

test.beforeEach(() => {
  test.skip(
    orgId == null,
    "needs a seeded owner account with a workspace — set VANTAGE_E2E_OWNER_EMAIL / VANTAGE_E2E_OWNER_PASSWORD",
  );
});

const withOrg = (path: string) => `${path}${path.includes("?") ? "&" : "?"}orgId=${orgId}`;

test("a part can be marked as a spare from the page that owns it, and Spare Forecast counts it", async () => {
  const before = await api(owner.context, withOrg("/api/spare-forecast"));
  const startingBins = Number(before.json.spareBinCount ?? 0);
  const name = `Spare gearbox ${Date.now()}`;

  await owner.page.goto(withOrg("/inventory"));
  await expect(owner.page.getByRole("heading", { level: 1, name: "Inventory & BOM" })).toBeVisible();
  await owner.page.getByRole("button", { name: "Add item", exact: true }).click();

  const form = owner.page.locator("#inventory-add-item");
  await expect(form).toBeVisible();
  await form.getByLabel("Name").fill(name);
  // The control that did not exist: without it nothing in the product could
  // write is_spare, and migration 0520 was unreachable by a team.
  const spare = form.getByLabel("Held as a spare");
  await expect(spare).not.toBeChecked();
  await spare.check();
  await form.getByRole("button", { name: /Add item/ }).click();

  // The row says what was written, so the flag is visible and not write-only.
  const row = owner.page.locator(".inventory-item").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.locator(".inventory-item-tags em", { hasText: "Spare" })).toBeVisible();

  // And the list can be narrowed to exactly these rows.
  await owner.page.getByRole("checkbox", { name: "Spares only" }).check();
  await expect(owner.page.locator(".inventory-item").filter({ hasText: name })).toBeVisible();
  for (const tags of await owner.page.locator(".inventory-item").all()) {
    await expect(tags.locator(".inventory-item-tags em", { hasText: "Spare" })).toHaveCount(1);
  }

  const after = await api(owner.context, withOrg("/api/spare-forecast"));
  expect(Number(after.json.spareBinCount ?? 0), "Spare Forecast did not see the new spare").toBe(
    startingBins + 1,
  );
});

test("Spare Forecast says how many of its spare bins are consumables", async () => {
  // A consumable spare, so the split is not trivially "all parts".
  const created = await api(owner.context, "/api/spares", {
    orgId,
    action: "create-item",
    name: `Spare pneumatic tubing ${Date.now()}`,
    category: "pneumatics",
    unit: "ft",
    onHand: 25,
    reorderPoint: 10,
    isSpare: true,
  });
  expect(created.status).toBe(200);

  const view = await api(owner.context, withOrg("/api/spare-forecast"));
  const bins = Number(view.json.spareBinCount ?? 0);
  const consumables = Number(view.json.consumableSpareCount ?? 0);
  expect(bins).toBeGreaterThan(0);
  expect(consumables).toBeGreaterThan(0);
  expect(consumables).toBeLessThanOrEqual(bins);

  await owner.page.goto(withOrg("/spare-forecast"));
  // The view is fetched after mount, so wait for the tile row itself before
  // asserting on what is written inside it.
  await expect(owner.page.locator(".spare-forecast-stats")).toBeVisible({ timeout: 20_000 });
  const breakdown = owner.page.getByTestId("spare-bin-breakdown");
  await expect(breakdown).toBeVisible();
  // The whole point: the second number is a share of the first, not a
  // separate pile — so the caption names both halves.
  await expect(breakdown).toHaveText(
    new RegExp(`${consumables} consumables?`),
  );
  if (bins > consumables) {
    await expect(breakdown).toHaveText(new RegExp(`${bins - consumables} parts?`));
  }
});

/**
 * Inventory and Spare Forecast each offered the same three destinations from
 * three places at once: the header strip, the Next actions list, and a prose
 * "path" panel or an empty-state button row. Next actions is the copy that says
 * why to go, so it keeps them and the other two give them up.
 */
test("Inventory and Spare Forecast offer each destination exactly once", async () => {
  for (const path of ["/inventory", "/spare-forecast"]) {
    // Both pages render a loading shell first and swap in the loaded one, and
    // both shells carry these links — so this has to hold on whichever is on
    // screen. Wait for the fetch to settle, then count.
    await owner.page.goto(withOrg(path));
    await owner.page.waitForLoadState("networkidle");
    await expect(owner.page.getByRole("heading", { level: 1 })).toBeVisible();
    const hrefs = await owner.page.evaluate(() => {
      const main = document.querySelector("#main-content main") ?? document.querySelector("main");
      return [...(main?.querySelectorAll("a[href^='/']") ?? [])].map((a) => a.getAttribute("href")!);
    });
    const seen = new Map<string, number>();
    for (const href of hrefs) seen.set(href, (seen.get(href) ?? 0) + 1);
    const repeated = [...seen].filter(([, count]) => count > 1);
    expect(repeated, `${path} links these twice: ${JSON.stringify(repeated)}`).toEqual([]);
  }
});

test("a battery nobody has tested reads Unknown, not Good", async () => {
  const untested = `Untested pack ${Date.now()}`;
  const measured = `Measured pack ${Date.now()}`;

  const a = await api(owner.context, "/api/batteries", {
    action: "create_pack",
    orgId,
    label: untested,
  });
  expect(a.status).toBe(200);
  const b = await api(owner.context, "/api/batteries", {
    action: "create_pack",
    orgId,
    label: measured,
    initialVoltage: 12.9,
    initialResistanceMohm: 11,
  });
  expect(b.status).toBe(200);

  // The API is the source of the claim: null score for the untested pack, a
  // number for the measured one — and "good" status on both, which is exactly
  // why the badge cannot be driven off status.
  const view = await api(owner.context, withOrg("/api/batteries"));
  const packs = (view.json.packs ?? []) as Array<{
    label: string;
    health: { status: string; score: number | null };
  }>;
  const noReading = packs.find((pack) => pack.label === untested)!;
  const withReading = packs.find((pack) => pack.label === measured)!;
  expect(noReading.health.score).toBeNull();
  expect(withReading.health.score).not.toBeNull();

  // /batteries is a LEGACY_HUB_REDIRECTS source: the fleet lives on the Build
  // hub's Batteries tab, mounted client-side, so wait for the list itself
  // rather than a heading the hub owns.
  await owner.page.goto(withOrg("/build?tab=batteries"));
  await expect(owner.page.locator(".batt-fleet")).toBeVisible();

  const untestedRow = owner.page.locator(".batt-fleet li").filter({ hasText: untested });
  await expect(untestedRow.locator(".batt-badge").first()).toHaveText("Unknown");
  await expect(untestedRow.locator(".batt-badge", { hasText: /^Good$/ })).toHaveCount(0);

  const measuredRow = owner.page.locator(".batt-fleet li").filter({ hasText: measured });
  await expect(measuredRow.locator(".batt-badge").first()).toHaveText(
    new RegExp(`^(${["Good", "Aging", "Retire"].join("|")})$`),
  );

  // The rotation list ranks by score, so an unscored pack must not carry a
  // number there either.
  const rotation = owner.page.locator(".batt-rotation li").filter({ hasText: untested });
  if ((await rotation.count()) > 0) {
    await expect(rotation.locator(".score")).toHaveText("—");
  }
});
