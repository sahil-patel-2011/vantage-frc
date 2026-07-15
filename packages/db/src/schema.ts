import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const orgRole = pgEnum("org_role", [
  "owner",
  "admin",
  "scout",
  "viewer",
]);
export const inviteStatus = pgEnum("invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const billingTier = pgEnum("billing_tier", [
  "free",
  "starter",
  "team",
  "enterprise",
]);
export const keySource = pgEnum("key_source", ["platform", "byo", "local", "local_cli"]);
export const scoutSchemaType = pgEnum("scout_schema_type", ["match", "pit"]);
export const scoutConfidence = pgEnum("scout_confidence", [
  "high",
  "normal",
  "low",
]);
export const scoutSource = pgEnum("scout_source", [
  "manual",
  "voice",
  "import",
]);
export const scoutMediaKind = pgEnum("scout_media_kind", ["photo", "video"]);
export const scoutMediaStatus = pgEnum("scout_media_status", [
  "pending",
  "uploaded",
  "failed",
]);
export const disagreementStatus = pgEnum("disagreement_status", [
  "open",
  "resolved",
  "dismissed",
]);
export const researchTrigger = pgEnum("research_trigger", [
  "scheduled",
  "on_demand",
  "event_locked",
]);
export const researchStatus = pgEnum("research_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export const researchSourceType = pgEnum("research_source_type", [
  "cd_post",
  "social",
  "news",
  "reveal_video",
  "team_site",
  "other",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  image: text("avatar_url"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    authMethod: text("auth_method").notNull().default("unknown"),
    email2faVerifiedAt: timestamp("email_2fa_verified_at", { withTimezone: true }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_uq").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  notificationPrefs: jsonb("notification_prefs").notNull().default({}),
  themePreference: text("theme_preference").notNull().default("light"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  dateOfBirth: date("date_of_birth", { mode: "date" }),
  gender: text("gender"),
  preferredTeamNumber: integer("preferred_team_number"),
  teamRole: text("team_role"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
});

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  grantedBy: uuid("granted_by").references(() => users.id),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  teamNumber: integer("team_number"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamps.createdAt,
});

export const orgAuthPolicies = pgTable("org_auth_policies", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  allowPassword: boolean("allow_password").notNull().default(false),
  allowGoogle: boolean("allow_google").notNull().default(true),
  allowEmailOtp: boolean("allow_email_otp").notNull().default(true),
  mfaPolicy: text("mfa_policy").$type<"off" | "optional" | "required">().notNull().default("optional"),
  rememberedDeviceDays: integer("remembered_device_days").notNull().default(14),
  updatedBy: uuid("updated_by").references(() => users.id),
  ...timestamps,
});

export const userMfaEnrollments = pgTable("user_mfa_enrollments", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  encryptedSecret: text("encrypted_secret").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  recoveryGeneration: integer("recovery_generation").notNull().default(1),
  ...timestamps,
});

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  generation: integer("generation").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("mfa_recovery_user_hash_uq").on(table.userId, table.codeHash)]);

export const mfaStepUpSessions = pgTable("mfa_step_up_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  totpStep: text("totp_step"),
}, (table) => [uniqueIndex("mfa_step_up_session_org_uq").on(table.sessionId, table.orgId)]);

export const rememberedMfaDevices = pgTable("remembered_mfa_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const authPolicyAuditEvents = pgTable("auth_policy_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamps.createdAt,
}, (table) => [index("auth_policy_audit_org_created_idx").on(table.orgId, table.createdAt)]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("memberships_org_user_uq").on(table.orgId, table.userId),
  ],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: orgRole("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  status: inviteStatus("status").notNull().default("pending"),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamps.createdAt,
});

export const authAuditEvents = pgTable(
  "auth_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    emailHash: text("email_hash"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    success: boolean("success").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("auth_audit_action_created_idx").on(table.action, table.createdAt)],
);

export const membershipAuditEvents = pgTable(
  "membership_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id").references(() => invites.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetEmailHash: text("target_email_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("membership_audit_org_created_idx").on(table.orgId, table.createdAt)],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export type MatchAlliance = {
  score: number | null;
  teamKeys: string[];
  surrogateTeamKeys: string[];
  dqTeamKeys: string[];
};

export const teamsRef = pgTable(
  "teams_ref",
  {
    teamKey: text("team_key").primaryKey(),
    teamNumber: integer("team_number").notNull().unique(),
    nickname: text("nickname"),
    name: text("name").notNull(),
    city: text("city"),
    stateProv: text("state_prov"),
    country: text("country"),
    postalCode: text("postal_code"),
    rookieYear: integer("rookie_year"),
    website: text("website"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("teams_ref_number_idx").on(table.teamNumber)],
);

export const eventsRef = pgTable(
  "events_ref",
  {
    eventKey: text("event_key").primaryKey(),
    year: integer("year").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    eventType: integer("event_type"),
    week: integer("week"),
    districtKey: text("district_key"),
    city: text("city"),
    stateProv: text("state_prov"),
    country: text("country"),
    address: text("address"),
    postalCode: text("postal_code"),
    timezone: text("timezone"),
    website: text("website"),
    parentEventKey: text("parent_event_key"),
    webcasts: jsonb("webcasts")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("events_ref_year_start_idx").on(table.year, table.startDate),
  ],
);

export const matchesRef = pgTable(
  "matches_ref",
  {
    matchKey: text("match_key").primaryKey(),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey, { onDelete: "cascade" }),
    compLevel: text("comp_level").notNull(),
    setNumber: integer("set_number").notNull(),
    matchNumber: integer("match_number").notNull(),
    redAlliance: jsonb("red_alliance").$type<MatchAlliance>().notNull(),
    blueAlliance: jsonb("blue_alliance").$type<MatchAlliance>().notNull(),
    winningAlliance: text("winning_alliance"),
    eventTime: timestamp("event_time", { withTimezone: true }),
    predictedTime: timestamp("predicted_time", { withTimezone: true }),
    actualTime: timestamp("actual_time", { withTimezone: true }),
    postResultTime: timestamp("post_result_time", { withTimezone: true }),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<
      string,
      unknown
    > | null>(),
    videos: jsonb("videos")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("matches_ref_event_order_idx").on(
      table.eventKey,
      table.compLevel,
      table.setNumber,
      table.matchNumber,
    ),
  ],
);

export const teamEventMetrics = pgTable(
  "team_event_metrics",
  {
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey, { onDelete: "cascade" }),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey, { onDelete: "cascade" }),
    epaTotal: doublePrecision("epa_total"),
    epaAuto: doublePrecision("epa_auto"),
    epaTeleop: doublePrecision("epa_teleop"),
    epaEndgame: doublePrecision("epa_endgame"),
    opr: doublePrecision("opr"),
    dpr: doublePrecision("dpr"),
    ccwm: doublePrecision("ccwm"),
    rank: integer("rank"),
    wins: integer("wins"),
    losses: integer("losses"),
    ties: integer("ties"),
    source: text("source").notNull(),
    sourcePayload: jsonb("source_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamKey, table.eventKey, table.source] }),
    index("team_event_metrics_event_idx").on(
      table.eventKey,
      table.source,
      table.rank,
    ),
  ],
);

