import { globalReferenceAdminStore } from "./admin-store";
import { StatboticsClient } from "./statbotics-client";
import { TbaClient } from "./tba-client";
import { createGlobalReferenceJobs } from "./worker";

export function createProductionReferenceJobs() {
  const authKey = process.env.TBA_AUTH_KEY?.trim();
  if (!authKey)
    throw new Error("TBA_AUTH_KEY is required to run global reference ingest");

  return createGlobalReferenceJobs({
    store: globalReferenceAdminStore,
    tba: new TbaClient({
      authKey,
      baseUrl: process.env.TBA_API_BASE_URL,
      userAgent: process.env.REFERENCE_INGEST_USER_AGENT,
    }),
    statbotics: new StatboticsClient({
      baseUrl: process.env.STATBOTICS_API_BASE_URL,
      userAgent: process.env.REFERENCE_INGEST_USER_AGENT,
      minimumIntervalMs: readPositiveInteger("STATBOTICS_MIN_INTERVAL_MS", 350),
      maximumAttempts: readPositiveInteger("STATBOTICS_MAX_ATTEMPTS", 4),
    }),
  });
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
