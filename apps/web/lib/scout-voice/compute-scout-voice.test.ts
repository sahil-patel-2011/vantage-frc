import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeScoutVoiceView } from "./compute-scout-voice";
import {
  estimateCloudSttCostUsd,
  isScoutVoiceConsentCurrent,
  isScoutVoiceFullyEnabled,
  SCOUT_VOICE_CONSENT_VERSION,
} from ".";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("scout-voice helpers", () => {
  it("requires matching consent version for opt-in", () => {
    expect(isScoutVoiceConsentCurrent(SCOUT_VOICE_CONSENT_VERSION)).toBe(true);
    expect(isScoutVoiceConsentCurrent("old")).toBe(false);
    expect(
      isScoutVoiceFullyEnabled({
        orgEnabled: true,
        orgAckVersion: SCOUT_VOICE_CONSENT_VERSION,
        userEnabled: true,
        userAckVersion: SCOUT_VOICE_CONSENT_VERSION,
      }),
    ).toBe(true);
    expect(
      isScoutVoiceFullyEnabled({
        orgEnabled: true,
        orgAckVersion: SCOUT_VOICE_CONSENT_VERSION,
        userEnabled: false,
        userAckVersion: null,
      }),
    ).toBe(false);
  });

  it("estimates cloud STT cost from audio size", () => {
    expect(estimateCloudSttCostUsd(0)).toBeGreaterThan(0);
    expect(estimateCloudSttCostUsd(120_000)).toBeGreaterThan(estimateCloudSttCostUsd(2_000));
  });
});

describe("computeScoutVoiceView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeScoutVoiceView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.consentVersion).toBe(SCOUT_VOICE_CONSENT_VERSION);
      expect(view.steps[0]?.id).toBe("workspace");
    }
  });

  it("returns opt_in_required when org voice notes are disabled", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, role: "scout" }] };
      }
      if (sql.includes("FROM scout_voice_org_settings")) {
        return { rows: [{ enabled: false, consentAckVersion: null, acceptedAt: null, acceptedBy: null }] };
      }
      if (sql.includes("FROM scout_voice_user_prefs")) {
        return { rows: [{ enabled: false, consentAckVersion: null, acceptedAt: null }] };
      }
      if (sql.includes("FROM scout_voice_notes")) return { rows: [] };
      if (sql.includes("FROM org_llm_keys") || sql.includes("FROM org_provider_configs")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const view = await computeScoutVoiceView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("opt_in_required");
    if (view.status === "opt_in_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.canManageOrg).toBe(false);
      expect(view.orgSettings.enabled).toBe(false);
    }
  });

  it("returns live when org and user have current consent", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, role: "admin" }] };
      }
      if (sql.includes("FROM scout_voice_org_settings")) {
        return {
          rows: [
            {
              enabled: true,
              consentAckVersion: SCOUT_VOICE_CONSENT_VERSION,
              acceptedAt: "2026-07-18T00:00:00.000Z",
              acceptedBy: USER,
            },
          ],
        };
      }
      if (sql.includes("FROM scout_voice_user_prefs")) {
        return {
          rows: [
            {
              enabled: true,
              consentAckVersion: SCOUT_VOICE_CONSENT_VERSION,
              acceptedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM scout_voice_notes")) {
        return {
          rows: [
            {
              id: "note-1",
              eventKey: "2026txho",
              matchKey: "2026txho_qm1",
              teamKey: "frc254",
              entryType: "match",
              entryClientId: "entry-1",
              entryId: null,
              mediaClientId: null,
              transcript: "Defense bot, low climb.",
              sttSource: "browser",
              consentAckVersion: SCOUT_VOICE_CONSENT_VERSION,
              createdBy: USER,
              createdAt: "2026-07-18T12:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM org_llm_keys") || sql.includes("FROM org_provider_configs")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    });

    const view = await computeScoutVoiceView(client, {
      userId: USER,
      requestedOrg: ORG,
      eventKey: "2026txho",
    });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.notes).toHaveLength(1);
      expect(view.notes[0]?.transcript).toContain("Defense");
      expect(view.canManageOrg).toBe(true);
      expect(view.providers.cloudConfigured).toBe(Boolean(process.env.OPENAI_API_KEY?.trim()));
    }
  });
});