export const teamYearMetrics = pgTable(
  "team_year_metrics",
  {
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    epaTotal: doublePrecision("epa_total"),
    epaAuto: doublePrecision("epa_auto"),
    epaTeleop: doublePrecision("epa_teleop"),
    epaEndgame: doublePrecision("epa_endgame"),
    source: text("source").notNull(),
    sourcePayload: jsonb("source_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamKey, table.year, table.source] }),
    index("team_year_metrics_year_idx").on(
      table.year,
      table.source,
      table.epaTotal,
    ),
  ],
);

export const syncCursors = pgTable(
  "sync_cursors",
  {
    source: text("source").notNull(),
    resource: text("resource").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    cursor: text("cursor"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.source, table.resource] })],
);

export const dataSourceCredentials = pgTable("data_source_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  opaqueKeyId: text("opaque_key_id").notNull().unique(),
  encryptedSecret: text("encrypted_secret").notNull(),
  status: text("status").notNull().default("untested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestStatus: integer("last_test_status"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("data_source_credentials_source_org_idx").on(table.source, table.orgId)]);

export const dataSourceHealth = pgTable("data_source_health", {
  source: text("source").primaryKey(),
  status: text("status").notNull(),
  requestsLastHour: integer("requests_last_hour").notNull().default(0),
  rateLimitRemaining: integer("rate_limit_remaining"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  keySourceOpaqueId: text("key_source_opaque_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamps.updatedAt,
});

export const referenceTimeline = pgTable("reference_timeline", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  eventKey: text("event_key").references(() => eventsRef.eventKey, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityKey: text("entity_key").notNull(),
  eventType: text("event_type").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("reference_timeline_event_observed_idx").on(table.eventKey, table.observedAt)]);

export const sourceConflicts = pgTable("source_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventKey: text("event_key").references(() => eventsRef.eventKey, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityKey: text("entity_key").notNull(),
  field: text("field").notNull(),
  officialSource: text("official_source").notNull(),
  officialValue: jsonb("official_value").notNull(),
  conflictingSource: text("conflicting_source").notNull(),
  conflictingValue: jsonb("conflicting_value").notNull(),
  status: text("status").notNull().default("open"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [index("source_conflicts_event_entity_idx").on(table.eventKey, table.entityKey)]);

export const orgLiveSubscriptions = pgTable("org_live_subscriptions", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  fallbackCredentialId: uuid("fallback_credential_id").references(() => dataSourceCredentials.id, { onDelete: "set null" }),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => users.id),
  ...timestamps,
});

export const orgLiveAlerts = pgTable("org_live_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventKey: text("event_key").references(() => eventsRef.eventKey),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  sourceRefs: jsonb("source_refs").$type<Array<{source:string;id:string;observedAt:string}>>().notNull().default([]),
  aiRunId: uuid("ai_run_id"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("org_live_alerts_org_dedupe_uq").on(table.orgId, table.dedupeKey),index("org_live_alerts_org_created_idx").on(table.orgId, table.createdAt)]);

export const orgActiveContext = pgTable("org_active_context", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  activeEventKey: text("active_event_key").references(() => eventsRef.eventKey),
  activeLocation: text("active_location"),
  setByUserId: uuid("set_by_user_id").references(() => users.id),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  targetOrgId: uuid("target_org_id").references(() => organizations.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamps.createdAt,
});

export const orgBilling = pgTable("org_billing", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  tier: billingTier("tier").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  creditCapUsd: numeric("credit_cap_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  killSwitch: boolean("kill_switch").notNull().default(false),
  manualOverrideNotes: text("manual_override_notes"),
});

export const orgLlmKeys = pgTable(
  "org_llm_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyNonce: text("key_nonce").notNull(),
    keyAuthTag: text("key_auth_tag").notNull(),
    encryptedDek: text("encrypted_dek").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    label: text("label").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("org_llm_keys_org_idx").on(table.orgId)],
);

export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    keySource: keySource("key_source").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    requestId: text("request_id").notNull().unique(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("ai_usage_org_created_idx").on(table.orgId, table.createdAt),
    index("ai_usage_org_user_created_idx").on(
      table.orgId,
      table.userId,
      table.createdAt,
    ),
  ],
);

export const aiCreditGrants = pgTable("ai_credit_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
  grantedBy: uuid("granted_by")
    .notNull()
    .references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: timestamps.createdAt,
});

