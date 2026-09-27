import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@vantage/core";
import { REMEMBERED_TEAM_COOKIE } from "../../../../lib/nav/remembered-team";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  const response = await handlers.POST(request);
  if (new URL(request.url).pathname === "/api/auth/sign-out" && response.ok) {
    const headers = new Headers(response.headers);
    headers.append("set-cookie", `${REMEMBERED_TEAM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
