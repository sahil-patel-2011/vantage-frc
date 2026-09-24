import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * Scouting has always been able to say how *much* you had done — coverage,
 * shifts, accuracy, data quality — and never what it said. This is the screen
 * that answers the second question, and these check it can tell robots apart
 * rather than listing them.
 *
 * Needs `scripts/seed-scouting-demo.mjs`, which writes robots with deliberate
 * characters: a metronome, one that improves across the day, one that keeps
 * dying. Skips when the fixture has no scouting rather than asserting on an
 * empty event.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openRobots(page: import("@playwright/test").Page) {
  await page.goto("/competition?tab=scouting");
  const tab = page.getByRole("button", { name: "Robots", exact: true });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  const panel = page.locator(".stp");
  const empty = page.getByText(/No scouting at this event yet|what your fields are worth/i);
  await expect(panel.or(empty).first()).toBeVisible({ timeout: 20_000 });
  return (await panel.count()) > 0;
}

test("shows one row per robot, with the number and the shape of its matches", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const rows = page.locator(".stp-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);

  // A sparkline, not just an average — the thing an average cannot tell you.
  await expect(rows.first().locator("svg.stp-spark")).toBeVisible();
  // And the one sentence a pick-list meeting needs.
  await expect(rows.first().locator(".stp-headline")).not.toBeEmpty();
});

test("names what kind of robot each one is, rather than only how many points", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const text = await page.locator(".stp").innerText();
  // The demo event has a metronome and a boom-or-bust robot in it; a screen
  // that cannot separate those is listing numbers, not saying anything.
  expect(text).toMatch(/Very consistent/);
  expect(text).toMatch(/Boom or bust|Streaky/);

  // Every row is tagged with a consistency, so the colour down the edge means
  // something on every robot and not just the ones with enough matches.
  const tagged = await page.locator(".stp-row[data-consistency]").count();
  expect(tagged).toBe(await page.locator(".stp-row").count());
});

test("never calls a robot's own alternation a trend", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  // The bug this pins: a robot alternating 8 and 52 had halves averaging
  // 28.75 and 30.25, and a flat one-point threshold put "Improving" on it.
  for (const row of await page.locator(".stp-row").all()) {
    const consistency = await row.getAttribute("data-consistency");
    if (consistency !== "boom-or-bust") continue;
    const text = await row.innerText();
    if (/Improving|Scoring less lately/.test(text)) {
      // A swingy robot may genuinely trend — but then the change has to be
      // large, not a rounding difference between two noisy halves.
      const delta = Number(/([\d.]+) (?:more|less) per match/.exec(text)?.[1] ?? "0");
      expect(delta, `${text}`).toBeGreaterThan(5);
    }
  }
});

test("sorts by pick order, average and team number", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const firstTeam = async () => (await page.locator(".stp-row .stp-team").first().innerText()).trim();
  // The screen opens on Best fit, not pick order, so choose pick order first.
  await page.getByRole("button", { name: "Pick order" }).click();
  const byPick = await firstTeam();

  await page.getByRole("button", { name: "Team number" }).click();
  const byNumber = await page.locator(".stp-row .stp-team").allInnerTexts();
  const numbers = byNumber.map((value) => Number(value.trim()));
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

  await page.getByRole("button", { name: "Pick order" }).click();
  await expect(page.locator(".stp-row .stp-team").first()).toHaveText(byPick);
});

