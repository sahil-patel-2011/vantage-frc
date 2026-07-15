import { NextResponse } from "next/server";
import { anonymizeIp, createRateLimiter } from "../../../lib/marketing/rate-limit";
import { createWaitlistStore, waitlistSchema } from "../../../lib/marketing/waitlist";

export const runtime = "nodejs";
const limiter = createRateLimiter();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const requestKey = anonymizeIp(ip);
  try {
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
  } catch {
    console.error("waitlist_submission", { outcome: "error", requestKey });
    return NextResponse.json(
      { ok: false, message: "We could not save your request. Please try again." },
      { status: 500 },
    );
  }
}
