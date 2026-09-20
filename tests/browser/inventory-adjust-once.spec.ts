import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * A stock adjustment moves the stock once.
 *
 * The Adjust form takes a quantity, a reason and an optional note. It used to
 * post the adjustment for the quantity and then, when a note had been typed,
 * post the entire adjustment a second time with the note attached — so the
 * stock moved twice and the ledger recorded two transactions for one event.
 *
 * Taking five bolts and writing "for the intake" removed ten. Nothing failed,
 * nothing was logged, and the count was simply wrong from then on; the only
 * people affected were the ones bothering to document what they did.
 *
 * This drives the real form rather than the API, because the API was never
 * wrong — the second call was a correct request that should not have been
 * made, and only the form can be asked not to make it.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const PREFIX = "Adjust spec";

type Probe = { id: string; name: string };

/**
 * A new item starts at zero — `create_item` has no opening-quantity field, and
 * stock only ever moves through `adjust_stock` so that every count has a
 * transaction behind it. So the opening stock is itself an adjustment.
 */
async function createItem(page: import("@playwright/test").Page, name: string, quantity: number) {
  return page.evaluate(
    async ([itemName, qty]) => {
      const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
      const created = await fetch(`/api/inventory?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_item",
          orgId,
          name: itemName,
          category: "hardware",
          unit: "ea",
        }),
      });
      if (!created.ok) return false;
      const listed = await fetch(`/api/inventory?orgId=${orgId}`, { cache: "no-store" }).then((r) => r.json());
      const row = (listed.items ?? []).find((i: { name: string }) => i.name === itemName);
      if (!row) return false;
      const stocked = await fetch(`/api/inventory?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "adjust_stock",
          orgId,
          itemId: row.id,
          delta: qty,
          reason: "received",
        }),
      });
      return stocked.ok;
    },
    [name, quantity] as const,
  );
}

async function readItem(page: import("@playwright/test").Page, name: string) {
  return page.evaluate(async (itemName) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/inventory?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: Array<{ id: string; name: string; quantity: number }> };
    return body.items?.find((row) => row.name === itemName) ?? null;
  }, name);
}

async function removeProbes(page: import("@playwright/test").Page) {
  await page.evaluate(async (prefix) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/inventory?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { items?: Array<{ id: string; name: string }> };
    for (const row of body.items ?? []) {
      if (!row.name.startsWith(prefix)) continue;
      await fetch(`/api/inventory?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_item", orgId, id: row.id }),
      });
    }
  }, PREFIX);
}

/** Open the row's Adjust form through the controls a person would use. */
async function openAdjust(page: import("@playwright/test").Page, item: Probe) {
  const row = page.locator("li.inventory-item").filter({ hasText: item.name }).first();
  await expect(row).toBeVisible({ timeout: 25_000 });
  const adjust = row.getByRole("button", { name: "Adjust", exact: true });
  if (await adjust.count()) {
    await adjust.first().click();
  } else {
    // Adjust lives behind the row's overflow menu at narrower widths.
    await row.getByTestId(`inventory-item-more:${item.id}`).click();
    await page.getByRole("menuitem", { name: "Adjust" }).click();
  }
  const form = row.locator("form.inventory-adjust");
  await expect(form).toBeVisible({ timeout: 10_000 });
  return form;
}

test("adjusting with a note changes the count by the amount typed, not twice", async ({ page }) => {
  await gotoAsTeam(page, "/inventory");
  await removeProbes(page);

  const name = `${PREFIX} bolts ${Date.now()}`;
  test.skip(!(await createItem(page, name, 20)), "inventory rejected the item");

  await page.reload();
  const before = await readItem(page, name);
  expect(before, "the probe item was not stored").not.toBeNull();
  expect(before!.quantity).toBe(20);

  const form = await openAdjust(page, { id: before!.id, name });
  await form.locator('input[type="number"]').fill("-5");
  // The note is the whole point: without one the old code was already correct.
  await form.getByPlaceholder("Note (optional)").fill("for the intake");
  await form.getByRole("button", { name: "Apply" }).click();

  await expect
    .poll(async () => (await readItem(page, name))?.quantity, { timeout: 20_000 })
    .toBe(15);

  // And settled there — a second write arriving late would show up as 10.
  await page.waitForTimeout(1500);
  expect((await readItem(page, name))?.quantity, "the adjustment was applied twice").toBe(15);

  await removeProbes(page);
});

test("adjusting without a note still works", async ({ page }) => {
  await gotoAsTeam(page, "/inventory");
  await removeProbes(page);

  const name = `${PREFIX} washers ${Date.now()}`;
  test.skip(!(await createItem(page, name, 8)), "inventory rejected the item");

  await page.reload();
  const before = await readItem(page, name);
  expect(before).not.toBeNull();
  expect(before!.quantity).toBe(8);

  const form = await openAdjust(page, { id: before!.id, name });
  await form.locator('input[type="number"]').fill("4");
  await form.getByRole("button", { name: "Apply" }).click();

  await expect
    .poll(async () => (await readItem(page, name))?.quantity, { timeout: 20_000 })
    .toBe(12);

  await removeProbes(page);
});
