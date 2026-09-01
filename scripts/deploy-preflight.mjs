#!/usr/bin/env node
// Deploy preflight: env completeness + migration-file sanity, zero dependencies.
//
//   node scripts/deploy-preflight.mjs                       # checks process.env
//   node scripts/deploy-preflight.mjs --env-file .env.production.local
//   npm run deploy:preflight
//
// Prints a PASS/WARN/FAIL table and exits 1 only when something FAILs.
// Sources of truth: .env.example (annotated var catalog), the setup-required
// checks in code (apps/web/lib/**, packages/billing KMS, cron auth), and
// packages/db/migrations. Nothing here is aspirational — every "breaks"
// column names the real behavior when the var is absent.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Vars the production deployment cannot function without. */
export const REQUIRED_VARS = [
  { name: "DATABASE_URL", breaks: "Every product route (RLS request role). All tenant pages degrade to setup_required." },
  { name: "DATABASE_ADMIN_URL", breaks: "Migrations, cron ingest, and worker jobs (vantage_worker). Must be UNPOOLED." },
  { name: "DATABASE_AUTH_URL", breaks: "Better Auth session store — nobody can sign in." },
  { name: "BETTER_AUTH_SECRET", breaks: "Session signing — auth refuses to start." },
  { name: "BETTER_AUTH_URL", breaks: "OAuth callbacks + trusted origin; Google sign-in redirects break." },
  { name: "NEXT_PUBLIC_APP_URL", breaks: "Absolute links in invite emails, calendar feeds, share links." },
  { name: "NEXT_PUBLIC_SITE_URL", breaks: "metadataBase, OG images, sitemap, robots — SEO points at localhost." },
  { name: "CRON_SECRET", breaks: "All /api/cron/* routes return 503 (TBA sync, dreams, digests, reminders)." },
];

/** Missing these degrades a real feature to an honest setup_required state. */
export const RECOMMENDED_VARS = [
  { name: "RESEND_API_KEY", breaks: "Email OTP sign-in, email 2FA, and invite emails stay setup_required (2FA not enforced)." },
  { name: "AUTH_EMAIL_FROM", breaks: "Pairs with RESEND_API_KEY — both are needed for any auth email delivery." },
  { name: "GOOGLE_CLIENT_ID", breaks: "Google sign-in button disabled; email OTP is the only path." },
  { name: "GOOGLE_CLIENT_SECRET", breaks: "Pairs with GOOGLE_CLIENT_ID." },
  { name: "TBA_AUTH_KEY", breaks: "TBA reference ingest returns setup_required — no schedules, match results, or event data." },
  { name: "MFA_ENCRYPTION_KEY", breaks: "TOTP MFA enrollment fails to encrypt secrets." },
  { name: "MFA_RECOVERY_PEPPER", breaks: "MFA recovery codes cannot be hashed." },
  { name: "EXPORT_ENCRYPTION_KEY", breaks: "Export Center archive downloads fail." },
  { name: "AWS_KMS_KEY_ID", breaks: "BYOK AI-key saves fail: the local KMS refuses to init in production, so envelope encryption needs AWS KMS." },
  { name: "AWS_ACCESS_KEY_ID", breaks: "Pairs with AWS_KMS_KEY_ID (unless the runtime has an IAM role)." },
  { name: "AWS_SECRET_ACCESS_KEY", breaks: "Pairs with AWS_ACCESS_KEY_ID." },
  { name: "STRIPE_SECRET_KEY", breaks: "Checkout and billing portal stay setup_required (teams cannot buy credits)." },
  { name: "STRIPE_WEBHOOK_SECRET", breaks: "/api/stripe/webhook rejects every event — payments never credit the org." },
  { name: "MARKETING_DATABASE_URL", breaks: "Waitlist signups fall back to the in-memory dev store (lost on redeploy)." },
  { name: "VAPID_PUBLIC_KEY", breaks: "Web push degrades to 'server setup'; in-app notifications still work." },
  { name: "VAPID_PRIVATE_KEY", breaks: "Pairs with VAPID_PUBLIC_KEY." },
  { name: "ANTHROPIC_API_KEY", breaks: "Paid-org platform AI unavailable — teams must bring their own keys (BYOK)." },
  { name: "OPENROUTER_API_KEY", breaks: "Free-org platform AI router unavailable — free orgs get setup_required AI." },
  { name: "RATE_LIMIT_REDIS_URL", breaks: "Rate limiting falls back to per-instance memory (weaker under multiple lambdas)." },
  { name: "RATE_LIMIT_REDIS_TOKEN", breaks: "Pairs with RATE_LIMIT_REDIS_URL." },
];

