import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Connectors needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("One page for Google, GitHub, Team Data, Onshape, Discord, Slack, email, Stripe, storage node, Fusion relay, the Pi free relay, and **Claude Code** (no API key). Status is Connected only from a stored row. Members see mentor-ask copy plus what the link can do (no OAuth, no env-var names, no client secrets). Onshape card: connect, status, disconnect, paste-link fallback to pick a document. Owners/admins still see the missing variables and the callback URL to register. Last snapshot stays on the phone; 401/403 with no cache is **Choose your team**. Setup badge is **Needs setup**.");
  });
});