export const seasonWindows = pgTable("season_windows", {
  year: integer("year").primaryKey(),
  searchStartDate: date("search_start_date").notNull(),
  searchEndDate: date("search_end_date").notNull(),
  isActive: boolean("is_active").notNull().default(false),
});

export const researchJobs = pgTable(
  "research_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    requestedBy: uuid("requested_by").references(() => users.id),
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey, { onDelete: "cascade" }),
    eventKey: text("event_key").references(() => eventsRef.eventKey),
    trigger: researchTrigger("trigger").notNull(),
    status: researchStatus("status").notNull().default("queued"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    searchQueries: integer("search_queries").notNull().default(0),
    resultCount: integer("result_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("research_jobs_queue_idx").on(table.status, table.scheduledFor),
    index("research_jobs_team_idx").on(table.teamKey, table.createdAt),
  ],
);

export type ResearchFact = {
  claim: string;
  confidence: number;
  evidence?: string;
};

export const researchFindings = pgTable(
  "research_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    sourceType: researchSourceType("source_type").notNull(),
    sourceTitle: text("source_title"),
    summary: text("summary").notNull(),
    sentiment: doublePrecision("sentiment"),
    confidence: doublePrecision("confidence").notNull(),
    extractedFacts: jsonb("extracted_facts")
      .$type<ResearchFact[]>()
      .notNull()
      .default([]),
    contentHash: text("content_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    foundAt: timestamp("found_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    researchJobId: uuid("research_job_id")
      .notNull()
      .references(() => researchJobs.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("research_findings_team_url_hash_uq").on(
      table.teamKey,
      table.canonicalUrl,
      table.contentHash,
    ),
    index("research_findings_team_found_idx").on(table.teamKey, table.foundAt),
  ],
);

export const pickLists = pgTable(
  "pick_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pick_lists_org_event_name_uq").on(
      table.orgId,
      table.eventKey,
      table.name,
    ),
  ],
);

export const pickListEntries = pgTable(
  "pick_list_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pickListId: uuid("pick_list_id")
      .notNull()
      .references(() => pickLists.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey),
    rank: integer("rank").notNull(),
    tier: text("tier"),
    notes: text("notes"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (table) => [
    uniqueIndex("pick_list_entries_list_team_uq").on(
      table.pickListId,
      table.teamKey,
    ),
    uniqueIndex("pick_list_entries_list_rank_uq").on(
      table.pickListId,
      table.rank,
    ),
  ],
);

export const teamReliability = pgTable(
  "team_reliability",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey),
    sampleSize: integer("sample_size").notNull(),
    consistencyScore: doublePrecision("consistency_score"),
    reliabilityScore: doublePrecision("reliability_score"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.teamKey, table.eventKey] }),
  ],
);

export const foulProfiles = pgTable(
  "foul_profiles",
  {
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey),
    sampleSize: integer("sample_size").notNull(),
    foulRate: doublePrecision("foul_rate"),
    risk: text("risk").notNull(),
    notes: text("notes"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamKey, table.eventKey] })],
);

export const pricingPlans = pgTable("pricing_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  monthlyPriceUsd: numeric("monthly_price_usd", { precision: 10, scale: 2 }).notNull(),
  includedAllowanceUsd: numeric("included_allowance_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  stripePriceId: text("stripe_price_id"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const planEntitlementVersions = pgTable("plan_entitlement_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  planCode: text("plan_code").notNull().references(() => pricingPlans.code),
  version: integer("version").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  managedAllowanceUsd: numeric("managed_allowance_usd", { precision: 12, scale: 6 }).notNull(),
  billingOwnerType: text("billing_owner_type").$type<"user"|"org">().notNull().default("org"),
  includedCredits: numeric("included_credits", { precision: 12, scale: 6 }).notNull().default("0"),
  serviceMultiplier: numeric("service_multiplier", { precision: 8, scale: 4 }).notNull().default("1.0"),
  fairUse: jsonb("fair_use").$type<Record<string, unknown>>().notNull().default({}),
  contextTokenLimit: integer("context_token_limit").notNull(),
  agentStepLimit: integer("agent_step_limit").notNull(),
  cadIterationLimit: integer("cad_iteration_limit").notNull(),
  cadConcurrentJobs: integer("cad_concurrent_jobs").notNull(),
  codeAnalysisMb: integer("code_analysis_mb").notNull(),
  jobPriority: integer("job_priority").notNull(),
  featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().notNull(),
  changeNotice: text("change_notice").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("plan_entitlement_version_uq").on(table.planCode, table.version)]);