/** Fully optional integrations — absence is a designed setup-required state. */
export const OPTIONAL_VARS = [
  { name: "DATABASE_BILLING_URL", breaks: "Stripe webhook uses the pooled URL instead of a least-privilege role." },
  { name: "DATABASE_DISPLAY_URL", breaks: "Pit-TV snapshots use the pooled URL instead of execute-only." },
  { name: "DATABASE_ALLIANCE_BOARD_URL", breaks: "Alliance-board share links use the pooled URL." },
  { name: "DATABASE_CAD_RELAY_URL", breaks: "Fusion relay pairing uses the pooled URL." },
  { name: "FIRST_EVENTS_USERNAME", breaks: "FIRST Events API enrichment off." },
  { name: "FIRST_EVENTS_AUTHORIZATION_TOKEN", breaks: "Pairs with FIRST_EVENTS_USERNAME." },
  { name: "AUTH_TRUSTED_ORIGINS", breaks: "Extra custom domains / previews are not trusted by Better Auth." },
  { name: "DISCORD_BOT_TOKEN", breaks: "Discord bot posting setup_required; webhook announcements still work." },
  { name: "DISCORD_CLIENT_ID", breaks: "Pairs with DISCORD_BOT_TOKEN." },
  { name: "SLACK_SIGNING_SECRET", breaks: "Inbound Slack Events off; outbound webhook bridge still works." },
  { name: "TWILIO_ACCOUNT_SID", breaks: "Phone OTP setup_required; numbers still save." },
  { name: "TWILIO_AUTH_TOKEN", breaks: "Pairs with TWILIO_ACCOUNT_SID." },
  { name: "TWILIO_FROM_NUMBER", breaks: "Pairs with TWILIO_ACCOUNT_SID." },
  { name: "GITHUB_OAUTH_CLIENT_ID", breaks: "GitHub OAuth button disabled; encrypted-PAT path still works." },
  { name: "GITHUB_OAUTH_CLIENT_SECRET", breaks: "Pairs with GITHUB_OAUTH_CLIENT_ID." },
  { name: "ONSHAPE_OAUTH_CLIENT_ID", breaks: "Onshape CAD agent shows Setup-required UI." },
  { name: "ONSHAPE_OAUTH_CLIENT_SECRET", breaks: "Pairs with ONSHAPE_OAUTH_CLIENT_ID." },
  { name: "FUSION_RELAY_SIGNING_SECRET", breaks: "Fusion local relay pairing off." },
  { name: "BRAVE_SEARCH_API_KEY", breaks: "Agent web.search returns setup_required (never invents hits)." },
  { name: "RESEARCH_SEARCH_ENDPOINT", breaks: "Research uses local fixtures instead of a live search provider." },
  { name: "RESEARCH_SEARCH_API_KEY", breaks: "Pairs with RESEARCH_SEARCH_ENDPOINT." },
  { name: "MISTRAL_API_KEY", breaks: "Sponsored/promo AI pool provider missing (failover order Mistral→Cerebras→Groq→Cohere)." },
  { name: "CEREBRAS_API_KEY", breaks: "Sponsored pool failover provider missing." },
  { name: "GROQ_API_KEY", breaks: "Sponsored pool failover provider missing." },
  { name: "COHERE_API_KEY", breaks: "Sponsored pool failover provider missing." },
  { name: "NEXT_PUBLIC_PLAUSIBLE_DOMAIN", breaks: "Product analytics off." },
];

