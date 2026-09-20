import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * Telling the assistant something about yourself.
 *
 * Every part of this existed and none of it could be reached: `user_memories`
 * had a table, RLS, full CRUD, a per-user switch, a token budget and an API
 * route, and `retrieveContext` had been injecting the rows into chats the
 * whole time. Nothing in the app called any of it, so the only way a memory
 * could exist was to write one straight into Postgres.
 *
 * These walk the path a person walks, and then check the row landed — because
 * a form that looks like it worked and wrote nothing is the failure this
 * feature is most likely to have.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openMemory(page: import("@playwright/test").Page) {
  await gotoAsTeam(page, "/team/ai-memory");
  await expect(page.locator(".ai-memory-personal")).toBeVisible({ timeout: 25_000 });
}

/** What the chat API says it knows about this person. */
async function storedMemories(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/agent?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { memories?: Array<{ id: string; content: string }> };
    return body.memories ?? [];
  });
}

async function forgetAll(page: import("@playwright/test").Page, needle: string) {
  await page.evaluate(async (marker) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/agent?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { memories?: Array<{ id: string; content: string }> };
    for (const row of body.memories ?? []) {
      if (row.content.includes(marker)) {
        await fetch(`/api/agent/memory?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      }
    }
  }, needle);
}

test("something you tell it is remembered, and can be forgotten", async ({ page }) => {
  await openMemory(page);
  const marker = `spec-memory-${Date.now()}`;
  await forgetAll(page, "spec-memory-");

  await page.getByLabel("Remember that…").fill(`I am the drive coach ${marker}`);
  // The save button appears only when there is something to save.
  const save = page.getByRole("button", { name: "Remember this" });
  await expect(save).toBeVisible();
  await save.click();

  // On screen, and in the store the chat reads from — not one or the other.
  await expect(page.locator(".ai-memory-personal-list")).toContainText(marker, { timeout: 20_000 });
  await expect
    .poll(async () => (await storedMemories(page)).some((row) => row.content.includes(marker)), {
      timeout: 20_000,
    })
    .toBe(true);

  // It survives a reload, which is the difference between a memory and a
  // sentence that scrolled past.
  await page.reload();
  await expect(page.locator(".ai-memory-personal-list")).toContainText(marker, { timeout: 25_000 });

  const forget = page
    .locator(".ai-memory-personal-list li")
    .filter({ hasText: marker })
    .getByRole("button", { name: /^Forget/ });
  await forget.click();

  await expect
    .poll(async () => (await storedMemories(page)).some((row) => row.content.includes(marker)), {
      timeout: 20_000,
    })
    .toBe(false);
});

test("each Forget says what it forgets", async ({ page }) => {
  await openMemory(page);
  const marker = `spec-memory-${Date.now()}`;
  await forgetAll(page, "spec-memory-");

  await page.getByLabel("Remember that…").fill(`Short answers please ${marker}`);
  await page.getByRole("button", { name: "Remember this" }).click();
  await expect(page.locator(".ai-memory-personal-list")).toContainText(marker, { timeout: 20_000 });

  // A column of buttons all reading "Forget" is a column nobody can tell
  // apart by control alone.
  const button = page
    .locator(".ai-memory-personal-list li")
    .filter({ hasText: marker })
    .getByRole("button");
  await expect(button).toHaveAttribute("aria-label", new RegExp(`Forget: .*${marker}`));

  await forgetAll(page, "spec-memory-");
});

test("the switch stops them being used without deleting them", async ({ page }) => {
  await openMemory(page);
  const marker = `spec-memory-${Date.now()}`;
  await forgetAll(page, "spec-memory-");

  await page.getByLabel("Remember that…").fill(`Keep this ${marker}`);
  await page.getByRole("button", { name: "Remember this" }).click();
  await expect(page.locator(".ai-memory-personal-list")).toContainText(marker, { timeout: 20_000 });

  /*
    Set the precondition rather than assume it. The switch persists per person,
    so a previous run of this very test leaves it off — and asserting it starts
    on made the spec fail on its own last run rather than on anything about the
    feature.
  */
  const toggle = page.getByRole("checkbox", { name: /Use these in my chats/ });
  await toggle.check();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  // Turning it off must not be a delete in disguise — that is the whole
  // promise the label makes.
  await expect
    .poll(async () => (await storedMemories(page)).some((row) => row.content.includes(marker)), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect(page.locator(".ai-memory-personal-list")).toContainText(marker);

  await toggle.check();
  await forgetAll(page, "spec-memory-");
});