export const orgPlanPeriods = pgTable("org_plan_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => pricingPlans.code),
  entitlementVersionId: uuid("entitlement_version_id").notNull().references(() => planEntitlementVersions.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  managedAllowanceUsd: numeric("managed_allowance_usd", { precision: 12, scale: 6 }).notNull(),
  providerCostUsedUsd: numeric("provider_cost_used_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  status: text("status").notNull(),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("org_plan_period_org_start_uq").on(table.orgId, table.periodStart)]);

export const platformMarginConfig = pgTable("platform_margin_config", {
  id: text("id").primaryKey().default("default"),
  stripeFeePercent: numeric("stripe_fee_percent", { precision: 6, scale: 4 }).notNull().default("2.9"),
  stripeFixedFeeUsd: numeric("stripe_fixed_fee_usd", { precision: 8, scale: 4 }).notNull().default("0.30"),
  infrastructureAllocationUsd: numeric("infrastructure_allocation_usd", { precision: 10, scale: 2 }).notNull().default("2"),
  supportReservePercent: numeric("support_reserve_percent", { precision: 6, scale: 2 }).notNull().default("5"),
  serviceMultiplier: numeric("service_multiplier", { precision: 8, scale: 4 }).notNull().default("1.0"),
  grossMarginWarningPercent: numeric("gross_margin_warning_percent", { precision: 6, scale: 2 }).notNull().default("10"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamps.updatedAt,
});

export const billingAccounts = pgTable("billing_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerType: text("owner_type").$type<"user"|"org">().notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  ownerOrgId: uuid("owner_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  status: text("status").notNull().default("active"),
  ...timestamps,
});
export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingAccountId: uuid("billing_account_id").notNull().references(() => billingAccounts.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => pricingPlans.code),
  entitlementVersionId: uuid("entitlement_version_id").notNull().references(() => planEntitlementVersions.id),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripePriceId: text("stripe_price_id"),
  status: text("status").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});
export const creditWallets = pgTable("credit_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingAccountId: uuid("billing_account_id").notNull().unique().references(() => billingAccounts.id, { onDelete: "cascade" }),
  includedBalance: numeric("included_balance", { precision: 12, scale: 6 }).notNull().default("0"),
  purchasedBalance: numeric("purchased_balance", { precision: 12, scale: 6 }).notNull().default("0"),
  giftedBalance: numeric("gifted_balance", { precision: 12, scale: 6 }).notNull().default("0"),
  paygEnabled: boolean("payg_enabled").notNull().default(false),
  paygMonthlyCapUsd: numeric("payg_monthly_cap_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  ...timestamps,
});
export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingAccountId: uuid("billing_account_id").notNull().references(() => billingAccounts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  credits: numeric("credits", { precision: 12, scale: 6 }).notNull(),
  providerCostUsd: numeric("provider_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  serviceMultiplier: numeric("service_multiplier", { precision: 8, scale: 4 }).notNull().default("1.0"),
  bucket: text("bucket").notNull(),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamps.createdAt,
}, (table) => [index("credit_ledger_account_created_idx").on(table.billingAccountId, table.createdAt)]);
export const orgMemberFundingPolicies = pgTable("org_member_funding_policies", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  allowIndividualFunding: boolean("allow_individual_funding").notNull().default(false),
  enabledBy: uuid("enabled_by").notNull().references(() => users.id),
  updatedAt: timestamps.updatedAt,
}, (table) => [primaryKey({ columns: [table.orgId, table.userId] })]);
export const trialGrants = pgTable("trial_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  billingAccountId: uuid("billing_account_id").notNull().references(() => billingAccounts.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => pricingPlans.code),
  creditsCap: numeric("credits_cap", { precision: 12, scale: 6 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  autoChargeConsent: boolean("auto_charge_consent").notNull().default(false),
  grantedBy: uuid("granted_by").notNull().references(() => users.id),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("trial_grants_account_once_uq").on(table.billingAccountId)]);

export const orgUsagePolicies = pgTable("org_usage_policies", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  paygEnabled: boolean("payg_enabled").notNull().default(false),
  prepaidBalanceUsd: numeric("prepaid_balance_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  overageSpendCapUsd: numeric("overage_spend_cap_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  lowBalanceWarningUsd: numeric("low_balance_warning_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  killSwitch: boolean("kill_switch").notNull().default(false),
  ...timestamps,
});

export const platformProviderKeys = pgTable(
  "platform_provider_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyNonce: text("key_nonce").notNull(),
    keyAuthTag: text("key_auth_tag").notNull(),
    encryptedDek: text("encrypted_dek").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("platform_provider_keys_provider_idx").on(table.provider)],
);

export const modelCatalog = pgTable("model_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull().unique(),
  provider: text("provider").notNull(),
  providerModelId: text("provider_model_id"),
  inputPricePerMillionUsd: numeric("input_price_per_million_usd", {
    precision: 12,
    scale: 6,
  }).notNull().default("0"),
  outputPricePerMillionUsd: numeric("output_price_per_million_usd", {
    precision: 12,
    scale: 6,
  }).notNull().default("0"),
  contextWindowTokens: integer("context_window_tokens"),
  capabilities: text("capabilities").array().notNull().default([]),
  eligiblePlans: text("eligible_plans").array().notNull().default([]),
  paygOnly: boolean("payg_only").notNull().default(false),
  enabled: boolean("enabled").notNull().default(false),
  routingWeight: doublePrecision("routing_weight").notNull().default(1),
  fundingMode: text("funding_mode").$type<"managed_paid"|"byok"|"local"|"sponsored">().notNull().default("managed_paid"),
  commercialUseApproved: boolean("commercial_use_approved").notNull().default(false),
  commercialApprovalSource: text("commercial_approval_source"),
  commercialApprovalReviewedAt: timestamp("commercial_approval_reviewed_at", { withTimezone: true }),
  providerRateLimitRpm: integer("provider_rate_limit_rpm"),
  providerConcurrencyLimit: integer("provider_concurrency_limit"),
  sponsoredEnabled: boolean("sponsored_enabled").notNull().default(false),
  ...timestamps,
});

export const agentThreads = pgTable(
  "agent_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    scope: text("scope").notNull(),
    title: text("title").notNull(),
    ...timestamps,
  },
  (table) => [index("agent_threads_user_updated_idx").on(table.createdBy, table.updatedAt)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    explicitlyShared: boolean("explicitly_shared").notNull().default(false),
    provider: text("provider"),
    model: text("model"),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("agent_messages_thread_created_idx").on(table.threadId, table.createdAt)],
);

