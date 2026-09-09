import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { baseOrigin, signInAs, signInFixture } from "./session";

/**
 * Browser coverage for the two features shipped without any: Forms (build,
 * answer, read) and Announcements (post, acknowledge, chase). Their logic has
 * unit tests; what had none were the seams between the page, the API and the
 * role a person actually holds.
 *
 * Everything below `describe("with real sessions")` needs a Better Auth session,
 * because `E2E_AUTH_FIXTURE` walks the proxy past its auth check without
 * minting one — every `requireSession()` route still answers 401 under it. Those
 * tests skip, loudly, when the box has no seeded accounts; the ones above do not
 * need auth at all.
 */

const HEX32 = "0123456789abcdef0123456789abcdef";

test.describe("the public intake page is not part of the app", () => {
  /**
   * A prospective student or a parent opens `/f/<token>` on a browser that has
   * signed into Vantage before — a shared shop laptop, a mentor's machine. The
   * shell used to render for them: a notifications bell, a workspace switcher,
   * and the account avatar of whoever signed in last, on a page that belongs to
   * someone with no account at all.
   *
   * The guard is a pathname test in theme-provider.tsx, so the honest way to
   * check it is to prove the shell renders on a product route in this very
   * browser and then does not render here.
   */
  test("renders no app shell for a visitor, even in a browser holding a session", async ({
    context,
    page,
  }) => {
    await signInFixture(context);

    await page.goto("/dashboard");
    await expect(page.locator("header.soft-topbar")).toHaveCount(1);
    await expect(page.getByTestId("soft-island")).toHaveCount(1);

    await page.goto(`/f/${HEX32}`);
    await expect(page.locator("main.public-form")).toBeVisible();
    await expect(page.locator("header.soft-topbar")).toHaveCount(0);
    await expect(page.getByTestId("soft-island")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Product navigation" })).toHaveCount(0);
  });

  /** An unknown or retired token says so instead of 500ing or blanking. */
  test("says a retired link is not available rather than failing", async ({ context, page }) => {
    await signInFixture(context);
    await page.goto(`/f/${HEX32}`);
    // The token is looked up client-side, so wait for the answer to arrive
    // rather than racing the "Loading…" state.
    await expect(page.locator(".public-form-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This form is not available");
    // Never a sign-in prompt: this reader has no account and never will.
    await expect(page.getByRole("link", { name: /sign in/i })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------

type Session = { context: BrowserContext; page: Page };

type FormQuestionShape = {
  id: string;
  kind: string;
  config?: { options?: string[] };
};

/** A complete, valid answer for every question, whatever its type. */
function answersFor(questions: FormQuestionShape[]) {
  return questions.map((question) => {
    const options = question.config?.options ?? [];
    if (question.kind === "multi_select") return { questionId: question.id, value: options.slice(0, 1) };
    if (options.length > 0) return { questionId: question.id, value: options[0]! };
    if (["number", "scale", "counter"].includes(question.kind)) return { questionId: question.id, value: "3" };
    if (question.kind === "date") return { questionId: question.id, value: "2027-01-09" };
    if (question.kind === "email") return { questionId: question.id, value: "dana@example.com" };
    return { questionId: question.id, value: "Dana" };
  });
}

/** POST straight at the product API as the signed-in user of `context`. */
async function api(
  context: BrowserContext,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await context.request.fetch(`${baseOrigin()}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", origin: baseOrigin() },
    ...(body ? { data: body } : {}),
    failOnStatusCode: false,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    /* an HTML redirect body */
  }
  return { status: response.status(), json };
}

/**
 * The workspace both fixture accounts belong to.
 *
 * The forms and announcements APIs resolve a bare request to the caller's first
 * membership ordered by org name, so an owner of two teams and a member of one
 * can easily default into different workspaces. Try each side's default and
 * keep the one the other can also load.
 */
async function sharedOrgId(owner: BrowserContext, member: BrowserContext): Promise<string | null> {
  const candidates: string[] = [];
  for (const context of [member, owner]) {
    const seen = await api(context, "/api/announcements");
    const orgId = typeof seen.json.orgId === "string" ? seen.json.orgId : null;
    if (orgId && !candidates.includes(orgId)) candidates.push(orgId);
  }
  for (const orgId of candidates) {
    const [a, b] = await Promise.all([
      api(owner, `/api/announcements?orgId=${orgId}`),
      api(member, `/api/announcements?orgId=${orgId}`),
    ]);
    if (a.status === 200 && b.status === 200) return orgId;
  }
  return null;
}

test.describe("with real sessions", () => {
  // Sign-ins are cached per account, but the acknowledgement test reads counts
  // the form test does not touch — keeping them ordered makes a failure legible.
  test.describe.configure({ mode: "serial" });

  let owner: Session;
  let member: Session;
  let orgId: string | null = null;
  let ready = false;

  test.beforeAll(async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const memberContext = await browser.newContext();
    const ownerIn = await signInAs(ownerContext, "owner");
    const memberIn = await signInAs(memberContext, "member");
    owner = { context: ownerContext, page: await ownerContext.newPage() };
    member = { context: memberContext, page: await memberContext.newPage() };
    if (!ownerIn || !memberIn) return;
    orgId = await sharedOrgId(ownerContext, memberContext);
    ready = orgId != null;
  });

  test.afterAll(async () => {
    await owner?.context.close();
    await member?.context.close();
  });

  test.beforeEach(() => {
    test.skip(
      !ready,
      "needs two seeded accounts (owner + non-admin member) in one workspace — set VANTAGE_E2E_OWNER_EMAIL / _PASSWORD and VANTAGE_E2E_MEMBER_EMAIL / _PASSWORD, or seed the local fixture accounts",
    );
  });

  const withOrg = (path: string) => `${path}${path.includes("?") ? "&" : "?"}orgId=${orgId}`;

  test("an owner builds and opens a form, a member answers it once", async () => {
    const title = `Intake ${Date.now()}`;

    // Build. The purpose grid stays disabled until the form has a name, so the
    // first thing this proves is that the gate is real.
    await owner.page.goto(withOrg("/forms"));
    const start = owner.page.locator(".forms-purpose").filter({ hasText: "New member intake" });
    await expect(start).toBeDisabled();
    await owner.page.getByRole("textbox", { name: "What are you asking?" }).fill(title);
    await expect(start).toBeEnabled();
    await start.click();

    // Creating navigates into the new form, carrying the workspace with it.
    await expect(owner.page).toHaveURL(/\/forms\/[0-9a-f-]{36}/);
    await expect(owner.page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const formId = new URL(owner.page.url()).pathname.split("/").pop()!;

    // A starter purpose arrives with questions, so it can be opened right away.
    await expect(owner.page.locator(".forms-questions li").first()).toBeVisible();
    await owner.page.getByRole("button", { name: "Open for answers" }).click();
    await expect(owner.page.getByText("Members of your team can answer.")).toBeVisible();

    // Answer, as somebody who cannot manage it.
    await member.page.goto(withOrg(`/forms/${formId}`));
    await expect(member.page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const answerPanel = member.page.locator(".forms-answer-panel");
    await expect(answerPanel).toBeVisible();
    for (const field of await answerPanel.locator("input:not([type=checkbox]), textarea, select").all()) {
      const tag = await field.evaluate((node) => node.tagName.toLowerCase());
      if (tag === "select") {
        const options = await field.locator("option").all();
        if (options.length > 1) await field.selectOption({ index: 1 });
        continue;
      }
      const type = await field.getAttribute("type");
      await field.fill(type === "number" ? "3" : type === "date" ? "2027-01-09" : type === "email" ? "dana@example.com" : "Dana");
    }
    await answerPanel.getByRole("button", { name: "Submit" }).click();

    // The owner's Responses tab counts it — the response actually landed.
    await owner.page.goto(withOrg(`/forms/${formId}`));
    await expect(owner.page.getByRole("button", { name: "Responses (1)" })).toBeVisible();

    // And the second attempt is refused rather than silently double-counted.
    // A complete answer set on purpose: an empty one would only prove the
    // required-field check fires, which is a different guard entirely.
    const seen = await api(member.context, withOrg(`/api/forms?formId=${formId}`));
    const questions = ((seen.json.form as { questions: FormQuestionShape[] }).questions ?? []);
    const again = await api(member.context, withOrg("/api/forms"), {
      action: "submit",
      formId,
      answers: answersFor(questions),
    });
    expect(again.status, `second submission returned ${again.status}`).toBe(409);
    expect(String(again.json.error)).toMatch(/already answered/i);

    await owner.page.reload();
    await expect(owner.page.getByRole("button", { name: "Responses (1)" })).toBeVisible();
  });

  test("a non-admin is offered no way to write a form or an announcement", async () => {
    // Forms index: no compose panel, and the API says no if you ask anyway.
    await member.page.goto(withOrg("/forms"));
    await expect(member.page.getByRole("heading", { level: 1, name: "Forms" })).toBeVisible();
    await expect(member.page.getByRole("heading", { level: 2, name: "Start a form" })).toHaveCount(0);
    await expect(member.page.getByRole("textbox", { name: "What are you asking?" })).toHaveCount(0);

    const create = await api(member.context, withOrg("/api/forms"), {
      action: "create_form",
      title: "Not mine to make",
      purpose: "intake",
    });
    expect(create.status).toBe(403);
    expect(String(create.json.error)).toMatch(/owners and admins/i);

    // A form they can see is read-only: one mode button, no Questions tab, no
    // status controls.
    const forms = await api(member.context, withOrg("/api/forms"));
    const list = (forms.json.forms ?? []) as Array<{ id: string }>;
    if (list.length > 0) {
      await member.page.goto(withOrg(`/forms/${list[0]!.id}`));
      const modes = member.page.getByRole("navigation", { name: "Form views" });
      await expect(modes.getByRole("button")).toHaveCount(1);
      await expect(modes.getByRole("button", { name: "Questions" })).toHaveCount(0);
      await expect(member.page.getByRole("button", { name: "Open for answers" })).toHaveCount(0);
      await expect(member.page.getByRole("button", { name: "Add question" })).toHaveCount(0);

      const edit = await api(member.context, withOrg("/api/forms"), {
        action: "add_question",
        formId: list[0]!.id,
        kind: "short_text",
        label: "Snuck in",
      });
      expect(edit.status).toBe(403);
    }

    // Announcements: no compose panel, and posting is refused.
    await member.page.goto(withOrg("/announcements"));
    await expect(member.page.getByRole("heading", { level: 1, name: "Announcements" })).toBeVisible();
    await expect(member.page.getByRole("heading", { level: 2, name: "Post to the team" })).toHaveCount(0);
    await expect(member.page.locator(".ann-compose")).toHaveCount(0);

    const post = await api(member.context, withOrg("/api/announcements"), {
      action: "post",
      title: "Not mine to post",
    });
    expect(post.status).toBe(403);
    expect(String(post.json.error)).toMatch(/owners and admins/i);
  });

  test("an acknowledgement moves the count and drops the name off the chase list", async () => {
    const title = `Bus at 6:15 (${Date.now()})`;

    await owner.page.goto(withOrg("/announcements"));
    await owner.page.getByRole("textbox", { name: "Title" }).fill(title);
    await owner.page.getByLabel("Require everyone to confirm they read it").check();
    await owner.page.getByRole("button", { name: /^Post to / }).click();

    const posted = owner.page.locator(".ann-item").filter({ hasText: title });
    await expect(posted).toBeVisible();

    // Counts are relative: another member of this workspace may confirm at any
    // time, so what is asserted is the movement this test causes.
    const readCount = async () => {
      const text = (await posted.locator(".ann-ack-count").innerText()).trim();
      const [confirmed, total] = text.match(/(\d+) of (\d+)/)!.slice(1).map(Number);
      return { confirmed: confirmed!, total: total! };
    };
    const before = await readCount();

    await owner.page.getByRole("button", { name: "Who has not confirmed?" }).first().click();
    const chaseBefore = await posted.locator(".ann-outstanding").innerText();
    expect(chaseBefore).toMatch(/Still to confirm/);

    // The member sees it, confirms it, and their own copy says so.
    await member.page.goto(withOrg("/announcements"));
    const mine = member.page.locator(".ann-item").filter({ hasText: title });
    await expect(mine).toBeVisible();
    await mine.getByRole("button", { name: "I have read this" }).click();
    await expect(mine.getByText("You confirmed this")).toBeVisible();
    // One acknowledgement, not one per click.
    await expect(mine.getByRole("button", { name: "I have read this" })).toHaveCount(0);

    await owner.page.reload();
    const after = await readCount();
    expect(after.confirmed, "acknowledgement did not move the count").toBe(before.confirmed + 1);
    expect(after.total).toBe(before.total);

    if (after.confirmed < after.total) {
      await owner.page.getByRole("button", { name: "Who has not confirmed?" }).first().click();
      const chaseAfter = await posted.locator(".ann-outstanding").innerText();
      expect(chaseAfter.length, "outstanding list did not shrink").toBeLessThan(chaseBefore.length);
    }
  });

  /**
   * The share link is the whole point of an intake form: it has to reach a
   * person with no account, and it must not be the session-gated `/forms/<id>`.
   */
  test("a link-audience form is answerable with no session at all", async ({ browser }) => {
    const created = await api(owner.context, withOrg("/api/forms"), {
      action: "create_form",
      title: `Public intake ${Date.now()}`,
      purpose: "intake",
      useStarter: true,
    });
    expect(created.status).toBe(200);
    const formId = String(created.json.formId);

    const opened = await api(owner.context, withOrg("/api/forms"), {
      action: "set_status",
      formId,
      status: "open",
      audience: "link",
    });
    expect(opened.status).toBe(200);

    const detail = await api(owner.context, withOrg(`/api/forms?formId=${formId}`));
    const form = detail.json.form as { shareToken: string | null; title: string };
    expect(form.shareToken, "opening a link-audience form must mint a share token").toBeTruthy();

    // A brand new browser: no cookies, no session, nothing signed in.
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await page.goto(`/f/${form.shareToken}`);
    await expect(page.getByRole("heading", { level: 1, name: form.title })).toBeVisible();
    await expect(page.locator("header.soft-topbar")).toHaveCount(0);
    await expect(page.getByTestId("soft-island")).toHaveCount(0);
    await visitor.close();
  });
});
