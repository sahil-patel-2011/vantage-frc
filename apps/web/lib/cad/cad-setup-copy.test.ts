import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAD_PAIR_APPROVED,
  CAD_PAIR_DESCRIPTION,
  CAD_PAIR_FUSION,
  CAD_PAIR_ONSHAPE,
  CAD_PAIR_TITLE,
  CAD_SETUP_ASK_MENTOR,
  CAD_SETUP_CONNECT,
  CAD_SETUP_DESCRIPTION,
  CAD_SETUP_FUSION,
  CAD_SETUP_ONSHAPE_BLOCKED,
  CAD_SETUP_ONSHAPE_READY,
  CAD_SETUP_RECONNECT,
  CAD_SETUP_TITLE,
} from "./cad-setup-copy";
import { expectPlainCopy } from "../ui/copy-assertions";

const ALL_COPY = [
  CAD_SETUP_TITLE,
  CAD_SETUP_DESCRIPTION,
  CAD_SETUP_ASK_MENTOR,
  CAD_SETUP_CONNECT,
  CAD_SETUP_RECONNECT,
  CAD_SETUP_ONSHAPE_READY,
  CAD_SETUP_ONSHAPE_BLOCKED,
  CAD_SETUP_FUSION,
  CAD_PAIR_DESCRIPTION,
  CAD_PAIR_ONSHAPE,
  CAD_PAIR_FUSION,
  CAD_PAIR_APPROVED,
  CAD_PAIR_TITLE,
].join(" ");

const LEAK = /ONSHAPE_OAUTH|vantage-cad|Vercel|key_source|OAuth|CLI|BroadcastChannel|\bP2P\b|RESEND/i;

describe("CAD setup student copy", () => {
  it("never dumps CLI, env var names, or engineering vocabulary", () => {
    expect(ALL_COPY).not.toMatch(LEAK);
    expect(CAD_SETUP_CONNECT).toBe("Connect Onshape");
    expect(CAD_SETUP_ASK_MENTOR).toMatch(/Ask a mentor/i);
    expectPlainCopy(CAD_SETUP_DESCRIPTION);
    expectPlainCopy(CAD_SETUP_ASK_MENTOR);
    expectPlainCopy(CAD_SETUP_ONSHAPE_READY);
    expectPlainCopy(CAD_SETUP_FUSION);
    expectPlainCopy(CAD_PAIR_DESCRIPTION);
    expectPlainCopy(CAD_PAIR_APPROVED);
    expect(CAD_PAIR_TITLE).toBe("Pair this computer");
    expectPlainCopy(CAD_PAIR_TITLE);
  });

  it("keeps the wizard and pair pages free of install dumps", () => {
    const webRoot = join(__dirname, "..", "..");
    const wizard = readFileSync(join(webRoot, "app/cad/setup/setup-client.tsx"), "utf8");
    const pair = readFileSync(join(webRoot, "app/cad/pair/pair-client.tsx"), "utf8");
    const page = readFileSync(join(webRoot, "app/cad/setup/page.tsx"), "utf8");
    const pairPage = readFileSync(join(webRoot, "app/cad/pair/page.tsx"), "utf8");
    expect(pair).toMatch(/CAD_PAIR_TITLE/);
    expect(pair).not.toMatch(/Approve this computer/);
    for (const src of [wizard, pair, page, pairPage]) {
      expect(src).not.toMatch(/ONSHAPE_OAUTH_CLIENT_ID|vantage-cad login|install-windows|vantage-cad setup|vantage-cad start|Copy commands|key_source=local_cli/);
      expect(src).not.toMatch(/Vercel never runs Fusion|Terminal \/ local CLI|AI brain/);
    }
  });
});
