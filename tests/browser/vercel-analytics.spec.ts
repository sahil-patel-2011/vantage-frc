import { expect, test, type Page } from "@playwright/test";
import { ANALYTICS_CONSENT_COOKIE, serializeConsent } from "../../apps/web/lib/product-analytics/consent";

// The PWA otherwise fetches scripts through its own worker, outside page.route.
test.use({ serviceWorkers: "block" });

// Exercise the installed Next SDK and real consent UI. Only the external
// collector is replaced: tests never send traffic or account data to Vercel.
const collector = `(() => {
  let beforeSend = event => event;
  const receive = (command, data) => {
    if (command === "beforeSend") beforeSend = data;
    if (command !== "pageview") return;
    const url = new URL(location.href);
    if (data.path !== url.pathname) { url.pathname = data.path; url.search = ""; }
    const event = beforeSend({ type: "pageview", url: url.href });
    if (event) fetch("/_vercel/insights/view", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event)
    });
  };
  window.va = receive;
  (window.vaq || []).forEach(args => receive(...args));
})();`;

async function observe(page: Page) {
  const views: { type: string; url: string }[] = [];
  let scriptLoads = 0;
  await page.route(/(?:\/_vercel\/insights\/script\.js|https:\/\/va\.vercel-scripts\.com\/v1\/script\.debug\.js)(?:\?.*)?$/, async route => {
    scriptLoads++;
    await route.fulfill({ contentType: "text/javascript", body: collector });
  });
  await page.route("**/_vercel/insights/view", async route => {
    views.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, body: "{}" });
  });
  return { views, scriptLoads: () => scriptLoads };
}

test("declining Analytics loads no collector and sends no page views", async ({ page }) => {
  const traffic = await observe(page);
  await page.goto("/privacy#analytics");
  await page.getByRole("button", { name: "Only necessary cookies", exact: true }).click();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service", exact: true })).toBeVisible();
  expect(traffic.scriptLoads()).toBe(0);
  expect(traffic.views).toEqual([]);
});

test("grant, revoke and re-enable Analytics through the privacy chooser", async ({ page, context }) => {
  const traffic = await observe(page);
  await page.goto("/privacy?orgId=private-team&search=private-search&token=private-invite#analytics");
  await page.getByRole("button", { name: "Turn analytics on", exact: true }).click();
  await expect.poll(() => traffic.views.length).toBe(1);
  expect(traffic.views[0]).toEqual({ type: "pageview", url: `${new URL(page.url()).origin}/privacy` });
  expect(traffic.scriptLoads()).toBe(1);
  expect((await context.cookies()).find(cookie => cookie.name === ANALYTICS_CONSENT_COOKIE)?.value).toBe(serializeConsent("granted"));

  // A hash change reopens the existing chooser without unloading the SDK.
  await page.evaluate(() => { location.hash = ""; location.hash = "analytics"; });
  await page.getByRole("button", { name: "Only necessary cookies", exact: true }).click();
  // A loaded collector must still refuse a queued page view after revocation.
  await page.evaluate(() => {
    (window as unknown as { va: (command: string, data: object) => void }).va("pageview", { path: "/terms", route: "/terms" });
  });
  expect(traffic.views).toHaveLength(1);
  await page.evaluate(() => { location.hash = ""; location.hash = "analytics"; });
  await page.getByRole("button", { name: "Turn analytics on", exact: true }).click();
  await expect.poll(() => traffic.views.length).toBe(2);
  expect(traffic.scriptLoads()).toBe(1);
});

test("consent to the previous disclosure cannot enable the new collector", async ({ page, context }) => {
  await context.addCookies([{ name: ANALYTICS_CONSENT_COOKIE, value: "granted.1", url: test.info().project.use.baseURL as string }]);
  const traffic = await observe(page);
  await page.goto("/privacy#analytics");
  await expect(page.getByRole("button", { name: "Turn analytics on", exact: true })).toBeVisible();
  expect(traffic.scriptLoads()).toBe(0);
  expect(traffic.views).toEqual([]);
});
