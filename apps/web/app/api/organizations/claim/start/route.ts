import {
  CLAIM_INTENT_COOKIE,
  createClaimIntentToken,
  parseClaimIntentToken,
  peekClaimableFrcTeam,
  resolveAuthSecret,
} from "@vantage/core";
import { requestPool } from "@vantage/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CLAIM_DENIED_MESSAGE } from "../../../../../lib/claim/claim-flow";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, namespace: "claim-start" });

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function GET() {
  const jar = await cookies();
  const teamNumber = parseClaimIntentToken(jar.get(CLAIM_INTENT_COOKIE)?.value, resolveAuthSecret());
  return NextResponse.json({ teamNumber });
}

export async function POST(request: Request) {
  const key = `anon:${anonymizeIp(clientIp(request))}`;
  if (!(await limiter.allow(key))) {
    return rateLimitedResponse("Too many claim attempts. Wait a few minutes and try again.");
  }

  let teamNumber = 0;
  try {
    const body = (await request.json()) as { teamNumber?: number };
    teamNumber = Number(body.teamNumber);
  } catch {
    return NextResponse.json({ error: CLAIM_DENIED_MESSAGE }, { status: 400 });
  }
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
    return NextResponse.json({ error: CLAIM_DENIED_MESSAGE }, { status: 400 });
  }

  const client = await requestPool.connect();
  try {
    const claimable = await peekClaimableFrcTeam(client, teamNumber);
    if (!claimable) {
      return NextResponse.json({ error: CLAIM_DENIED_MESSAGE }, { status: 400 });
    }
    const token = createClaimIntentToken(teamNumber, resolveAuthSecret());
    const response = NextResponse.json({ ok: true, teamNumber });
    response.cookies.set(CLAIM_INTENT_COOKIE, token, cookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: CLAIM_DENIED_MESSAGE }, { status: 400 });
  } finally {
    client.release();
  }
}
