import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

function src(rel: string) {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("leftover money and ops empty cards", () => {
  it("Reimbursements setup is Needs setup with one Choose your team primary", () => {
    const reimbursements = src("app/reimbursements/reimbursements-client.tsx");
    expect(reimbursements).toMatch(/badge="Needs setup"/);
    expect(reimbursements).not.toMatch(/badge="Setup"/);
    expect(reimbursements).toMatch(/Choose your team/);
    expect(reimbursements).toMatch(/Open Budget/);
    expect(reimbursements).toMatch(/\/team\/budgets/);
  });

  it("Part requests leftover cards jump to Ask for a part", () => {
    const parts = src("app/part-requests/part-requests-client.tsx");
    expect(parts).toMatch(/id="pr-ask"/);
    expect(parts).toMatch(/#pr-ask/);
    expect(parts).toMatch(/Ask for a part/);
    expect(parts).toMatch(/badge="Needs setup"/);
  });

  it("Matching gift leftover cards jump to the contact and program forms", () => {
    const gifts = src("app/matching-gift-finder/matching-gift-finder-client.tsx");
    expect(gifts).toMatch(/#matching-gift-contacts/);
    expect(gifts).toMatch(/#matching-gift-programs/);
    expect(gifts).toMatch(/Add a household contact/);
    expect(gifts).toMatch(/Add a program/);
    expect(gifts).not.toMatch(/badge="No contacts"/);
    expect(gifts).not.toMatch(/badge="No programs"/);
  });

  it("Batteries leftover cards use Needs setup and Add a battery", () => {
    expect(src("app/batteries/batteries-chrome.tsx")).toMatch(/badge="Needs setup"/);
    expect(src("app/batteries/batteries-chrome.tsx")).not.toMatch(/badge="Setup"/);
    const forms = src("app/batteries/batteries-forms.tsx");
    expect(forms).toMatch(/#batt-add-pack/);
    expect(forms).toMatch(/Add a battery/);
  });

  it("Logistics leftover contacts jump to the mentor add-contact form", () => {
    expect(src("app/logistics/logistics-manage.tsx")).toMatch(/id="log-add-contact"/);
    const day = src("app/logistics/logistics-day.tsx");
    expect(day).toMatch(/#log-add-contact/);
    expect(day).toMatch(/Add a contact/);
  });

  it("Playbook leftover Choose a page has one New page primary", () => {
    const knowledge = src("app/team/knowledge/knowledge-client.tsx");
    expect(knowledge).toMatch(/title="Choose a page"/);
    expect(knowledge).toMatch(/New page/);
    expect(knowledge).toMatch(/onClick=\{beginCreate\}/);
  });

  it("Scouted vs official leftover empty opens Scouting", () => {
    const recon = src("app/scouting/scouting-reconciliation-panel.tsx");
    expect(recon).toMatch(/Open Scouting/);
    expect(recon).toMatch(/withOrgHref\("\/scouting"/);
    expect(recon).not.toMatch(/badge="Needs setup"/);
  });

  it("Files leftover empties jump to Upload files", () => {
    expect(src("app/files/files-client.tsx")).toMatch(/id="drive-upload"/);
    const panels = src("app/files/files-panels.tsx");
    expect(panels).toMatch(/#drive-upload/);
    expect(panels).toMatch(/Upload files/);
  });
});
