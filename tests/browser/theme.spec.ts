import { expect, test } from "@playwright/test";
import { addSessionCookies, signInFixture } from "./session";

test("public site uses a restrained light palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { name: "Your season stops living in spreadsheets." })).toBeVisible();
  await expect(page.locator("#waitlist").getByLabel("Email")).toBeVisible();
  /*
    "Restrained light palette" is the claim, so that is what is checked: light
    (every channel high) and restrained (close to neutral — no loud tint). This
    used to pin one exact colour, the warm off-white rgb(250, 249, 246), and so
    failed the moment the Apple-style polish deliberately moved the canvas to
    pure white — while the palette was every bit as restrained as before. A
    dark page or a saturated one still fails, which is the regression worth
    catching.
  */
  const [r, g, b] = await page
    .locator(".marketing-site")
    .evaluate((el) => (getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number));
  expect(Math.min(r!, g!, b!), "the public site's background should be light").toBeGreaterThanOrEqual(235);
  expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), "and close to neutral, not a loud tint").toBeLessThanOrEqual(14);
});

/**
 * The old version of this test wrote `vantage-theme-pref=dark` straight into the
 * cookie jar and reloaded. It failed every run, not one in three: ThemeProvider
 * re-reads GET /api/theme on every product route and then calls
 * applyPreference(), which rewrites that same cookie. The fetch settled a beat
 * after the "light" assertion, i.e. *after* addCookies had run, so the hand-set
 * cookie was stamped back to `light` before the reload — and the boot script
 * reads the cookie ahead of localStorage, so light won.
 *
 * Persist it the way the Appearance control does — PUT /api/theme, then the
 * local copies — and only once the provider has settled (it adds `theme-ready`
 * to <html> when it is done writing), so nothing is racing anything.
 */
test("dashboard honors a persisted theme choice", async ({ context, page }) => {
  await signInFixture(context);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveClass(/theme-ready/);

  const saved = await page.evaluate(async () => {
    const response = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    return response.ok;
  });
  expect(saved).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("vantage-theme-pref", "dark");
    document.cookie = "vantage-theme-pref=dark; Path=/; Max-Age=31536000; SameSite=Lax";
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Still dark once the provider's own /api/theme round trip has settled.
  await expect(page.locator("html")).toHaveClass(/theme-ready/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("persisted theme applies on a mobile dashboard", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInFixture(context);
  await addSessionCookies(context, [{ name: "vantage-theme-pref", value: "dark" }]);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
