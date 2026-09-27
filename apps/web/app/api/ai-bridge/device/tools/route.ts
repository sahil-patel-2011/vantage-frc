import { invokePersonalTool, listPersonalTools, personalDeviceIdentity, PersonalToolError } from "../../../../../lib/ai-bridge/feature-tools";
import { createRateLimiter } from "../../../../../lib/rate-limit";

const limiter = createRateLimiter({ namespace: "personal-feature-tools", limit: 60 });
const noStore = { "cache-control": "private, no-store" };

async function identity(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,512})$/)?.[1];
  if (!token) throw new PersonalToolError("Personal device token required.", 401);
  const person = await personalDeviceIdentity(token);
  if (!await limiter.allow(person.deviceId)) throw new PersonalToolError("Too many tool requests. Try again shortly.", 429);
  return person;
}
function fail(error: unknown) {
  return Response.json({ error: error instanceof PersonalToolError ? error.message : "Vantage could not complete this tool request." }, { status: error instanceof PersonalToolError ? error.status : 503, headers: noStore });
}
export async function GET(request: Request) {
  try { return Response.json({ tools: await listPersonalTools(await identity(request)) }, { headers: noStore }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const person = await identity(request);
    const text = await request.text();
    if (text.length > 20_000) throw new PersonalToolError("Tool request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { throw new PersonalToolError("Tool request must be a JSON object.", 400); }
    if (Object.keys(body).some((key) => key !== "name" && key !== "input") || typeof body.name !== "string") throw new PersonalToolError("Only name and input are accepted. Your identity comes from your paired device.", 400);
    return Response.json({ result: await invokePersonalTool(person, body.name, body.input) }, { headers: noStore });
  } catch (error) { return fail(error); }
}
