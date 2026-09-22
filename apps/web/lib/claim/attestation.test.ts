import { describe, expect, it } from "vitest";
import { LEGAL_CONTACT_EMAIL, TERMS_OF_SERVICE } from "../legal/documents";
import {
  TEAM_CLAIM_STATEMENT_VERSION,
  parseClaimAttestation,
  teamClaimReportHref,
  teamClaimStatement,
} from "./attestation";
import { parseReportedTeamNumber, teamClaimReportMailto } from "./report";

describe("team claim statement", () => {
  it("fills in the team number in the exact wording", () => {
    expect(teamClaimStatement(254)).toBe(
      "I confirm I am a member, mentor or coach of Team 254 and am authorized to register it on Vantage. " +
        "I understand that claiming another team's number is prohibited.",
    );
  });

  it("accepts only literal true with the current version", () => {
    expect(parseClaimAttestation({ authorizationAcknowledged: true, attestationVersion: TEAM_CLAIM_STATEMENT_VERSION })).toEqual({
      ok: true,
      version: TEAM_CLAIM_STATEMENT_VERSION,
    });
    expect(parseClaimAttestation({ authorizationAcknowledged: "true", attestationVersion: TEAM_CLAIM_STATEMENT_VERSION }).ok).toBe(false);
    expect(parseClaimAttestation({ authorizationAcknowledged: true }).ok).toBe(false);
    expect(parseClaimAttestation(undefined).ok).toBe(false);
  });
});

describe("report a team claimed without authorization", () => {
  it("links to the report page with a clean team number only", () => {
    expect(teamClaimReportHref(1678)).toBe("/claim/report?team=1678");
    expect(teamClaimReportHref("12a")).toBe("/claim/report");
    expect(teamClaimReportHref(null)).toBe("/claim/report");
  });

  it("parses only a 1–5 digit team number from the query", () => {
    expect(parseReportedTeamNumber("973")).toBe(973);
    expect(parseReportedTeamNumber(["118", "2"])).toBe(118);
    expect(parseReportedTeamNumber("<script>")).toBeNull();
    expect(parseReportedTeamNumber("0")).toBeNull();
    expect(parseReportedTeamNumber(undefined)).toBeNull();
  });

  it("prefills the email with the team number, addressed to the Terms contact", () => {
    const href = teamClaimReportMailto(4414);
    expect(href.startsWith(`mailto:${LEGAL_CONTACT_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(href)).toContain("Team 4414 claimed on Vantage without authorization");
  });
});

describe("Terms: team identities clause", () => {
  const section = TERMS_OF_SERVICE.sections.find((candidate) => candidate.id === "team-identities");
  const text = [...(section?.paragraphs ?? []), ...(section?.list ?? [])].join(" ");

  it("exists at the anchor /claim links to", () => {
    expect(section?.heading).toBe("Team identities and team numbers");
  });

  it("states the representation, the prohibition, the remedy and the FIRST notice", () => {
    expect(text).toMatch(/member, mentor, coach, or other person authorized by that team/);
    expect(text).toMatch(/Do not claim, register, reserve, or impersonate a team/);
    expect(text).toMatch(/suspend the workspace, transfer its ownership[^.]*or remove it/);
    expect(text).toMatch(/not affiliated with, sponsored by, or endorsed by FIRST/);
  });

  it("describes the stored record the way the code stores it — a hash, not the address", () => {
    expect(text).toMatch(/one-way hash of the network address[^.]*not the address itself/);
  });
});
