import { expect, test, type Page } from "@playwright/test";
import { loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { activeOrgId } from "./active-org";
import { signInAs, signInFixture } from "./session";

const BANNED = ["Connect TBA", "The Blue Alliance", "TBA/Statbotics", "Setup required", "OAuth", "ONSHAPE_"];
const ONSHAPE_URL = "https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333";
const FUSION_URL = "https://a360.co/3AbCdEf";

async function openStudent(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
}

/**
 * None of this jargon is *on screen*.
 *
 * `toContainText` reads textContent, which includes what is inside a closed
 * `<details>`. The CAD page has one — "Drive CAD from Claude Code", collapsed,
 * five terminal steps for the person who wants them — and a student who never
 * opens it never sees a word of it. Reading through the disclosure made this
 * fail on documentation nobody was being shown, and the only way to satisfy
 * it would have been to delete the section or rename the CLI.
 *
 * `innerText` is what a person can read, which is the claim being made.
 */
async function expectNoBanned(page: Page, label: string, extra: string[] = []) {
  const shown = await page.locator("body").innerText();
  for (const phrase of [...BANNED, ...extra]) {
    expect(shown, `${label} still shows ${phrase}`).not.toContain(phrase);
  }
}

test.describe("student-week GUI path", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ context }) => {
    const signed = await signInAs(context, "owner");
    if (!signed) await signInFixture(context);
  });

  test("Home What to do now CTA is a real click", async ({ page }) => {
    await openStudent(page, "/dashboard");
    const now = page.getByTestId("dash-now");
    await expect(now).toBeVisible();
    // "What to do now" is the card's accessible name, not text on screen —
    // d6d523a11 removed the visible eyebrow because the card said one thing
    // four ways. A screen reader still hears it.
    await expect(now).toHaveAttribute("aria-label", "What to do now");
    await expectNoBanned(page, "Home");
    const cta = now.getByRole("link").first();
    await expect(cta).toHaveCount(1);
    await expect(cta).toBeVisible();
    // The team-setup steps (invite, event, form, practice) are the next thing while a team is new.
    await expect(cta).toHaveAttribute("href", /\/(workspace|my-day|hours|todos|duties|invite|team\/calendar|team\/admin|command|scouting)/);
    await cta.click();
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    // Fixture cookie is not Better Auth: /workspace redirects to /signin, and
    // the E2E fixture proxy then bounces /signin back to Home.
    // My Day and Hours are hub tabs now — /my-day is a redirect into
    // /competition?tab=my-day — so the destination is the same place spelled
    // the way the hubs spell it.
    await expect(page).toHaveURL(/\/(dashboard|workspace|signin|invite|onboarding|my-day|hours|team|command|competition|scouting)|[?&]tab=(my-day|hours)/);
  });

  test("My Day Scout this match is a real click or Needs setup", async ({ page }) => {
    await openStudent(page, "/my-day");
    await expectNoBanned(page, "My Day");
    const scout = page.getByRole("link", { name: "Scout this match" });
    const setup = page.getByRole("heading", { name: /Choose your team|Needs setup/i }).or(
      page.getByRole("link", { name: /Choose your team|Set the event you’re at|Set active event/i }),
    );
    /*
      Under the Competition hub the page's own "My Day" h1 is display:none —
      the hub supplies the h1 — so a role locator cannot see it, and this
      passed only in the moment before the org resolved and the gate was still
      on screen. "Our matches" is the heading the tab actually paints.
    */
    const title = page.getByRole("heading", { name: /My Day|Next match|Our matches|Coming up|After that|Played \(/i });
    await expect(scout.or(setup).or(title).or(loadFailureHeading(page)).first()).toBeVisible({
      timeout: 15_000,
    });
    if (await scout.count()) {
      await scout.first().click();
      await waitForLoadingGone(page);
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page).toHaveURL(/scouting|competition/);
    }
  });

  test("Event day Packing is a real click from the related strip", async ({ page }) => {
    await openStudent(page, "/command");
    await expectNoBanned(page, "Event day");
    // Packing used to sit in a "Related" strip below the page. Those strips
    // were removed — they duplicated the hub's own tool row — so the tool row
    // is where it lives, and with three chips on screen it may be behind
    // "More tools". This is the real path a student takes.
    const strip = page.locator(".hub-tool-strip");
    const more = strip.getByRole("button", { name: /More tools/ });
    if (await more.count()) await more.first().click();
    const packing = strip.getByRole("link", { name: "Packing" }).or(
      strip.getByRole("button", { name: "Packing" }),
    );
    const setup = page.getByRole("link", { name: /Choose your team/i });
    await expect(packing.first().or(setup.first()).first()).toBeVisible({ timeout: 15_000 });
    if (await packing.count()) {
      await packing.first().click();
      await waitForLoadingGone(page);
      await expect(page).toHaveURL(/\/packing/);
      await expect(page.locator("body")).not.toContainText("Application error");
      const packingPrimary = page
        .getByRole("link", { name: /Choose your team|Create competition load-out|Sign in again/i })
        .or(page.getByRole("button", { name: /Create competition load-out|New list/i }));
      await expect(packingPrimary.first()).toBeVisible({ timeout: 12_000 });
      await expectNoBanned(page, "Packing");
    }
  });

  test("Hours Clock in is on the board and clickable", async ({ page }) => {
    await openStudent(page, "/hours-self-view");
    await expect(page.getByRole("heading", { name: "My Hours" })).toBeVisible();
    await expectNoBanned(page, "My Hours");
    const clock = page.getByRole("region", { name: "Clock in or out" }).getByRole("button", {
      name: /Clock in|Clock out/i,
    });
    const clockAnywhere = page.getByRole("button", { name: /Clock in|Clock out/i });
    const setup = page.getByRole("link", { name: /Choose your team|Sign in again/i });
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(
      clock.or(clockAnywhere).or(setup).or(retry).or(loadFailureHeading(page)).first(),
    ).toBeVisible({ timeout: 12_000 });
    const clockIn = page.getByRole("button", { name: "Clock in" });
    if (await clockIn.count()) {
      await clockIn.first().click();
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page.getByText("hour_logs")).toHaveCount(0);
    }
  });

  test("Pick desk lock or Open Scouting is reachable", async ({ page }) => {
    await openStudent(page, "/strategy?tab=picks");
    await expectNoBanned(page, "Pick desk");
    await expect(page.getByText(/\bEPA\b/)).toHaveCount(0);
    const heading = page.getByRole("heading", {
      name: /Pick desk|Rank, pick, and lock|No teams to rank yet|Choose your team/i,
    });
    await expect(heading.first()).toBeVisible({ timeout: 12_000 });
    const primary = page
      .getByRole("button", { name: /Lock this list|Retry/i })
      .or(page.getByRole("link", { name: /Open Scouting|Choose your team|Set active event|Sign in again/i }));
    await expect(primary.first()).toBeVisible();
    if (await page.getByRole("button", { name: /Lock this list/i }).count()) {
      await page.getByRole("button", { name: /Lock this list/i }).click();
      await expect(page.locator("body")).not.toContainText("Application error");
    } else if (await page.getByRole("link", { name: "Open Scouting" }).count()) {
      await page.getByRole("link", { name: "Open Scouting" }).click();
      await waitForLoadingGone(page);
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  });

  test("Team invites Send invite is on the board", async ({ page }) => {
    await openStudent(page, "/team/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
    await expectNoBanned(page, "Team admin", ["Join or pick a team", "Account Connections", "RLS"]);
    const orgId = await activeOrgId(page);
    if (orgId) {
      await openStudent(page, `/team/admin?orgId=${encodeURIComponent(orgId)}`);
      // 25s like its neighbours: on CI this is a cold compile of /team/admin, and the
      // default 5s failed a page that was only still loading.
      await expect(page.getByRole("heading", { name: "Invite someone" })).toBeVisible({ timeout: 25_000 });
      const form = page.locator("#invite-form");
      await expect(form.getByRole("button", { name: /^(Send|Create) invite$/ })).toBeVisible();
      const probeEmail = `gui-verify-${Date.now()}@example.com`;
      await form.getByLabel("Email").fill(probeEmail);
      await form.getByRole("button", { name: /^(Send|Create) invite$/ }).click();
      await expect(page.locator("body")).not.toContainText("Application error");

      /*
        Take it back out. This sends a real invite, and without a revoke the
        fixture team accrued one pending invite per run — 25 of them by the
        time anyone looked, each contributing a Resend and a Revoke button, so
        half of every control on Team admin was this spec's litter. It also
        buries any genuine pending invite a person is trying to read.

        Best-effort: a teardown that throws would mask the real assertion above.
      */
      await page.evaluate(async ([org, email]) => {
        const listed = await fetch(`/api/organizations/invites?orgId=${org}`, { cache: "no-store" });
        if (!listed.ok) return;
        const body = (await listed.json()) as { invites?: Array<{ id: string; email: string }> };
        for (const invite of body.invites ?? []) {
          if (invite.email !== email) continue;
          await fetch(`/api/organizations/invites`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "revoke", orgId: org, inviteId: invite.id }),
          });
        }
      }, [orgId, probeEmail] as const).catch(() => undefined);
    } else {
      await expect(page.getByRole("link", { name: /Choose your team|Invite an exact email/i }).first()).toBeVisible();
    }
    await expect(page.getByText(/waitlist/i).first()).toBeVisible();
  });

  test("Business Sponsors tab is a real click", async ({ page }) => {
    await openStudent(page, "/business");
    await expectNoBanned(page, "Business", ["Stripe", "STRIPE_"]);
    const heading = page.getByRole("heading", { level: 1, name: "Business" });
    await expect(heading.or(loadFailureHeading(page)).first()).toBeVisible({ timeout: 20_000 });
    const tabs = page.getByRole("tablist", { name: "Business sections" });
    const sponsorsTab = tabs.getByRole("tab", { name: "Sponsors" });
    const relatedSponsors = page
      .getByRole("navigation", { name: /Related funding tools/i })
      .getByRole("link", { name: "Sponsors" });
    const setup = page.getByRole("link", { name: /Choose your team/i });
    await expect(sponsorsTab.or(relatedSponsors).or(setup).first()).toBeVisible({ timeout: 20_000 });
    if (await sponsorsTab.count()) {
      await sponsorsTab.click();
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page.getByText("Stripe")).toHaveCount(0);
    } else if (await relatedSponsors.count()) {
      await relatedSponsors.click();
      await waitForLoadingGone(page);
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  });

  test("CAD paste offers Edit in Onshape", async ({ page }) => {
    await openStudent(page, "/dashboard");
    const orgId = await activeOrgId(page);
    await openStudent(page, orgId ? `/cad/setup?orgId=${encodeURIComponent(orgId)}` : "/cad/setup");
    await expect(page.getByRole("heading", { level: 1, name: "CAD setup" })).toBeVisible({
      timeout: 20_000,
    });
    await expectNoBanned(page, "CAD setup", ["vantage-cad", "ONSHAPE_OAUTH"]);
    const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
    const paste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
    await expect(chooseTeam.or(paste)).toBeVisible({ timeout: 20_000 });
    if ((await chooseTeam.count()) > 0) {
      await expect(page.getByText("Needs setup")).toBeVisible();
      await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
      return;
    }
    await paste.fill(ONSHAPE_URL);
    const edit = page.getByRole("link", { name: /^Edit( .+)? in Onshape$/i }).first();
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute("href", /onshape\.com/);

    await openStudent(page, orgId ? `/build?tab=cad&orgId=${encodeURIComponent(orgId)}` : "/build?tab=cad");
    const viewport = page.getByTestId("cad-viewport");
    const hubChoose = page.getByRole("heading", { name: "Choose your team", exact: true });
    await expect(viewport.or(hubChoose)).toBeVisible({ timeout: 20_000 });
    if ((await viewport.count()) > 0) {
      await expectNoBanned(page, "CAD hub", ["vantage-cad", "ONSHAPE_OAUTH"]);
      const hubPaste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
      if ((await hubPaste.count()) > 0) {
        await hubPaste.fill(ONSHAPE_URL);
        const hubEdit = page.getByRole("link", { name: /^Edit( .+)? in Onshape$/i }).first();
        await expect(hubEdit).toBeVisible();
        await expect(hubEdit).toHaveAttribute("href", /onshape\.com/);
      }
    }
  });

  test("CAD paste offers Edit in Fusion", async ({ page }) => {
    await openStudent(page, "/dashboard");
    const orgId = await activeOrgId(page);
    const path = orgId ? `/cad/connections?orgId=${encodeURIComponent(orgId)}` : "/cad/connections";
    await openStudent(page, path);
    await expect(page.getByRole("heading", { level: 1, name: "CAD connections" })).toBeVisible({
      timeout: 20_000,
    });
    await expectNoBanned(page, "CAD connections", ["vantage-cad", "FUSION_RELAY"]);
    const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
    const fusionTile = page.locator("#fusion");
    await expect(chooseTeam.or(fusionTile)).toBeVisible({ timeout: 20_000 });
    if ((await chooseTeam.count()) > 0) {
      await expect(page.getByText("Needs setup")).toBeVisible();
      await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
      return;
    }
    const paste = fusionTile.getByPlaceholder(/a360\.co/i);
    await expect(paste).toBeVisible();
    await paste.fill(FUSION_URL);
    const edit = fusionTile.getByRole("link", { name: /^Edit( .+)? in Fusion$/i });
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute("href", /a360\.co|autodesk/i);
  });

  test("Connectors pair Approve pairing stays student-usable", async ({ page, context }) => {
    /*
      This one really does need a student.

      /connectors shows an operator the environment variables they have to
      set — that is the point of the page for an owner, and
      `connectorStatusLine` chooses that copy on purpose. A student gets "Ask
      a mentor to finish setup" instead. Signed in as the owner, this test was
      asserting the student wording against the operator audience and failing
      on the product doing the right thing.

      The rest of the file stays on the owner, whose team has the data the
      other paths walk through.
    */
    const asStudent = await signInAs(context, "student");
    test.skip(!asStudent, "needs a seeded student to check student-audience copy");

    await openStudent(page, "/connectors");
    // Signing in is not the same as being on a team. The student fixture on
    // this box is not attached to one, so every product page bounces it to
    // /onboarding and there is no student-audience copy to look at. Skipping
    // says that; asserting against the onboarding page would have "passed"
    // while checking nothing.
    test.skip(
      /\/onboarding/.test(page.url()),
      "the student fixture is not on a team — nothing to check the student audience against",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Connectors" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
    await expect(page.getByText("CLIENT_SECRET")).toHaveCount(0);

    await openStudent(page, "/cad/pair");
    await expect(page.getByRole("heading", { level: 1, name: /Pair this computer/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("OAuth")).toHaveCount(0);
    const approve = page.getByRole("button", { name: "Approve pairing" });
    const chooseTeam = page.getByRole("link", { name: "Choose your team" });
    await expect(approve.or(chooseTeam)).toBeVisible();
    if (await approve.count()) {
      await page.getByLabel("Pairing code").fill("ABCD1234");
      await approve.click();
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  });
});

test.describe("marketing waitlist and sign-in", () => {
  test.describe.configure({ timeout: 60_000 });

  test("waitlist form still submits without Setup required", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your season stops living in spreadsheets." }),
    ).toBeVisible();
    const section = page.locator("#waitlist");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { name: "Join the waitlist." })).toBeVisible();
    const form = page.getByTestId("waitlist-form");
    const unavailable = page.getByTestId("waitlist-unavailable");
    await expect(form.or(unavailable)).toBeVisible();
    if (await unavailable.count()) {
      await expect(page.getByText("Setup required")).toHaveCount(0);
      return;
    }
    await form.getByLabel("Email").fill(`gui-week-${Date.now()}@example.com`);
    await form.getByLabel("FRC team number").fill("254");
    const join = form.getByRole("button", { name: "Join the waitlist" });
    await expect(join).toBeEnabled();
    await form.getByRole("checkbox", { name: /I agree to the Terms of Service/i }).check();
    await form.getByRole("checkbox", { name: /I agree to the Privacy Policy/i }).check();
    await join.click();
    const success = page.getByTestId("waitlist-success");
    const error = page.getByTestId("waitlist-error");
    const closed = page.getByTestId("waitlist-unavailable");
    await expect(success.or(closed).or(error)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Setup required")).toHaveCount(0);
  });

  test("sign-in email code and waitlist stay without Setup required", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toHaveCount(1);
    // By destination, not label — see signin-shell.spec.ts. It is "Request
    // access" today and was "Join the waitlist" before.
    const waitlist = page.locator('a[href*="waitlist"]').first();
    await expect(waitlist).toBeVisible();
    await expect(page.getByText("Setup required")).toHaveCount(0);
    await waitlist.click();
    await expect(page).toHaveURL(/waitlist|#waitlist|\/$/);
    await expect(page.getByText("Setup required")).toHaveCount(0);
    await expect(page.getByTestId("waitlist-form").or(page.getByTestId("waitlist-unavailable"))).toBeVisible();
  });
});
