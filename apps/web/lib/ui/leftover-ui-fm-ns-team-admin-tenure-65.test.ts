import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team admin tenure needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Always ≥1 owner/admin (last-admin demotion blocked). Bootstrap: first 14 days **or** until a second admin exists — invite co-admin copy on Team admin + Security; Help via invite hint. Load/mutate/shell is `team-admin-client.tsx`; chrome, access requests, invites, GitHub, and leftover providers live in sibling modules. No nested TabBar. No-org empty keeps one **Choose your team** primary; setup badge is **Needs setup**. Closed membership: exact-email invite; everyone else → waitlist. Last snapshot (`feature: \"team-admin\"`) stays on the phone (`if (!view)`). Header related strip is **Account · Discord · Connectors**. Featured under Team › People as **Invites**. Setup badge is **Needs setup**.");
  });
});
