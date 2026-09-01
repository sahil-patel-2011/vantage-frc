import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Historical committed collisions. Exact membership is frozen. */
const KNOWN_DUPLICATE_MIGRATIONS = new Map([
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

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.+\.sql$/.test(name));
}

describe("migration numbering", () => {
  it("does not introduce new duplicate prefixes after the frozen historical set", () => {
    const byPrefix = new Map<string, string[]>();
    for (const name of listMigrationFiles()) {
      const prefix = name.slice(0, 4);
      const list = byPrefix.get(prefix) ?? [];
      list.push(name);
      byPrefix.set(prefix, list);
    }
    const unexpected: string[] = [];
    for (const [prefix, files] of byPrefix) {
      files.sort();
      const known = KNOWN_DUPLICATE_MIGRATIONS.get(prefix);
      if (
        files.length > 1 &&
        (known === undefined ||
          known.length !== files.length ||
          known.some((name, index) => name !== files[index]))
      ) {
        unexpected.push(`${prefix}: ${files.join(", ")}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("reserves the new 0493-0496 sequence exactly once", () => {
    const expected = [
      "0493_team_braindump_context.sql",
      "0494_byok_consult.sql",
      "0495_free_relay_jobs.sql",
      "0496_org_llm_byok_endpoint.sql",
    ];
    const files = listMigrationFiles();
    expect(files.filter((name) => /^049[3-6]_/.test(name)).sort()).toEqual(expected);

    const prefixes = listMigrationFiles().map((name) => Number(name.slice(0, 4)));
    expect(Math.max(...prefixes)).toBeGreaterThanOrEqual(496);
  });
});
