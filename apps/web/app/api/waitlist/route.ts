import { NextResponse } from "next/server";
import { anonymizeIp, createRateLimiter } from "../../../lib/marketing/rate-limit";
import {
  WaitlistUnavailableError,
  createWaitlistStore,
  waitlistBackend,
  waitlistSchema,
} from "../../../lib/marketing/waitlist";
import { waitlistUnavailableMessage } from "../../../lib/marketing/waitlist-copy";

export const runtime = "nodejs";
const limiter = createRateLimiter();

function setupRequiredResponse() {
  return NextResponse.json(
    { ok: false, status: "setup_required", message: waitlistUnavailableMessage() },
    { status: 503 },
  );
}

/** Lets the public form paint an empty/setup state before submit. */
export async function GET() {
  if (waitlistBackend() === "unavailable") return setupRequiredResponse();
  return NextResponse.json({ ok: true, status: "ready" });
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const requestKey = anonymizeIp(ip);
  try {
    if (waitlistBackend() === "unavailable") {
      console.info("waitlist_submission", { outcome: "setup_required", requestKey });
      return setupRequiredResponse();
    }
    if (!(await limiter.allow(requestKey))) {
      console.info("waitlist_submission", { outcome: "rate_limited", requestKey });
      return NextResponse.json({ ok: false, message: "Please wait before trying again." }, { status: 429 });
    }
    const parsed = waitlistSchema.safeParse(await request.json());
    if (!parsed.success) {
      console.info("waitlist_submission", { outcome: "invalid", requestKey });
      return NextResponse.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Check your information." },
        { status: 400 },
      );
    }
    await createWaitlistStore().upsert(parsed.data);
    console.info("waitlist_submission", { outcome: "accepted", requestKey });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WaitlistUnavailableError) {
      console.info("waitlist_submission", { outcome: "setup_required", requestKey });
      return setupRequiredResponse();
    }
    console.error("waitlist_submission", { outcome: "error", requestKey });
    return NextResponse.json(
      { ok: false, message: "We could not save your request. Please try again." },
      { status: 500 },
    );
  }
}
