/**
 * Shared IndexedDB snapshots for offline-capable product pages.
 * Scouting keeps its dedicated outbox in scout-offline.ts; other features
 * read last-good API payloads here when venue Wi-Fi drops.
 */

export type OfflineFeature =
  | "calendar"
  | "team-calendar"
  | "todos"
  | "logistics"
  | "my-day"
  | "competition"
  | "files"
  | "docs"
  | "dashboard"
  | "chat"
  | "video-analysis"
  | "relays"
  | "strategy"
  | "hours"
  | "match-checklist"
  | "match-notes"
  | "packing"
  | "batteries"
  | "pit"
  | "season-tasks"
  | "schedule"
  | "assembly-manual"
  | "chemistry"
  | "pick-clock"
  | "alliance-desk"
  | "print-farm"
  | "inventory"
  | "defense-planner"
  | "picklist-collab"
  | "dossier"
  | "pit-repair"
  | "event-day-plan"
  | "field-reset"
  | "drive-signals"
  | "weigh-in"
  | "match-delta"
  | "match-video-index"
  | "draft"
  | "lineup"
  | "strategy-cards"
  | "match-copilot"
  | "event-readiness"
  | "match-video"
  | "inspection"
  | "inspection-copilot"
  | "fmea"
  | "match-sim"
  | "pit-map"
  | "pairwise"
  | "team-tags"
  | "shift-balancer"
  | "counter-book"
  | "overnight-intel"
  | "intel"
  | "alliance-brief"
  | "picklist-justifier"
  | "opponent-watchlist"
  | "alliance-sim"
  | "briefing"
  | "award-tracker"
  | "epa-trend"
  | "rankings"
  | "grant-report"
  | "media-kit"
  | "sponsor-wall"
  | "sponsor-suite"
  | "outreach-calendar"
  | "visit-invites"
  | "judge-sim"
  | "impact-essay"
  | "battery-rotation"
  | "vendors"
  | "season-report"
  | "media"
  | "battery-health-forecast"
  | "vendor-lead-times"
  | "bin-shelf-locator"
  | "build-burndown"
  | "cad-change-radar"
  | "code-deploy-log"
  | "control-map"
  | "cross-team-scrim"
  | "decision-search"
  | "decisions"
  | "failure-patterns"
  | "grant-eligibility-matcher"
  | "hours-self-view"
  | "knowledge-gap"
  | "matching-gift-finder"
  | "onboarding-buddy"
  | "risk-burndown"
  | "spare-robot-kit"
  | "sponsor-renewal-roi"
  | "team-health-dashboard"
  | "spare-forecast"
  | "sketch-to-brief"
  | "scout-assisted-count"
  | "scout-coverage-live"
  | "scout-field-budget"
  | "scouting-teams"
  | "scouting-heat-signals"
  | "scout-data-impact"
  | "scout-disagreements"
  | "scout-accuracy"
  | "scout-crossval"
  | "rule-impact"
  | "season-planning-workspace"
  | "retro"
  | "team-data"
  | "tuning-autopilot"
  | "video-rescout"
  | "fundraisers"
  | "impact"
  | "orders"
  | "grants-writing"
  | "practice"
  | "manufacturing"
  | "attendance"
  | "kickoff"
  | "match-debrief"
  | "ranking-projection"
  | "whiteboard"
  | "robot"
  | "my-kit"
  | "part-requests"
  | "recognition"
  | "subteams"
  | "budget"
  | "sponsorship"
  | "safety"
  | "writer"
  | "learning"
  | "training"
  | "tool-checkout"
  | "goals"
  | "cad-vault"
  | "cad-learn"
  | "reimbursements"
  | "costs"
  | "cad-review-queue"
  | "duties"
  | "announcements"
  | "risks"
  | "subsystem-signoff"
  | "prototype-tracker"
  | "equipment-maintenance"
  | "notifications"
  | "forms"
  | "incidents"
  | "roles"
  | "parts-catalog"
  | "parts-relay"
  | "cad-setup"
  | "account"
  | "ai-bridge"
  | "ai-keys"
  | "ai-runs"
  | "ai-usage"
  | "alumni"
  | "alumni-network"
  | "auth-policy"
  | "auto-routines"
  | "auton-path-library"
  | "awards"
  | "bom-cost-rollup"
  | "bringup"
  | "budget-reconciler"
  | "bus-factor"
  | "cad-connections"
  | "checklist-library"
  | "code-perf"
  | "connectors"
  | "cross-domain-alerts"
  | "data-quality-scorecard"
  | "decision-critic"
  | "degraded-mode"
  | "discord"
  | "district-advancement"
  | "doc-roles"
  | "driver-tryouts"
  | "exit-interview"
  | "form-detail"
  | "funding-profile"
  | "gearbox"
  | "getting-started"
  | "goals-tracker"
  | "grants-calendar"
  | "hours-kiosk"
  | "hub-access"
  | "incident-heatmap"
  | "knowledge"
  | "knowledge-drafts"
  | "leadership"
  | "media-library"
  | "meeting-autopilot"
  | "member-capabilities"
  | "mentor-hours"
  | "migrate"
  | "mock-judging"
  | "notebook"
  | "notification-prefs"
  | "object-chat-bridge"
  | "parents"
  | "power-budget"
  | "presence"
  | "prompts"
  | "readiness-score"
  | "reuse-advisor"
  | "reviews"
  | "roadmap"
  | "safety-training"
  | "scout-forms"
  | "scout-p2p-relay"
  | "scout-schema-negotiate"
  | "scout-training-mode"
  | "search"
  | "season-rollover"
  | "security"
  | "shooter-table"
  | "showcase"
  | "skills-graph"
  | "slack"
  | "software-versions"
  | "spares"
  | "sponsor-tier-calculator"
  | "standup-digest"
  | "start"
  | "storage"
  | "subsystems"
  | "support"
  | "support-tickets"
  | "team-admin"
  | "team-background"
  | "team-profile"
  | "troubleshoot"
  | "tuning"
  | "weight-budget"
  | "whats-new"
  | "wiring"
  | "wiring-diagnoser"
  | "scouting"
  | "pick-desk"
  | "business"
  | "season-finance"
  | "partner-placements";