/** Set in production = a real problem. */
export const FORBIDDEN_IN_PROD = [
  { name: "E2E_AUTH_FIXTURE", level: "FAIL", breaks: "Test auth fixture. Production code refuses it, but it must never reach Vercel env." },
  { name: "DEV_KMS_MASTER_KEY", level: "FAIL", breaks: "Local KMS master key. The KMS refuses to init in production; remove it." },
  { name: "DEV_OTP_SECRET", level: "FAIL", breaks: "Deterministic OTP for local dev only." },
  { name: "ENABLE_EMAIL_2FA_BYPASS", level: "WARN", breaks: "Leaves email 2FA off even with Resend configured — emergency use only." },
  { name: "BOOTSTRAP_TOKEN", level: "WARN", breaks: "Needed only for first-boot owner bootstrap. Remove after the owner account exists." },
];

/** First-boot-only vars: WARN when absent AND bootstrap has presumably not run. */
export const BOOTSTRAP_VARS = ["PLATFORM_OWNER_EMAIL", "PLATFORM_OWNER_PASSWORD", "PLATFORM_OWNER_NAME"];

const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Frozen committed collisions. Exact filenames are intentional here: adding a
 * third file to one of these prefixes must fail just like any new collision.
 */
export const KNOWN_DUPLICATE_MIGRATIONS = new Map([
  ["0050", ["0050_driver_practice.sql", "0050_safety_log.sql"]],
  ["0067", ["0067_consent_forms.sql", "0067_kickoff_analysis.sql"]],
  ["0070", ["0070_fundraiser_events.sql", "0070_season_budget.sql"]],
  ["0096", ["0096_auto_routines.sql", "0096_chat_provider_routing.sql"]],
  ["0105", ["0105_control_map.sql", "0105_milestone_meeting_links.sql", "0105_team_knowledge.sql"]],
  ["0106", ["0106_invite_peek.sql", "0106_tuning_constants.sql"]],
  ["0109", ["0109_bringup_checklist.sql", "0109_writer_assistant.sql"]],
  ["0111", ["0111_gearboxes.sql", "0111_subteam_calendars.sql"]],
  ["0127", ["0127_robot_blueprint.sql", "0127_team_knowledge_revisions.sql"]],
  ["0150", ["0150_battery_canonical_reconcile.sql", "0150_sponsor_pipeline_crm.sql"]],
  ["0153", ["0153_battery_canonical.sql", "0153_expanded_product_pricing.sql", "0153_fmea_failure_log.sql"]],
  ["0155", ["0155_my_day_schedule_alerts.sql", "0155_sponsor_reminders.sql"]],
  ["0162", ["0162_org_team_location_description.sql", "0162_scout_qr_handoff.sql", "0162_team_todos.sql"]],
  ["0163", ["0163_legal_acceptance.sql", "0163_role_onboarding.sql", "0163_video_rescout_integrate.sql"]],
  ["0166", ["0166_scout_disagreement_resolution_hooks.sql", "0166_scouting_coverage_gap_notify.sql", "0166_scouting_trust_layer.sql"]],
  ["0171", ["0171_order_requests.sql", "0171_org_billing_platform_read.sql"]],
  ["0172", ["0172_org_team_location_description.sql", "0172_scout_engagement_notifications.sql"]],
  ["0177", ["0177_scout_disagreement_audit_scout_reopen.sql", "0177_visit_invites.sql"]],
  ["0184", ["0184_cross_feature_context_graph.sql", "0184_purchase_buyer_progress.sql"]],
  ["0219", ["0219_scout_accuracy.sql", "0219_support_tickets.sql"]],
  ["0258", ["0258_epa_trend_alerts.sql", "0258_scout_form_builder.sql"]],
  ["0259", ["0259_match_notes_timeline.sql", "0259_scout_voice_audio.sql"]],
  ["0264", ["0264_bom_cost_rollup.sql", "0264_scout_media_bytes.sql"]],
  ["0265", ["0265_scout_voice_notes.sql", "0265_vendor_lead_times.sql"]],
]);