export const userMemorySettings = pgTable("user_memory_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  tokenBudget: integer("token_budget").notNull().default(1200),
  updatedAt: timestamps.updatedAt,
});

export const userMemories = pgTable(
  "user_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    sourceThreadId: uuid("source_thread_id").references(() => agentThreads.id, {
      onDelete: "set null",
    }),
    sourceMessageId: uuid("source_message_id").references(() => agentMessages.id, {
      onDelete: "set null",
    }),
    importance: doublePrecision("importance").notNull().default(0.5),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("user_memories_user_updated_idx").on(table.userId, table.updatedAt)],
);

export const teamMemorySettings = pgTable("team_memory_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  tokenBudget: integer("token_budget").notNull().default(1600),
  retentionDays: integer("retention_days").notNull().default(365),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamps.updatedAt,
});

export const teamMemories = pgTable(
  "team_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sourceThreadId: uuid("source_thread_id").notNull().references(() => agentThreads.id, {
      onDelete: "cascade",
    }),
    sourceMessageId: uuid("source_message_id").references(() => agentMessages.id, {
      onDelete: "set null",
    }),
    promotedBy: uuid("promoted_by").notNull().references(() => users.id),
    importance: doublePrecision("importance").notNull().default(0.5),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("team_memories_org_updated_idx").on(table.orgId, table.updatedAt)],
);

export const agentContextUsage = pgTable("agent_context_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => agentThreads.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => agentMessages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  sourceRefs: jsonb("source_refs").$type<Array<{ type: string; id: string }>>().notNull(),
  tokenCount: integer("token_count").notNull(),
  createdAt: timestamps.createdAt,
});

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  threadId: uuid("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
  capability: text("capability").notNull(),
  status: text("status").notNull().default("running"),
  privacyScope: text("privacy_scope").notNull(),
  provider: text("provider"),
  model: text("model"),
  requestId: text("request_id").notNull().unique(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  contextSources: jsonb("context_sources").$type<Array<{type:string;id:string;classification:string}>>().notNull().default([]),
  usageEventId: uuid("usage_event_id").references(() => aiUsageEvents.id),
  billingOwnerType: text("billing_owner_type").$type<"user"|"org">(),
  billingOwnerId: uuid("billing_owner_id"),
  entitlementSnapshot: jsonb("entitlement_snapshot").$type<Record<string, unknown>>(),
  allowanceBucket: text("allowance_bucket"),
  providerCostUsd: numeric("provider_cost_usd", { precision: 12, scale: 6 }),
  creditDebit: numeric("credit_debit", { precision: 12, scale: 6 }),
  routingDecision: jsonb("routing_decision").$type<Record<string, unknown>>(),
  error: text("error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const aiRunSteps = pgTable("ai_run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  toolName: text("tool_name"),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  provenance: jsonb("provenance").$type<Array<{type:string;id:string}>>().notNull().default([]),
  createdAt: timestamps.createdAt,
});

export const aiArtifacts = pgTable("ai_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
  parentArtifactId: uuid("parent_artifact_id").references((): AnyPgColumn => aiArtifacts.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  claimProvenance: jsonb("claim_provenance").$type<Array<{claim:string;classification:string;sourceIds:string[]}>>().notNull().default([]),
  createdAt: timestamps.createdAt,
});

export const artifactLinks = pgTable("artifact_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fromArtifactId: uuid("from_artifact_id").notNull().references(() => aiArtifacts.id, { onDelete: "cascade" }),
  toArtifactId: uuid("to_artifact_id").notNull().references(() => aiArtifacts.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  createdAt: timestamps.createdAt,
});

export const cadConnections = pgTable("cad_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").$type<"onshape"|"fusion360">().notNull(),
  executionMode: text("execution_mode").$type<"hosted"|"local">().notNull(),
  label: text("label").notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status").notNull().default("disconnected"),
  externalAccountRef: text("external_account_ref"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("cad_connections_org_user_idx").on(table.orgId, table.userId)]);

export const cadJobs = pgTable("cad_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  threadId: uuid("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
  connectionId: uuid("connection_id").references(() => cadConnections.id, { onDelete: "set null" }),
  executionMode: text("execution_mode").$type<"hosted"|"local">().notNull(),
  platform: text("platform").$type<"onshape"|"fusion360"|"mock">().notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
  briefConfirmedAt: timestamp("brief_confirmed_at", { withTimezone: true }),
  actionPlan: jsonb("action_plan").$type<Array<Record<string, unknown>>>().notNull().default([]),
  documentRef: jsonb("document_ref").$type<Record<string, unknown>>(),
  currentCheckpointId: uuid("current_checkpoint_id"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  leaseOwner: text("lease_owner"),
  leaseTokenHash: text("lease_token_hash"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("cad_jobs_org_updated_idx").on(table.orgId, table.updatedAt)]);

export const cadJobSteps = pgTable("cad_job_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => cadJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("planned"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  progress: integer("progress").notNull().default(0),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (table) => [uniqueIndex("cad_job_steps_job_sequence_uq").on(table.jobId, table.sequence),uniqueIndex("cad_job_steps_idempotency_uq").on(table.idempotencyKey)]);

export const cadArtifacts = pgTable("cad_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => cadJobs.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => cadJobSteps.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  parentArtifactId: uuid("parent_artifact_id"),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  storageKey: text("storage_key"),
  checksum: text("checksum").notNull(),
  sourceRefs: jsonb("source_refs").$type<Array<{type:string;id:string}>>().notNull().default([]),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamps.createdAt,
}, (table) => [index("cad_artifacts_org_job_idx").on(table.orgId, table.jobId)]);

export const cadCheckpoints = pgTable("cad_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => cadJobs.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => cadJobSteps.id, { onDelete: "set null" }),
  externalVersionRef: text("external_version_ref"),
  branchRef: text("branch_ref"),
  topologyFingerprint: text("topology_fingerprint").notNull(),
  topology: jsonb("topology").$type<Record<string, unknown>>().notNull(),
  renderArtifactId: uuid("render_artifact_id").references(() => cadArtifacts.id, { onDelete: "set null" }),
  humanEditDetected: boolean("human_edit_detected").notNull().default(false),
  createdAt: timestamps.createdAt,
});