import { offlineSnapshotUser } from "./identity";
import { cacheJsonBytes, checkCacheSpace } from "./storage-budget";

const DB_NAME = "vantage-feature-cache";
const DB_VERSION = 2;
const STORE = "snapshots";
let signedOut = false;

export type FeatureSnapshot<T> = {
  key: string;
  feature: OfflineFeature;
  orgId: string;
  userId: string;
  data: T;
  cachedAt: string;
};

export function featureCacheKey(feature: OfflineFeature, orgId: string, variant = ""): string {
  const org = orgId.trim() || "_";
  const extra = variant.trim();
  return extra ? `${feature}:${org}:${extra}` : `${feature}:${org}`;
}

export function personalFeatureCacheKey(userId: string, feature: OfflineFeature, orgId: string, variant = ""): string {
  return `${userId}:${featureCacheKey(feature, orgId, variant)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      } else if (event.oldVersion < 2) {
        // Legacy rows have no authenticated owner. Discard only these read caches;
        // scouting drafts and unsent outboxes are separate databases.
        request.transaction!.objectStore(STORE).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error("Close the other Vantage tab to update private read caches."));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function putFeatureSnapshot<T>(
  feature: OfflineFeature,
  orgId: string,
  data: T,
  variant = "",
): Promise<void> {
  // Nothing is written once sign-out has started (a save still in flight must not leave a view
  // behind), and each snapshot belongs to the person who saved it.
  if (typeof indexedDB === "undefined" || signedOut) return;
  const userId = await offlineSnapshotUser(orgId);
  if (!userId || signedOut) return;
  await checkCacheSpace(cacheJsonBytes(data));
  const db = await openDatabase();
  try {
    if (signedOut) return;
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const row: FeatureSnapshot<T> = {
      key: personalFeatureCacheKey(userId, feature, orgId, variant),
      feature,
      orgId: orgId.trim() || "_",
      userId,
      data,
      cachedAt: new Date().toISOString(),
    };
    await requestValue(store.put(row));
  } finally { db.close(); }
}

export async function getFeatureSnapshot<T>(
  feature: OfflineFeature,
  orgId: string,
  variant = "",
): Promise<FeatureSnapshot<T> | null> {
  if (typeof indexedDB === "undefined") return null;
  const userId = await offlineSnapshotUser(orgId);
  if (!userId) return null;
  const db = await openDatabase();
  try {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const row = await requestValue<FeatureSnapshot<T> | undefined>(
      store.get(personalFeatureCacheKey(userId, feature, orgId, variant)),
    );
    return row?.userId === userId ? row : null;
  } finally { db.close(); }
}

export async function clearFeatureSnapshot(feature: OfflineFeature, orgId: string, variant = ""): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const userId = await offlineSnapshotUser(orgId);
  if (!userId) return;
  const db = await openDatabase();
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await requestValue(store.delete(personalFeatureCacheKey(userId, feature, orgId, variant)));
  } finally { db.close(); }
}

/** Remove last-good read caches when a person leaves a shared browser. */
export async function clearFeatureSnapshots(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  try { await requestValue(db.transaction(STORE, "readwrite").objectStore(STORE).clear()); }
  finally { db.close(); }
}

/** Clear downloaded views on shared devices, without touching unsent reports or drafts. */
export async function clearFeatureSnapshotsOnSignOut(): Promise<void> {
  signedOut = true;
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore(STORE).clear();
    });
  } finally { db.close(); }
}