/** Parse a dotenv-style file (same relaxed rules as scripts/run-migrations.mjs). */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function isSet(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Env completeness rows. Aliases honored where the app honors them:
 * TBA_API_KEY for TBA_AUTH_KEY; POSTGRES_URL / DATABASE_URL_UNPOOLED /
 * POSTGRES_URL_NON_POOLING for the Neon/Supabase integration shapes.
 */
export function checkEnv(env) {
  const aliases = {
    TBA_AUTH_KEY: ["TBA_API_KEY"],
    DATABASE_URL: ["POSTGRES_URL"],
    DATABASE_ADMIN_URL: ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"],
    DATABASE_AUTH_URL: ["DATABASE_URL", "POSTGRES_URL"],
  };
  const present = (name) => isSet(env, name) || (aliases[name] ?? []).some((alias) => isSet(env, alias));

  const rows = [];
  for (const spec of REQUIRED_VARS) {
    rows.push(
      present(spec.name)
        ? { status: "PASS", name: spec.name, note: "set" }
        : { status: "FAIL", name: spec.name, note: `MISSING — ${spec.breaks}` },
    );
  }
  for (const spec of RECOMMENDED_VARS) {
    rows.push(
      present(spec.name)
        ? { status: "PASS", name: spec.name, note: "set" }
        : { status: "WARN", name: spec.name, note: `missing — ${spec.breaks}` },
    );
  }
  for (const spec of OPTIONAL_VARS) {
    rows.push(
      present(spec.name)
        ? { status: "PASS", name: spec.name, note: "set (optional)" }
        : { status: "INFO", name: spec.name, note: `off — ${spec.breaks}` },
    );
  }
  for (const spec of FORBIDDEN_IN_PROD) {
    if (isSet(env, spec.name)) {
      rows.push({ status: spec.level, name: spec.name, note: `SET — ${spec.breaks}` });
    }
  }
  const bootstrapMissing = BOOTSTRAP_VARS.filter((name) => !isSet(env, name));
  if (bootstrapMissing.length > 0 && bootstrapMissing.length < BOOTSTRAP_VARS.length) {
    rows.push({
      status: "WARN",
      name: bootstrapMissing.join(", "),
      note: "partial platform-owner bootstrap config — set all three or none (first boot only).",
    });
  }
  return rows;
}

/**
 * Migration-file sanity. Files apply in lexicographic filename order
 * (scripts/run-migrations.mjs), keyed by full filename in schema_migrations,
 * so duplicate NNNN prefixes DO apply — but ordering between same-number
 * files is alphabetical-by-slug, which is fragile. Frozen historical
 * collisions and numbering gaps warn; new collisions and malformed names fail.
 */
export function checkMigrations(fileNames) {
  const rows = [];
  const sorted = [...fileNames].filter((f) => f.endsWith(".sql")).sort();
  const byNumber = new Map();
  const malformed = [];
  for (const file of sorted) {
    const match = MIGRATION_NAME.exec(file);
    if (!match) {
      malformed.push(file);
      continue;
    }
    const num = match[1];
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(file);
  }

  for (const file of malformed) {
    rows.push({ status: "FAIL", name: file, note: "does not match NNNN_slug.sql — run-migrations still applies it, but ordering is undefined." });
  }

  const duplicates = [...byNumber.entries()].filter(([, files]) => files.length > 1);
  for (const [num, files] of duplicates) {
    const knownFiles = KNOWN_DUPLICATE_MIGRATIONS.get(num);
    const isFrozen =
      knownFiles !== undefined &&
      knownFiles.length === files.length &&
      knownFiles.every((file, index) => file === files[index]);
    rows.push(
      isFrozen
        ? { status: "WARN", name: `prefix ${num}`, note: `FROZEN historical duplicate: ${files.join(", ")} (apply order = alphabetical slug).` }
        : { status: "FAIL", name: `prefix ${num}`, note: `NEW duplicate migration prefix: ${files.join(", ")}. Renumber uncommitted migrations after the latest prefix.` },
    );
  }

  const numbers = [...byNumber.keys()].map((n) => Number(n)).sort((a, b) => a - b);
  const gaps = [];
  if (numbers.length > 0) {
    if (numbers[0] !== 0) gaps.push(`starts at ${String(numbers[0]).padStart(4, "0")}, not 0000`);
    for (let i = 1; i < numbers.length; i += 1) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        gaps.push(`${String(numbers[i - 1]).padStart(4, "0")} -> ${String(numbers[i]).padStart(4, "0")}`);
      }
    }
  }
  if (gaps.length > 0) {
    rows.push({ status: "WARN", name: "numbering gaps", note: `KNOWN non-sequential ranges (harmless — runner sorts by filename): ${gaps.join("; ")}` });
  }
  if (malformed.length === 0 && duplicates.length === 0 && gaps.length === 0) {
    rows.push({ status: "PASS", name: "migrations", note: `${sorted.length} files, sequential from 0000, no duplicate prefixes.` });
  } else {
    rows.push({
      status: "PASS",
      name: "migration inventory",
      note: `${sorted.length} .sql files; ${duplicates.length} duplicate prefixes; ${gaps.length} gap ranges (see WARN rows).`,
    });
  }
  return { rows, duplicates: duplicates.map(([num, files]) => ({ number: num, files })), gaps };
}