test("Best fit ranks on more than points, and is the order that opens", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const order = async () =>
    (await page.locator(".stp-row .stp-team").allInnerTexts()).map((text) => text.trim());

  // It opens on Best fit, because "which robot should we take" is the question
  // the data was collected to answer.
  await expect(page.getByRole("button", { name: "Best fit", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const fit = await order();

  await page.getByRole("button", { name: "Average", exact: true }).click();
  await expect(page.getByRole("button", { name: "Average", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const average = await order();

  // If weighting cannot change the answer it is decoration.
  expect(fit).not.toEqual(average);
  expect(fit.length).toBe(average.length);
  expect([...fit].sort()).toEqual([...average].sort());

  /**
   * The thing raw points gets wrong, and a reason this sort exists.
   *
   * A robot towed off the field a third of the time looks acceptable on an
   * average that has already absorbed those zeros — what the average cannot
   * say is that you cannot plan around it. Best fit must never rank such a
   * robot *higher* than points alone does.
   *
   * An earlier version of this also checked robots it thought were thinly
   * scouted by looking for "Not enough matches" in the row. That is the
   * *consistency* label, and a robot that scores zero every match carries it
   * with a full sample — so the check fired on a robot that was not thin and
   * failed on correct behaviour.
   */
  await page.getByRole("button", { name: "Best fit", exact: true }).click();
  await page.waitForTimeout(300);

  let checked = 0;
  for (const row of await page.locator(".stp-row").all()) {
    const text = await row.innerText();
    // "Keeps dying" means a real share of matches, like the third this comment describes.
    // One dead match in thirteen is shown too ("Broke down in 8% of matches"), and a robot like that with a
    // strong climb rightly ranks above where raw points put it.
    const dead = Number(/Broke down in (\d+)%/.exec(text)?.[1] ?? "0");
    if (dead < 25) continue;
    const team = (await row.locator(".stp-team").innerText()).trim();
    checked += 1;
    expect(
      fit.indexOf(team),
      `${team} keeps dying and Best fit ranked it above where raw points did`,
    ).toBeGreaterThanOrEqual(average.indexOf(team));
  }
  // The seeded event has a robot that keeps dying; if it ever stops having
  // one, this test is asserting nothing and should say so rather than pass.
  expect(checked, "no unreliable robot in the fixture to check against").toBeGreaterThan(0);
});

test("the weights are yours, and they change the order in front of you", async ({ page }) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const order = async () =>
    (await page.locator(".stp-row .stp-team").allInnerTexts()).map((text) => text.trim());
  const sliders = page.locator(".stp-weight-grid input[type='range']");
  await expect(sliders).toHaveCount(6);
  const before = await order();

  /**
   * Endgame climb, turned all the way up.
   *
   * The seeded event has exactly one robot written to climb every match, and
   * it is not near the top on points. If weighting climb does not move it up,
   * the sliders are not connected to the ranking — which is the failure mode
   * worth a test, because a slider that does nothing still looks right.
   */
  await sliders.nth(3).fill("2");
  await sliders.nth(0).fill("0.2");
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await page.waitForTimeout(400);
  const byClimb = await order();

  expect(byClimb).not.toEqual(before);
  expect([...byClimb].sort()).toEqual([...before].sort());

  const climber = await page
    .locator(".stp-row")
    .filter({ hasText: "does it every match" })
    .first()
    .locator(".stp-team")
    .innerText();
  expect(
    byClimb.indexOf(climber.trim()),
    `${climber.trim()} climbs and weighting climb did not move it up`,
  ).toBeLessThanOrEqual(before.indexOf(climber.trim()));

  // In words a student can act on, not a number they have to interpret.
  await expect(page.locator(".stp-weight-value").nth(3)).toHaveText("Decides it");

  // Reset puts it back, and takes itself away.
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(400);
  expect(await order()).toEqual(before);
  await expect(page.getByRole("button", { name: "Reset" })).toHaveCount(0);
});

test("a weighting survives a reload, because a pick meeting is not one page view", async ({
  page,
}) => {
  test.skip(!(await openRobots(page)), "no scouting seeded on this box");

  const sliders = page.locator(".stp-weight-grid input[type='range']");
  await sliders.nth(2).fill("2");
  await page.waitForTimeout(400);

  await page.reload();
  await page.getByRole("button", { name: "Robots", exact: true }).click();
  await expect(page.locator(".stp-weight-grid input[type='range']").nth(2)).toHaveValue("2");

  await page.getByRole("button", { name: "Reset" }).click();
});