export const cadMechanisms = pgTable("cad_mechanisms", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  requirements: jsonb("requirements").$type<Record<string, unknown>>().notNull().default({}),
  sourceArtifactId: uuid("source_artifact_id").references(() => cadArtifacts.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [uniqueIndex("cad_mechanisms_org_name_version_uq").on(table.orgId, table.name, table.version)]);

export const cadAuditEvents = pgTable("cad_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => cadJobs.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamps.createdAt,
}, (table) => [index("cad_audit_org_created_idx").on(table.orgId, table.createdAt)]);

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const cadRelayDevices = pgTable("cad_relay_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  machineName: text("machine_name").notNull(),
  platform: text("platform").$type<"onshape"|"fusion360">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default([]),
  cliVersion: text("cli_version"),
  status: text("status").notNull().default("paired"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("cad_relay_devices_org_user_idx").on(table.orgId, table.userId)]);

export const cadPairingCodes = pgTable("cad_pairing_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userCodeHash: text("user_code_hash").notNull().unique(),
  pollTokenHash: text("poll_token_hash").notNull().unique(),
  machineName: text("machine_name").notNull(),
  cliVersion: text("cli_version").notNull(),
  requestedPlatform: text("requested_platform"),
  approvedOrgId: uuid("approved_org_id").references(() => organizations.id, { onDelete: "cascade" }),
  approvedUserId: uuid("approved_user_id").references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").references(() => cadRelayDevices.id, { onDelete: "set null" }),
  encryptedDeviceToken: text("encrypted_device_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const showcaseDecks = pgTable("showcase_decks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  theme: text("theme").notNull().default("impact"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [index("showcase_decks_org_updated_idx").on(table.orgId, table.updatedAt)]);

export const showcaseSections = pgTable("showcase_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deckId: uuid("deck_id").notNull().references(() => showcaseDecks.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  studentContent: text("student_content").notNull().default(""),
  aiAssistedDraft: text("ai_assisted_draft"),
  approvedContent: text("approved_content"),
  evidenceRefs: jsonb("evidence_refs").$type<Array<{type:string;id:string;label:string}>>().notNull().default([]),
  sortOrder: integer("sort_order").notNull(),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("showcase_sections_deck_order_uq").on(table.deckId, table.sortOrder)]);

export const showcaseShareTokens = pgTable("showcase_share_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deckId: uuid("deck_id").notNull().references(() => showcaseDecks.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  allowedSectionIds: uuid("allowed_section_ids").array().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const judgePracticeSessions = pgTable("judge_practice_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deckId: uuid("deck_id").references(() => showcaseDecks.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  questions: jsonb("questions").$type<Array<{question:string;evidenceRefs:Array<{type:string;id:string}>}>>().notNull(),
  responses: jsonb("responses").$type<Array<{question:string;response:string;reflection?:string}>>().notNull().default([]),
  createdAt: timestamps.createdAt,
});

export const creditPacks = pgTable("credit_packs", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  creditAmountUsd: numeric("credit_amount_usd", { precision: 12, scale: 6 }).notNull(),
  purchasePriceUsd: numeric("purchase_price_usd", { precision: 10, scale: 2 }).notNull(),
  stripePriceId: text("stripe_price_id"),
  active: boolean("active").notNull().default(false),
  ...timestamps,
});

export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
    kind: text("kind").notNull(),
    providerCostUsd: numeric("provider_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    serviceMarkupUsd: numeric("service_markup_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    stripeEventId: text("stripe_event_id"),
    referenceId: text("reference_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("wallet_ledger_org_created_idx").on(table.orgId, table.createdAt),
    uniqueIndex("wallet_ledger_stripe_event_uq").on(table.stripeEventId),
  ],
);

export const orgEntitlements = pgTable("org_entitlements", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => pricingPlans.code),
  source: text("source").notNull(),
  status: text("status").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => users.id),
  ...timestamps,
});

export const entitlementEvents = pgTable(
  "entitlement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    planCode: text("plan_code").notNull(),
    action: text("action").notNull(),
    source: text("source").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    stripeEventId: text("stripe_event_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("entitlement_events_org_created_idx").on(table.orgId, table.createdAt)],
);

export const memberUsageCaps = pgTable(
  "member_usage_caps",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    spendCapUsd: numeric("spend_cap_usd", { precision: 12, scale: 6 }).notNull(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);

export const platformConnectors = pgTable("platform_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  endpoint: text("endpoint"),
  workspaceId: text("workspace_id"),
  appId: text("app_id"),
  bridgeUrl: text("bridge_url"),
  credentialCiphertext: text("credential_ciphertext"),
  credentialNonce: text("credential_nonce"),
  credentialAuthTag: text("credential_auth_tag"),
  encryptedDek: text("encrypted_dek"),
  kmsKeyId: text("kms_key_id"),
  modelMappings: jsonb("model_mappings").$type<Record<string, string>>().notNull().default({}),
  meteringMode: text("metering_mode").notNull().default("unverified"),
  enabled: boolean("enabled").notNull().default(false),
  featureFlagEnabled: boolean("feature_flag_enabled").notNull().default(false),
  approvalReference: text("approval_reference"),
  approvalDate: date("approval_date"),
  approvalAcknowledged: boolean("approval_acknowledged").notNull().default(false),
  healthVerifiedAt: timestamp("health_verified_at", { withTimezone: true }),
  dailyQuota: integer("daily_quota").notNull().default(0),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  ...timestamps,
});

export const base44UsageEvents = pgTable("base44_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectorId: uuid("connector_id").notNull().references(() => platformConnectors.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  requestId: text("request_id").notNull().unique(),
  feature: text("feature").notNull(),
  modelMapping: text("model_mapping").notNull(),
  status: text("status").notNull(),
  returnedUsage: jsonb("returned_usage").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamps.createdAt,
}, (table) => [index("base44_usage_connector_created_idx").on(table.connectorId, table.createdAt)]);

