import {
  auth,
  CLAIM_INTENT_COOKIE,
  JOIN_LINK_COOKIE,
  runWithClaimIntent,
  runWithJoinLinkToken,
} from "@vantage/core";
import { toNextJsHandler } from "better-auth/next-js";
import { cookies } from "next/headers";

const handlers = toNextJsHandler(auth);

async function withAuthCookies(request: Request, method: "GET" | "POST") {
  const jar = await cookies();
  const joinToken = jar.get(JOIN_LINK_COOKIE)?.value ?? null;
  const claimToken = jar.get(CLAIM_INTENT_COOKIE)?.value ?? null;
  return runWithJoinLinkToken(joinToken, () =>
    runWithClaimIntent(claimToken, () => handlers[method](request)),
  );
}

export function GET(request: Request) {
  return withAuthCookies(request, "GET");
}

export function POST(request: Request) {
  return withAuthCookies(request, "POST");
}
