import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * A checkbox belongs beside the words it labels.
 *
 * `.ai-keys-form label` is `display:grid`, which is right for a text field —
 * caption above, input below — and wrong for every choice on the page. So the
 * Automode pool put each checkbox on the line *under* its own label, and the
 * mode radios did the same. It was survivable because a checkbox is small and
 * left-aligned, so it read as loose spacing rather than as a broken row.
 *
 * Adding radios for the free swarm made it undeniable: a radio is larger, and
 * the shared input rule stretches an input to the full width of its row, so
 * they landed centred and enormous with their labels floating above them.
 *
 * Measured rather than eyeballed, because "looks a bit loose" is exactly how
 * this survived.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

test("every choice sits on the same line as its label", async ({ page }) => {
  await gotoAsTeam(page, "/team/ai-keys");
  const rows = page.locator(".ai-keys-mode label, .ai-keys-pool label");
  await expect(rows.first()).toBeVisible({ timeout: 25_000 });

  const misaligned = await page.evaluate(() =>
    [...document.querySelectorAll(".ai-keys-mode label, .ai-keys-pool label")]
      .filter((label) => {
        const input = label.querySelector("input");
        if (!input) return false;
        const gap = input.getBoundingClientRect().top - label.getBoundingClientRect().top;
        // A few pixels of optical alignment is fine; a whole line is the bug.
        return Math.abs(gap) > 10;
      })
      .map((label) => (label.textContent ?? "").trim().slice(0, 40)),
  );
  expect(misaligned, `rows with the control on its own line: ${JSON.stringify(misaligned)}`).toEqual(
    [],
  );
});

test("a checkbox is checkbox-sized, not input-sized", async ({ page }) => {
  await gotoAsTeam(page, "/team/ai-keys");
  await expect(page.locator(".ai-keys-pool input").first()).toBeVisible({ timeout: 25_000 });

  // The form's input rule sets min-height 44px and full width for text
  // fields. A choice that inherits it becomes a stretched slab.
  const oversized = await page.evaluate(() =>
    [...document.querySelectorAll('.ai-keys-mode input, .ai-keys-pool input')]
      .filter((input) => {
        const box = input.getBoundingClientRect();
        return box.width > 40 || box.height > 40;
      }).length,
  );
  expect(oversized).toBe(0);
});
