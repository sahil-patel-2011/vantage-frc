import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./session";

async function bridgeSnapshots(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(database => database.name === "vantage-feature-cache")) return [];
    return new Promise<Array<{ feature: string; orgId: string; userId: string }>>((resolve, reject) => {
      const open = indexedDB.open("vantage-feature-cache");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const read = database.transaction("snapshots").objectStore("snapshots").getAll();
        read.onsuccess = () => { database.close(); resolve(read.result.filter(row => row.feature === "ai-bridge")); };
        read.onerror = () => { database.close(); reject(read.error); };
      };
    });
  });
}

test("Personal Codex saves a correctly scoped snapshot and recovers after reconnecting", async ({ page, context }) => {
  test.setTimeout(90_000);
  expect(await signInAs(context, "owner")).toBe(true);
  const me = await (await context.request.get("/api/me")).json();
  const status = await context.request.get(`/api/ai-bridge/status?orgId=${me.orgId}`);
  expect(status.status()).toBe(200);
  expect(await status.json()).toHaveProperty("devices");
  const invalidScopes: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/me" && url.searchParams.get("orgId")?.includes(":")) invalidScopes.push(url.search);
  });
  const ready = page.waitForResponse(response => new URL(response.url()).pathname === "/api/ai-bridge/status" && response.status() === 200);
  await page.goto(`/team/ai-bridge?orgId=${me.orgId}`);
  await ready;
  await expect(page.getByRole("heading", { name: "Pair this computer" })).toBeVisible();
  await expect.poll(() => bridgeSnapshots(page)).toEqual([expect.objectContaining({ orgId: me.orgId, userId: me.userId })]);
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toContainText("Showing the last copy saved on this device");
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.locator(".offline-banner")).toBeHidden();
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeEnabled();
  expect(invalidScopes).toEqual([]);
  // A cached status must not conceal a definite permission rejection.
  let revoked = false;
  await page.route("**/api/ai-bridge/status?**", route => revoked
    ? route.fulfill({ status: 403, json: { error: "Connection access revoked" } }) : route.continue());
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toContainText("Showing the last copy saved on this device");
  revoked = true;
  await context.setOffline(false);
  await expect(page.getByText("Connection access revoked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry connection" })).toHaveCount(0);
  await expect.poll(() => bridgeSnapshots(page)).toEqual([]);
  await context.setOffline(true);
  await expect(page.getByText("Connection access revoked", { exact: true })).toBeVisible();
  await expect(page.locator(".offline-banner")).not.toContainText("Showing the last copy saved on this device");
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeDisabled();
});

test("a failed personal connection can retry the real status API", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const me = await (await context.request.get("/api/me")).json();
  expect((await context.request.get(`/api/ai-bridge/status?orgId=${me.orgId}`)).status()).toBe(200);
  let fail = true;
  await page.route("**/api/ai-bridge/status?**", route => fail
    ? route.fulfill({ status: 500, json: { error: "Temporary connection failure" } }) : route.continue());
  await page.goto(`/team/ai-bridge?orgId=${me.orgId}`);
  await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByRole("button", { name: "Approve this computer" })).toBeEnabled();
  await expect.poll(() => bridgeSnapshots(page)).toEqual([expect.objectContaining({ orgId: me.orgId, userId: me.userId })]);
});
