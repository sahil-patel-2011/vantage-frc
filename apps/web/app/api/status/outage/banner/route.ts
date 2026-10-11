import { z } from "zod";
import { DEFAULT_NOTICE } from "../../../../../lib/outage/broadcast";
import { consoleJson, openConsole } from "../../../../../lib/outage/console";
import { publicStatus, turnOffNotice, turnOnNotice } from "../../../../../lib/outage/notice";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(10).max(600),
  on: z.boolean(),
  message: z.string().trim().max(4000).optional(),
});

/** POST /api/status/outage/banner — turn the in-app "Vantage is limited" banner on or off. */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return consoleJson({ error: "Send the form as JSON." }, 400);
  }
  const opened = await openConsole(request, { body: raw as { token?: unknown }, write: true });
  if (!opened.ok) return opened.response;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return consoleJson({ error: "Say whether the banner should be on or off.", code: "invalid" }, 400);

  const { store, incidentId } = opened.context;
  if (parsed.data.on) {
    const notice = await turnOnNotice(store, {
      message: parsed.data.message || DEFAULT_NOTICE.limited.message,
      incidentId,
    });
    return consoleJson({ notice: publicStatus(notice) });
  }
  await turnOffNotice(store);
  return consoleJson({ notice: publicStatus(null) });
}
