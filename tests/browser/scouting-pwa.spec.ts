import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import AxeBuilder from "@axe-core/playwright";
import { signInAs } from "./session";

// Run against `next start`: development intentionally unregisters the worker.
test.skip(process.env.SCOUTING_PWA_VERIFY !== "1", "Requires a production build with its service worker enabled");
test.use({ reducedMotion: "reduce" });
const orgId = "6925a000-0000-4000-8000-000000000001";

/** Keep an earlier event in the real device queue without sending a synthetic fixture. */
async function previousEventQueue(page: Page, clientId: string, remove = false) {
  await page.evaluate(async ({ clientId, remove }) => {
    const name = (await indexedDB.databases()).find(db => db.name?.startsWith("vantage-scouting-person-"))?.name;
    if (!name) throw new Error("Personal scouting storage must exist");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("entry-outbox", "readwrite");
        const store = tx.objectStore("entry-outbox");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        if (remove) store.delete(clientId);
        else {
          const request = store.getAll();
          request.onsuccess = () => {
            if (request.result.length !== 1) { tx.abort(); return; }
            store.put({ ...request.result[0], clientId, eventKey: "2025previous", teamKey: "frc118" });
          };
          tx.onabort = () => reject(new Error("Expected the freshly saved pit report"));
        }
      });
    } finally { db.close(); }
  }, { clientId, remove });
}
for (const width of [390, 1440]) {
  test(`event preparation opens real scouting and robot analysis without signal at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/scout?orgId=${orgId}`);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await expect(page.getByRole("region", { name: "Scouting", exact: true })).toContainText("24 teams");
    await page.getByRole("button", { name: "Get this phone ready", exact: true }).click();
    await expect(page.locator(".scout-home-persist [role=status]")).toContainText("This phone can scout with no signal.", {timeout:120_000});
    expect((await new AxeBuilder({page}).include(".scouting-product").analyze()).violations).toEqual([]);
    await page.screenshot({path:info.outputPath(`scouting-home-${width}.png`)});
    await context.setOffline(true);
    // Follow the same full-document links the installed Scouting app uses.
    await page.getByRole("navigation", {name:"Scouting",exact:true}).getByRole("link",{name:"Teams",exact:true}).click();
    await expect(page.locator(".stp-row").first()).toBeVisible();
    await expect(page.locator(".scout-cached-analysis")).toBeVisible();
    await page.reload();
    await expect(page.locator(".stp-row").first()).toBeVisible();
    await page.getByRole("navigation", {name:"Scouting",exact:true}).getByRole("link",{name:"Scout",exact:true}).click();
    await expect(page.getByRole("tablist",{name:"Scouting task",exact:true})).toBeVisible();
    await expect(page.locator(".next-match")).toBeVisible();
    await page.getByRole("tablist",{name:"Scouting task",exact:true}).getByRole("tab",{name:"Pit",exact:true}).click();
    await expect(page.getByRole("searchbox",{name:"Find an unvisited pit",exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tablist",{name:"Scouting task",exact:true}).getByRole("tab",{name:"Pit",exact:true})).toHaveAttribute("aria-selected","true");
    await expect(page.getByRole("searchbox",{name:"Find an unvisited pit",exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const marker = `PWA pit ${randomUUID()}`;
    const dbUrl = process.env.DATABASE_ADMIN_URL!;
    expect(new URL(dbUrl).hostname).toBe("127.0.0.1");
    expect(new URL(dbUrl).pathname).toMatch(/_test_/);
    const db = new Pool({connectionString:dbUrl,ssl:false});
    const previousClientId = randomUUID();
    let previousQueued = false;
    try {
      const baseline = Number(await page.getByRole("region", {name:"Pit visits",exact:true}).locator("header strong").innerText().then(text=>text.split(" ")[0]));
      await page.getByRole("textbox",{name:"Team number",exact:true}).fill("9999");
      await page.getByRole("textbox",{name:"Notes",exact:true}).fill(marker);
      await page.getByRole("button",{name:"Save on this phone",exact:true}).click();
      await expect(page.locator("#scout-save-confirmation")).toContainText("Saved pit report for 9999");
      await previousEventQueue(page, previousClientId);
      previousQueued = true;
      await page.reload();
      await expect(page.getByRole("region",{name:"Pit visits",exact:true})).toContainText(`${baseline + 1} of 24`);
      await expect(page.getByRole("button",{name:"Pit scout team 118, Team 118",exact:true})).toBeVisible();
      await page.getByRole("navigation", {name:"Scouting",exact:true}).getByRole("link",{name:"Home",exact:true}).click();
      await expect(page.locator(".scout-home-facts").first().getByText("2",{exact:true})).toBeVisible();
      await expect(page.getByRole("region",{name:"Pit scouting",exact:true})).toContainText(`${baseline + 1} of 23`);
      await expect(page.getByRole("link",{name:"Pit scout team 9999",exact:true})).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("region",{name:"Pit scouting",exact:true})).toContainText(`${baseline + 1} of 23`);
      await previousEventQueue(page, previousClientId, true);
      previousQueued = false;
      await context.setOffline(false);
      await expect.poll(async ()=>(await db.query("SELECT count(*)::int AS n FROM pit_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2",[orgId,marker])).rows[0].n).toBe(1);
    } finally {
      if (previousQueued && !page.isClosed()) await previousEventQueue(page, previousClientId, true);
      await context.setOffline(false);
      await db.query("DELETE FROM pit_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2",[orgId,marker]);
      await db.end();
    }
    await page.getByRole("navigation", {name:"Scouting",exact:true}).getByRole("link",{name:"Teams",exact:true}).click();
    await expect(page.locator(".scout-cached-analysis")).toHaveCount(0);
    await expect(page.locator(".stp-row").first()).toBeVisible();
  });
}
