import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("CAD vault last snapshot stays on the phone", () => {
  it("reads and writes the cad-vault IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "cad-vault-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/clearFeatureSnapshot/);
    expect(src).toMatch(/"cad-vault"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="CAD vault"/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).toMatch(/authBlocked/);
    expect(src).not.toMatch(/tessellation/i);
    expect(src).not.toMatch(/magic numbers/i);
  });

  it("keeps related in the header and next-actions off setup", () => {
    const chrome = readFileSync(join(DIR, "cad-vault-chrome.tsx"), "utf8");
    expect(chrome).toMatch(/function CadVaultRelated/);
    const emptyFn = chrome.slice(chrome.indexOf("function CadVaultEmptyCard"));
    expect(emptyFn).not.toMatch(/CadVaultRelated/);
    const src = readFileSync(join(DIR, "cad-vault-client.tsx"), "utf8");
    const setup = src.slice(src.indexOf('view.status === "setup_required"'), src.indexOf("const documents"));
    expect(setup).not.toMatch(/CadVaultNextActions/);
    expect(setup).toMatch(/CadVaultEmptyCard shell="setup"/);
  });
});
