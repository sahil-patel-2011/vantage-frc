import { expect, test } from "@playwright/test";
import { fixtureAccount, baseOrigin } from "./session";

test("failed sign-out can be retried; successful sign-out revokes the session and clears downloaded views", async ({ page, context }) => {
  // Mint a dedicated session because this test revokes it.
  const result = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: baseOrigin() }, data: fixtureAccount("owner"),
  });
  expect(result.ok()).toBe(true);
  const originalSession = (await context.cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  expect(originalSession).toBeTruthy();
  await context.addInitScript(() => localStorage.setItem("vantage.tour.v1", "done"));
  await page.goto("/account?orgId=6925a000-0000-4000-8000-000000000001");
  // CI compiles this route on first use; wait for its loaded controls before
  // beginning the sign-out failure/retry assertions.
  await expect(page.getByRole("navigation", { name: "Account sections" })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    for (const [name, store, value] of [
      ["vantage-feature-cache", "snapshots", { key: "sign-out-proof", data: "downloaded private view" }],
      ["vantage-free-scout", "reports", { key: "sign-out-proof", userId: "fixture-owner", orgId: "fixture-team", report: { notes: "unsent work" } }],
    ] as const) await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(store, { keyPath: "key" });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction(store, "readwrite");
        transaction.objectStore(store).put(value);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.getByRole("button", { name: "Account menu" }).click();
  let alertMessage = "";
  page.once("dialog", async (alert) => { alertMessage = alert.message(); await alert.accept(); });
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect.poll(() => alertMessage).toContain("Could not sign out");
  await expect(page).toHaveURL(/\/account/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeEnabled();
  // Use the browser's cookie rules (Secure cookies on trusted loopback), not
  // APIRequestContext's stricter HTTP cookie filter.
  expect(await page.evaluate(async () => (await fetch("/api/me")).status)).toBe(200);
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${baseOrigin()}/`);
  expect(await page.evaluate(async () => (await fetch("/api/me")).status)).toBe(401);
  expect((await context.request.get("/api/me", { headers: { cookie: `${originalSession!.name}=${originalSession!.value}` } })).status()).toBe(401);
  expect((await context.cookies()).some((cookie) => cookie.name === "vantage-team")).toBe(false);
  const count = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("vantage-feature-cache", 1);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("snapshots").objectStore("snapshots").count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(count).toBe(0);
  expect(await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open("vantage-free-scout", 1);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("reports").objectStore("reports").get("sign-out-proof");
      request.onsuccess = () => { db.close(); resolve(request.result?.report?.notes === "unsent work"); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }))).toBe(true);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/signin/);
});
