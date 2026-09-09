import { requestPool } from "@vantage/db";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

/**
 * Public, unauthenticated form intake.
 *
 * Authorized solely by the opaque share token in the path, which proxy.ts
 * allow-lists with a narrow regex. Both database calls go through SECURITY
 * DEFINER functions (migration 0601) that return the minimum: `get_public_form`
 * never returns responses, respondent names or org internals, and returns NULL
 * unless the form is both `open` and `link`-audience. This is the same shape as
 * the parent-view resolver.
 *
 * `requestPool` is the app role. Nothing here touches @vantage/db/admin.
 *
 * CLAUDE.md says every request DB access goes through `withRls({ userId })`.
 * This route is the documented exception, for the same reason
 * /api/parent-view/[token] is: there is no user id to set, because the caller
 * has no account and never will. Tenancy is enforced instead by the SECURITY
 * DEFINER functions, which resolve the org from the token and can only ever
 * touch the one form it names. Do NOT copy this pattern into a route that does
 * have a session — there, `withRls` is what enforces tenancy.
 */
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

// A public form is spammable by definition, so the write path is limited per
// anonymised IP — but the limit has to survive the case the link exists for.
// A team running intake at a meeting has 40 students on one school Wi-Fi, and
// a school NATs every device behind a single address, so a 5-per-10-minutes
// cap locked out everyone after the fifth student. 60 per 10 minutes still
// stops a script while letting a whole team answer in one sitting.
const readLimiter = createRateLimiter({ limit: 120, windowMs: 60_000, namespace: "public-form-read" });
const writeLimiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, namespace: "public-form-write" });

function notFound(): Response {
  return Response.json(
    { error: "This form link is not valid, or the team has closed it." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function noStore(value: unknown, init?: ResponseInit): Response {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) return notFound();

  if (!(await readLimiter.allow(anonymizeIp(clientIp(request))))) {
    return rateLimitedResponse();
  }

  try {
    const result = await requestPool.query<{ form: unknown }>("SELECT get_public_form($1) AS form", [token]);
    const form = result.rows[0]?.form ?? null;
    if (!form) return notFound();
    return noStore({ form });
  } catch {
    // We cannot tell a bad token from an outage here, so say the honest thing
    // rather than implying the link is wrong.
    return noStore(
      { error: "We could not load this form right now. Please try again in a minute." },
      { status: 503 },
    );
  }
}

type PublicQuestion = { id: string; label: string; required: boolean };

type Body = {
  respondent?: string;
  answers?: Array<{ questionId: string; value: string | string[] }>;
};

/** Multi-select answers are joined the same way the signed-in path joins them. */
const MULTI_SEPARATOR = " | ";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) return notFound();

  if (!(await writeLimiter.allow(anonymizeIp(clientIp(request))))) {
    return rateLimitedResponse("You have submitted this form several times. Please wait a few minutes.");
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return noStore({ error: "Could not read that submission." }, { status: 400 });
  }

  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .filter((answer) => typeof answer?.questionId === "string")
    .map((answer) => ({
      questionId: answer.questionId,
      value: Array.isArray(answer.value) ? answer.value.join(MULTI_SEPARATOR) : String(answer.value ?? ""),
    }));

  if (answers.length === 0) {
    return noStore({ error: "Answer at least one question before sending." }, { status: 400 });
  }

  // Enforce required questions here too. The browser checks them, but the
  // signed-in submit path enforces them server-side and these two must agree
  // about what a valid response is — otherwise a scripted POST creates an
  // intake row with no student name, no email and no guardian phone.
  try {
    const shape = await requestPool.query<{ form: { questions?: PublicQuestion[] } | null }>(
      "SELECT get_public_form($1) AS form",
      [token],
    );
    const questions = shape.rows[0]?.form?.questions ?? [];
    const answered = new Set(
      answers.filter((answer) => answer.value.trim() !== "").map((answer) => answer.questionId),
    );
    const missing = questions.filter((question) => question.required && !answered.has(question.id));
    if (missing.length > 0) {
      return noStore(
        { error: `Please answer: ${missing.map((question) => question.label).join(", ")}` },
        { status: 400 },
      );
    }
  } catch {
    return noStore(
      { error: "We could not check this form right now. Please try again in a minute." },
      { status: 503 },
    );
  }

  try {
    const result = await requestPool.query<{ id: string | null }>(
      "SELECT submit_public_form_response($1, $2, $3::jsonb) AS id",
      [token, (body.respondent ?? "").slice(0, 120), JSON.stringify(answers)],
    );
    // NULL means the token is unknown or the form stopped accepting answers
    // between load and submit. The respondent gets one honest sentence either
    // way rather than a hint about which.
    if (!result.rows[0]?.id) return notFound();

    // Tell the team someone answered. Until now a prospective student could
    // fill in an intake link and nobody would ever know, because this route has
    // no session and cannot insert a notification for anyone — hence the
    // SECURITY DEFINER fan-out (0603), which addresses only the form's own
    // owners and admins.
    //
    // In-app only, and no name in the payload. The respondent gave that email
    // address to a team, not to Vantage: there is no account, no preferences
    // row and no unsubscribe path, so nothing is emailed to them and nothing
    // about them is emailed to anyone else. Leadership reads the answers on the
    // results page, behind org RLS.
    //
    // A failure here must not tell the respondent their answers were lost —
    // they were not; they are committed.
    try {
      await requestPool.query("SELECT notify_public_form_response($1)", [token]);
    } catch {
      // Intentionally silent: the submission succeeded.
    }

    return noStore({ ok: true });
  } catch {
    return noStore(
      { error: "We could not save your answers right now. Please try again in a minute." },
      { status: 503 },
    );
  }
}
