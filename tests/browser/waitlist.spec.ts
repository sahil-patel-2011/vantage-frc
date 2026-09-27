import { expect, test } from "@playwright/test";

test("a visitor can join the waitlist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your season stops living in spreadsheets." })).toBeVisible();
  const finalForm = page.locator("#waitlist");
  await finalForm.scrollIntoViewIfNeeded();
  await expect(finalForm.getByRole("heading", { name: "Join the waitlist." })).toBeVisible();
  const unavailable = finalForm.getByRole("heading", { name: /isn't taking names/i });
  if (await unavailable.count()) {
    await expect(unavailable).toBeVisible();
    await expect(finalForm.getByText("Setup required")).toHaveCount(0);
    return;
  }
  await expect(finalForm).toContainText("Joining does not create an account");
  const email = `browser-${Date.now()}@example.com`;
  await finalForm.getByLabel("Email").fill(email);
  await finalForm.getByLabel("FRC team number").fill("254");
  const join = finalForm.getByRole("button", { name: "Join the waitlist" });
  await expect(join).toBeEnabled();
  await finalForm.getByRole("checkbox", { name: /I agree to the Terms of Service/i }).check();
  await finalForm.getByRole("checkbox", { name: /I agree to the Privacy Policy/i }).check();
  await join.click();
  const success = page.getByTestId("waitlist-success");
  const error = page.getByTestId("waitlist-error");
  const closed = page.getByTestId("waitlist-unavailable");
  await expect(success.or(closed).or(error)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Setup required")).toHaveCount(0);
  if (await success.count()) {
    await expect(success).toContainText("You’re on the list");
    await expect(success).toContainText(email);
    await expect(success).toContainText("254");
  }
});

test("a stalled waitlist request keeps details and offers a safe retry", async ({ page }) => {
  test.setTimeout(60_000);
  let attempts = 0;
  await page.route("**/api/waitlist", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { status: "ready" } });
      return;
    }
    attempts++;
    if (attempts === 1) {
      // An unavailable network must not leave Joining… disabled forever.
      await new Promise(resolve => setTimeout(resolve, 22_000));
      await route.fulfill({ json: { ok: true } }).catch(() => { /* Browser has already aborted this timed-out request. */ });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const form = page.locator("#waitlist");
  const email = "retry-fixture@example.test";
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("FRC team number").fill("254");
  await form.getByRole("checkbox", { name: /Terms of Service/ }).check();
  await form.getByRole("checkbox", { name: /Privacy Policy/ }).check();
  const submit = form.getByRole("button", { name: "Join the waitlist", exact: true });
  await submit.click();
  await expect(form.getByTestId("waitlist-error")).toContainText("We couldn't confirm your request in time", { timeout: 25_000 });
  await expect(form.getByLabel("Email")).toHaveValue(email);
  await expect(form.getByLabel("FRC team number")).toHaveValue("254");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(form.getByTestId("waitlist-success")).toContainText(email);
  expect(attempts).toBe(2);
});