export function summarize(rows) {
  const counts = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

function printTable(title, rows) {
  console.log(`\n== ${title} ==`);
  for (const row of rows) {
    console.log(`  [${row.status.padEnd(4)}] ${row.name.padEnd(32)} ${row.note}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const env = { ...process.env };
  const fileIndex = args.indexOf("--env-file");
  const loaded = [];
  const candidates = fileIndex >= 0 && args[fileIndex + 1]
    ? [args[fileIndex + 1]]
    : [".env.production.local", ".env.local"].filter((path) => existsSync(path));
  for (const path of candidates) {
    if (!existsSync(path)) {
      console.error(`env file not found: ${path}`);
      process.exit(1);
    }
    Object.assign(env, parseEnvFile(readFileSync(path, "utf8")));
    loaded.push(path);
  }

  console.log("Vantage deploy preflight");
  console.log(loaded.length ? `env sources: process.env + ${loaded.join(" + ")}` : "env sources: process.env only");

  const envRows = checkEnv(env);
  printTable("Environment", envRows.filter((row) => row.status !== "INFO"));
  const offRows = envRows.filter((row) => row.status === "INFO");
  if (offRows.length) printTable("Optional integrations currently off", offRows);

  const migrationDir = join("packages", "db", "migrations");
  const files = existsSync(migrationDir) ? readdirSync(migrationDir) : [];
  const migrations = checkMigrations(files);
  printTable("Migrations", migrations.rows);

  const counts = summarize([...envRows, ...migrations.rows]);
  console.log(`\nSummary: ${counts.PASS} PASS / ${counts.WARN} WARN / ${counts.FAIL} FAIL (${counts.INFO} optional off)`);
  if (counts.FAIL > 0) {
    console.log("Result: FAIL — fix the FAIL rows before deploying.");
    process.exit(1);
  }
  console.log(counts.WARN > 0 ? "Result: PASS with warnings." : "Result: PASS.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
