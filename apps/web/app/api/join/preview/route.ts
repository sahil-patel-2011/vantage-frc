import {
  JOIN_LINK_COOKIE,
  isInviteTokenShape,
  peekTeamJoinLink,
} from "@vantage/core";
import { requestPool } from "@vantage/db";
import { NextResponse } from "next/server";
import { anonymizeIp, clientIp, createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const limiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "join-preview" });

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function GET(request: Request) {
  const key = `anon:${anonymizeIp(clientIp(request))}`;
  if (!(await limiter.allow(key))) {
    return rateLimitedResponse("Too many join-link lookups. Wait a few minutes and try again.");
  }

  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!isInviteTokenShape(token)) {
    return NextResponse.json({ error: "That join link is not valid" }, { status: 400 });
  }

  const client = await requestPool.connect();
  try {
    const preview = await peekTeamJoinLink(client, token);
    if (!preview) {
      const missing = NextResponse.json({ preview: null }, { status: 404 });
      missing.headers.set("cache-control", "private, no-store, max-age=0");
      return missing;
    }
    const response = NextResponse.json({ preview });
    response.headers.set("cache-control", "private, no-store, max-age=0");
    if (preview.status === "open") {
      response.cookies.set(JOIN_LINK_COOKIE, token, cookieOptions());
    }
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load this join link" },
      { status: 400 },
    );
  } finally {
    client.release();
  }
}
