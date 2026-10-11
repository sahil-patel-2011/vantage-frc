import { createEmailProvider } from "@vantage/core";
import { DEFAULT_NOTICE, jobStalled, readBroadcastJob } from "../../../../lib/outage/broadcast";
import { consoleJson, openConsole } from "../../../../lib/outage/console";
import { readNotice } from "../../../../lib/outage/notice";
import { probeDatabase, reportProbeOutcome } from "../../../../lib/outage/probe";
import { readRecipientMeta } from "../../../../lib/outage/recipients";
import { EMAIL_SETUP_MESSAGE, outageOwnerEmail } from "../../../../lib/outage/runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/status/outage — the outage console's data. Authorized by the signed link from the
 * owner's alert email (`Authorization: Bearer <token>`), never a session: the database that
 * holds sessions is the thing that is down.
 */
export async function GET(request: Request) {
  const opened = await openConsole(request);
  if (!opened.ok) return opened.response;
  const { store, incident, incidentId, expiresAt } = opened.context;

  const probe = await probeDatabase();
  reportProbeOutcome(probe, "outage console");

  const [notice, contacts, limitedJob, recoveredJob] = await Promise.all([
    readNotice(store).catch(() => null),
    readRecipientMeta(store).catch(() => null),
    readBroadcastJob(store, incidentId, "limited").catch(() => null),
    readBroadcastJob(store, incidentId, "recovered").catch(() => null),
  ]);
  const emailReady = createEmailProvider().name !== "unconfigured";

  return consoleJson({
    incidentId,
    linkExpiresAt: new Date(expiresAt).toISOString(),
    incident: incident
      ? {
          firstSeen: incident.firstSeen,
          lastSeen: incident.lastSeen,
          closedAt: incident.closedAt,
          failures: incident.failures,
          sources: incident.sources,
          classification: incident.classification,
          causes: incident.causes,
        }
      : null,
    live: { database: probe.ok ? "ok" : "unreachable", checkedInMs: probe.ms, checkedAt: new Date().toISOString() },
    notice: notice ? { limited: true, message: notice.message, since: notice.since } : { limited: false },
    contacts: contacts ? { ...contacts } : null,
    sharedStore: store.kind === "upstash",
    jobs: {
      limited: limitedJob ? { ...limitedJob, stalled: jobStalled(limitedJob) } : null,
      recovered: recoveredJob ? { ...recoveredJob, stalled: jobStalled(recoveredJob) } : null,
    },
    ownerConfigured: Boolean(outageOwnerEmail()),
    email: emailReady ? { configured: true } : { configured: false, message: EMAIL_SETUP_MESSAGE },
    defaults: DEFAULT_NOTICE,
  });
}
