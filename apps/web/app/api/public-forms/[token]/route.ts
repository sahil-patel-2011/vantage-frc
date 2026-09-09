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
 */
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

// A public form is spammable by definition, so the write path is limited per
// IP. The read path is limited more loosely — a family opening the link twice
// on two phones is normal.
const readLimiter = createRateLimiter({ limit: 30, windowMs: 60_000, namespace: "public-form-read" });
const writeLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000, namespace: "public-form-write" });

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

  try {
    const result = await requestPool.query<{ id: string | null }>(
      "SELECT submit_public_form_response($1, $2, $3::jsonb) AS id",
      [token, (body.respondent ?? "").slice(0, 120), JSON.stringify(answers)],
    );
    // NULL means the token is unknown or the form stopped accepting answers
    // between load and submit. The respondent gets one honest sentence either
    // way rather than a hint about which.
    if (!result.rows[0]?.id) return notFound();
    return noStore({ ok: true });
  } catch {
    return noStore(
      { error: "We could not save your answers right now. Please try again in a minute." },
      { status: 503 },
    );
  }
}
