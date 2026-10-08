import { navigationOpener } from "./nav";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

for (const width of [390, 1440]) {
  test(`Home controls and live card links remain usable at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    const controls = page.getByTestId("dash-widget-grid").locator(".dash-board-heading");
    const board = controls.getByTestId("dash-board-chip");
    const edit = controls.getByTestId("dash-customize");
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(edit).toBeVisible();
    // Layout controls belong to the board; mobile may wrap them without clipping.
    await expect(page.locator(".dash-home-header").getByRole("button")).toHaveCount(0);
    for (const control of [board, edit]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await board.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("dash-board-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(board).toBeFocused();
    await edit.click();
    await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
    await expect(edit).toBeFocused();
    const openCard = page.locator(".dash-widget-open").first();
    await expect(openCard).toBeVisible();
    const heading = openCard.locator("..");
    await expect(heading).toHaveAccessibleName((await heading.innerText()).trim());
    await expect(page.locator(".dash-widget > .dash-widget-link")).toHaveCount(0);
    const destination = await openCard.getAttribute("href");
    expect(destination).toMatch(/^\//);
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach("home-accessibility.json", { body: JSON.stringify(audit), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`home-polished-${width}.png`), fullPage: true });
    await openCard.click();
    await expect(page).toHaveURL(url => url.pathname === new URL(destination!, url.origin).pathname);
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test(`workspace selection starts its data request immediately at ${width}px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    const identity = await (await context.request.get("/api/me")).json();
    expect(identity.orgId).toBeTruthy();
    // Warm the chunk before measuring: development compilation is not product latency.
    await page.goto(`/team?tab=todos&orgId=${identity.orgId}`);
    await expect(page.locator(".product-hub-panel")).toContainText("One work view", { timeout: 30_000 });
    await page.goto(`/team?orgId=${identity.orgId}`);
    await expect(page.locator(".tc-toolbar")).toBeVisible({ timeout: 30_000 });
    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/todos", { timeout: 5_000 });
    await page.getByRole("tab", { name: "Work", exact: true }).click();
    await request;
    await expect(page.locator(".product-hub-panel")).toHaveAttribute("data-hub-tab", "todos");
    await expect(page.locator(".product-hub-panel")).toContainText("One work view", { timeout: 30_000 });
  });
}

test("workspace search keeps its results usable on narrow and landscape screens", async ({page,context}) => {
  test.setTimeout(120_000); expect(await signInAs(context,"owner")).toBe(true);
  for(const viewport of [{width:320,height:667},{width:844,height:390},{width:768,height:1024}]) {
    await page.setViewportSize(viewport); await page.goto("/competition?tab=strategy");
    await expect(page.getByRole("tab",{name:"Match plan",exact:true})).toHaveAttribute("aria-selected","true");
    const opener=navigationOpener(page); await opener.click();
    const panel=page.getByRole("dialog",{name:"Product navigation",exact:true});
    const search=panel.getByRole("combobox",{name:"Search pages, tools, and your team's data",exact:true});
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/search" && new URL(response.url()).searchParams.get("q")==="scouting");
    await search.fill("scouting");
    expect((await loaded).ok()).toBe(true);
    await expect(panel.getByRole("status")).toHaveCount(0);
    const results=panel.getByRole("listbox",{name:"Search results",exact:true});
    await expect(results.getByRole("option").first()).toBeVisible();
    const last=results.getByRole("option").last(); await last.focus(); await expect(last).toBeFocused();
    await expect.poll(()=>last.evaluate(el=>{const rect=el.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight && el.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));}),"The final destination stays reachable").toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
  }
});