export const base44BridgeNonces = pgTable("base44_bridge_nonces", {
  nonceHash: text("nonce_hash").primaryKey(),
  connectorId: uuid("connector_id").notNull().references(() => platformConnectors.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const orgProviderConfigs = pgTable(
  "org_provider_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url"),
    localRelay: boolean("local_relay").notNull().default(false),
    keyCiphertext: text("key_ciphertext"),
    keyNonce: text("key_nonce"),
    keyAuthTag: text("key_auth_tag"),
    encryptedDek: text("encrypted_dek"),
    kmsKeyId: text("kms_key_id"),
    modelMappings: jsonb("model_mappings").$type<Record<string, string>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("org_provider_configs_org_idx").on(table.orgId)],
);

export const orgApiBudgetPolicies = pgTable("org_api_budget_policies", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 12, scale: 6 }),
  monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 12, scale: 6 }),
  dailyTokenLimit: integer("daily_token_limit"),
  monthlyTokenLimit: integer("monthly_token_limit"),
  warningThresholds: integer("warning_thresholds").array().notNull().default([50, 75, 90]),
  enforceByoTokenLimits: boolean("enforce_byo_token_limits").notNull().default(true),
  modelAllowlistEnabled: boolean("model_allowlist_enabled").notNull().default(false),
  providerAllowlistEnabled: boolean("provider_allowlist_enabled").notNull().default(false),
  killSwitch: boolean("kill_switch").notNull().default(false),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  ...timestamps,
});

export const orgApiMemberLimits = pgTable(
  "org_api_member_limits",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 12, scale: 6 }),
    monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 12, scale: 6 }),
    dailyTokenLimit: integer("daily_token_limit"),
    monthlyTokenLimit: integer("monthly_token_limit"),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] })],
);

export const orgApiFeatureLimits = pgTable(
  "org_api_feature_limits",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 12, scale: 6 }),
    monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 12, scale: 6 }),
    dailyTokenLimit: integer("daily_token_limit"),
    monthlyTokenLimit: integer("monthly_token_limit"),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.orgId, table.feature] })],
);

export const orgApiModelLimits = pgTable(
  "org_api_model_limits",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    allowed: boolean("allowed").notNull().default(true),
    dailySpendLimitUsd: numeric("daily_spend_limit_usd", { precision: 12, scale: 6 }),
    monthlySpendLimitUsd: numeric("monthly_spend_limit_usd", { precision: 12, scale: 6 }),
    dailyTokenLimit: integer("daily_token_limit"),
    monthlyTokenLimit: integer("monthly_token_limit"),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.orgId, table.provider, table.model] })],
);

export const platformApiSafetyCaps = pgTable("platform_api_safety_caps", {
  tier: billingTier("tier").primaryKey(),
  maxDailySpendUsd: numeric("max_daily_spend_usd", { precision: 12, scale: 6 }),
  maxMonthlySpendUsd: numeric("max_monthly_spend_usd", { precision: 12, scale: 6 }),
  maxDailyTokens: integer("max_daily_tokens"),
  maxMonthlyTokens: integer("max_monthly_tokens"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamps.updatedAt,
});

export const apiUsageDenials = pgTable(
  "api_usage_denials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    feature: text("feature").notNull(),
    provider: text("provider"),
    model: text("model"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull(),
    estimatedTokens: integer("estimated_tokens").notNull(),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("api_usage_denials_org_created_idx").on(table.orgId, table.createdAt)],
);

export const budgetPolicyAudit = pgTable(
  "budget_policy_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("budget_policy_audit_org_created_idx").on(table.orgId, table.createdAt)],
);

export type DisplayWidget = {
  type:
    | "next_match"
    | "prediction"
    | "strategy"
    | "robot_readiness"
    | "event_status"
    | "scouting_coverage"
    | "alerts"
    | "team_intel";
  x: number;
  y: number;
  w: number;
  h: number;
};

export const displayBoards = pgTable(
  "display_boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    preset: text("preset").notNull(),
    widgets: jsonb("widgets").$type<DisplayWidget[]>().notNull().default([]),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...timestamps,
  },
  (table) => [uniqueIndex("display_boards_org_name_uq").on(table.orgId, table.name)],
);

export const displayTokens = pgTable(
  "display_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").notNull().references(() => displayBoards.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("display_tokens_board_idx").on(table.boardId)],
);

