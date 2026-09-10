import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const SHELLS = [
  {
    path: "/pit-repair-triage",
    board: /Pit repair triage/i,
    empty: /Log your first pit failure/i,
    shot: "pit-repair-triage-after-shell.png",
  },
  {
    path: "/drive-team-signals",
    board: /Drive-Team Signal Board/i,
    empty: /Create your first signal sheet/i,
    shot: "drive-team-signals-after-shell.png",
  },
  {
    path: "/field-reset-timer",
    board: /Field Reset Timer/i,
    empty: /Start a practice reset session/i,
    shot: "field-reset-timer-after-shell.png",
  },
  {
    path: "/robot-weigh-in",
    board: /Robot weigh-in log/i,
    empty: /Log your first robot weigh-in/i,
    shot: "robot-weigh-in-after-shell.png",
  },
  {
    path: "/event-day-plan",
    board: /Event-Day Stress Planner|Hourly event-day overlay/i,
    empty: /Add your first event-day block/i,
    shot: "event-day-plan-after-shell.png",
  },
  {
    path: "/match-delta-watcher",
    board: /Match-Delta Watcher|Official results vs predictions/i,
    empty: /Score predictions, then scan/i,
    shot: "match-delta-watcher-after-shell.png",
  },
  {
    path: "/match-video-index",
    board: /Match Video Index|Match video library/i,
    empty: /Index your first match video/i,
    shot: "match-video-index-after-shell.png",
  },
] as const;

for (const shell of SHELLS) {
  test(`${shell.path} still loads after the Saturday shell pass`, async ({ page }) => {
    await page.goto(shell.path);
    await expect(page.locator("body")).not.toContainText("Application error");

    const board = page.getByRole("heading", { name: shell.board });
    const setup = page.getByRole("heading", { name: /Select a team|Choose a team/i });
    const empty = page.getByRole("heading", { name: shell.empty });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, board, empty.or(setup).or(unavailable)))) {
      await page.screenshot({ path: `/opt/cursor/artifacts/${shell.shot}`, fullPage: true });
      return;
    }

    await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
    await expect(page.getByText("org-scoped")).toHaveCount(0);
    await page.screenshot({ path: `/opt/cursor/artifacts/${shell.shot}`, fullPage: true });
  });
}