export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  scope: text("scope").$type<"team"|"private">().notNull(),
  status: text("status").$type<"queued"|"running"|"completed"|"failed"|"cancelled"|"expired">().notNull().default("queued"),
  domains: text("domains").array().notNull(),
  filters: jsonb("filters").$type<{eventKey?:string;from?:string;to?:string;excelBom?:boolean}>().notNull().default({}),
  progress: integer("progress").notNull().default(0),
  objectKey: text("object_key"),
  encryptedArchive: text("encrypted_archive"),
  downloadTokenHash: text("download_token_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  error: text("error"),
  sizeBytes: integer("size_bytes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("export_jobs_org_created_idx").on(table.orgId, table.createdAt)]);

export const exportAuditEvents = pgTable("export_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => exportJobs.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamps.createdAt,
}, (table) => [index("export_audit_org_created_idx").on(table.orgId, table.createdAt)]);

export type ScoutFieldDefinition = {
  key: string;
  label: string;
  type: "number" | "boolean" | "text" | "select";
  required?: boolean;
  options?: string[];
  disagreementThreshold?: number;
};

export type ScoutSchemaDefinition = {
  title: string;
  fields: ScoutFieldDefinition[];
};

export const scoutSchemas = pgTable(
  "scout_schemas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    type: scoutSchemaType("type").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("schema").$type<ScoutSchemaDefinition>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("scout_schemas_org_year_type_version_uq").on(
      table.orgId,
      table.year,
      table.type,
      table.version,
    ),
  ],
);

const scoutEntryColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  eventKey: text("event_key")
    .notNull()
    .references(() => eventsRef.eventKey),
  teamKey: text("team_key")
    .notNull()
    .references(() => teamsRef.teamKey),
  scoutUserId: uuid("scout_user_id")
    .notNull()
    .references(() => users.id),
  schemaId: uuid("schema_id")
    .notNull()
    .references(() => scoutSchemas.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  confidence: scoutConfidence("confidence").notNull().default("normal"),
  source: scoutSource("source").notNull().default("manual"),
  clientId: text("client_id").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...timestamps,
};

export const matchScoutEntries = pgTable(
  "match_scout_entries",
  {
    ...scoutEntryColumns,
    matchKey: text("match_key")
      .notNull()
      .references(() => matchesRef.matchKey),
  },
  (table) => [
    uniqueIndex("match_scout_entries_org_client_uq").on(
      table.orgId,
      table.clientId,
    ),
    index("match_scout_entries_subject_idx").on(
      table.orgId,
      table.eventKey,
      table.matchKey,
      table.teamKey,
    ),
  ],
);

export const pitScoutEntries = pgTable(
  "pit_scout_entries",
  scoutEntryColumns,
  (table) => [
    uniqueIndex("pit_scout_entries_org_client_uq").on(
      table.orgId,
      table.clientId,
    ),
    index("pit_scout_entries_subject_idx").on(
      table.orgId,
      table.eventKey,
      table.teamKey,
    ),
  ],
);

export const scoutMedia = pgTable(
  "scout_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key")
      .notNull()
      .references(() => eventsRef.eventKey),
    teamKey: text("team_key")
      .notNull()
      .references(() => teamsRef.teamKey),
    entryId: uuid("entry_id"),
    clientId: text("client_id").notNull(),
    kind: scoutMediaKind("kind").notNull(),
    status: scoutMediaStatus("status").notNull().default("pending"),
    storageKey: text("storage_key"),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    tags: text("tags").array().notNull().default([]),
    capturedBy: uuid("captured_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scout_media_org_client_uq").on(table.orgId, table.clientId),
  ],
);

export const scoutDisagreements = pgTable(
  "scout_disagreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    matchKey: text("match_key").notNull(),
    teamKey: text("team_key").notNull(),
    fieldKey: text("field_key").notNull(),
    entryIds: uuid("entry_ids").array().notNull(),
    values: jsonb("values").$type<unknown[]>().notNull(),
    status: disagreementStatus("status").notNull().default("open"),
    resolution: jsonb("resolution").$type<Record<string, unknown> | null>(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scout_disagreements_open_subject_uq").on(
      table.orgId,
      table.matchKey,
      table.teamKey,
      table.fieldKey,
    ),
  ],
);

export const orgValueFormulas = pgTable(
  "org_value_formulas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    expression: jsonb("expression").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [uniqueIndex("org_value_formulas_org_name_uq").on(table.orgId, table.name)],
);

export const scoutAssignments = pgTable(
  "scout_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    matchKey: text("match_key").notNull(),
    teamKey: text("team_key").notNull(),
    role: text("role").notNull().default("primary"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("scout_assignments_org_user_match_team_uq").on(
      table.orgId,
      table.userId,
      table.matchKey,
      table.teamKey,
    ),
  ],
);

export const scoutSyncReceipts = pgTable(
  "scout_sync_receipts",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    entryType: scoutSchemaType("entry_type").notNull(),
    serverEntryId: uuid("server_entry_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.clientId] })],
);

export const waitlistSignups = pgTable("waitlist_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailNormalized: text("email_normalized").notNull().unique(),
  teamNumber: integer("team_number").notNull(),
  phoneE164: text("phone_e164"),
  emailConsentAt: timestamp("email_consent_at", { withTimezone: true }),
  smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),
  consentDisclosureVersion: text("consent_disclosure_version").notNull(),
  source: text("source").notNull(),
  launchInvitedAt: timestamp("launch_invited_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  ...timestamps,
});

export type DashboardWidgetLayout = {
  i: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  config?: Record<string, unknown>;
};

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: text("scope").$type<"personal" | "org">().notNull(),
    isActive: boolean("is_active").notNull().default(false),
    layout: jsonb("layout").$type<DashboardWidgetLayout[]>().notNull().default([]),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("dashboards_org_owner_idx").on(table.orgId, table.ownerUserId),
    index("dashboards_org_scope_idx").on(table.orgId, table.scope),
  ],
);
