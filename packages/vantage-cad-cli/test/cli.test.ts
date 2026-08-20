import { describe, expect, it } from "vitest";
import { browserCommand, fusionAddinPaths, validatePluginEndpoint } from "../src/platform";
import { providerPolicy } from "../src/provider";
import { doctorExitCode, formatDoctorReport, onshapeCliKeyChecks, onshapeEnvChecks, osCapabilityMatrix } from "../src/doctor";
import { findVantageRepoRoot } from "../src/update";

describe("desktop CAD onboarding safety", () => {
  it("uses fixed browser executables without shell strings", () => {
    const command = browserCommand("https://vantage.example/cad/pair?code=A%26calc", "win32");
    expect(command.command).toBe("explorer.exe");
    expect(command.args).toHaveLength(1);
    expect(() => browserCommand("file:///etc/passwd", "linux")).toThrow("HTTP");
  });

  it("accepts only loopback Fusion plugin endpoints", () => {
    expect(validatePluginEndpoint("http://127.0.0.1:32145").port).toBe("32145");
    expect(() => validatePluginEndpoint("https://evil.example")).toThrow("loopback");
    expect(() => validatePluginEndpoint("http://192.168.1.2:32145")).toThrow("loopback");
    expect(fusionAddinPaths("darwin", "/Users/test")[0]).toContain("Autodesk Fusion 360");
    expect(fusionAddinPaths("win32", "C:\\Users\\test", {})[0]).toContain("Autodesk");
    expect(fusionAddinPaths("linux", "/home/test")).toEqual([]);
  });

  it("distinguishes provider billing and restricts Claude Code", () => {
    expect(
      providerPolicy("managed", {
        platformAdmin: false,
        matchingDevice: false,
        privateSession: false,
        interactive: false,
        explicitOptIn: false,
      }).billingSource,
    ).toContain("Vantage");
    expect(() =>
      providerPolicy("claude_code_personal", {
        platformAdmin: true,
        matchingDevice: false,
        privateSession: true,
        interactive: true,
        explicitOptIn: true,
      }),
    ).toThrow("personal local");
    expect(
      providerPolicy("personal_byok", {
        platformAdmin: false,
        matchingDevice: true,
        privateSession: true,
        interactive: true,
        explicitOptIn: true,
      }).consumerSubscriptionIsApiCredential,
    ).toBe(false);
  });
});

describe("doctor / OS matrix", () => {
  it("documents Linux Fusion as unsupported while keeping CLI + Onshape", () => {
    const linux = osCapabilityMatrix("linux");
    expect(linux.cli).toBe(true);
    expect(linux.fusionAutodesk).toBe(false);
    expect(linux.fusionAddin).toBe(false);
    expect(linux.onshapeHosted).toBe(true);
    expect(linux.note).toMatch(/not available on Linux/i);

    const mac = osCapabilityMatrix("darwin");
    expect(mac.fusionAutodesk).toBe(true);
    expect(mac.onshapeHosted).toBe(true);
  });

  it("flags incomplete Onshape OAuth env", () => {
    expect(onshapeEnvChecks({}).some((c) => c.status === "warn")).toBe(true);
    expect(
      onshapeEnvChecks({ ONSHAPE_OAUTH_CLIENT_ID: "only-id" } as NodeJS.ProcessEnv).some(
        (c) => c.status === "fail",
      ),
    ).toBe(true);
    expect(
      onshapeEnvChecks({
        ONSHAPE_OAUTH_CLIENT_ID: "id",
        ONSHAPE_OAUTH_CLIENT_SECRET: "secret",
      } as NodeJS.ProcessEnv).some((c) => c.id === "onshape-env" && c.status === "pass"),
    ).toBe(true);
    expect(onshapeCliKeyChecks({}).some((c) => c.id === "onshape-api-keys" && c.status === "warn")).toBe(true);
    expect(
      onshapeCliKeyChecks({
        ONSHAPE_ACCESS_KEY: "ak",
        ONSHAPE_SECRET_KEY: "sk",
      } as NodeJS.ProcessEnv).some((c) => c.id === "onshape-api-keys" && c.status === "pass"),
    ).toBe(true);
  });

  it("formats doctor report and exit codes", () => {
    const report = {
      ok: false,
      version: "0.1.1",
      vantageUrl: "http://localhost:3001",
      host: { platform: "linux", release: "6", arch: "x64", node: "22.0.0" },
      osMatrix: osCapabilityMatrix("linux"),
      checks: [
        { id: "node", title: "Node.js runtime", status: "pass" as const, detail: "ok" },
        { id: "vantage-url", title: "Vantage URL", status: "fail" as const, detail: "down" },
      ],
      summary: { pass: 1, warn: 0, fail: 1, skip: 0 },
    };
    expect(doctorExitCode(report)).toBe(1);
    expect(formatDoctorReport(report, false)).toContain("Doctor: FAILED");
    expect(JSON.parse(formatDoctorReport(report, true)).ok).toBe(false);
  });
});

describe("local update repo discovery", () => {
  it("resolves the monorepo root from cwd", async () => {
    const root = await findVantageRepoRoot(process.env, process.cwd());
    expect(root).toBeTruthy();
    expect(String(root).replace(/\\/g, "/")).toMatch(
      /\/(Vantage|vantage-frc|Vantage FRC Robotics AIO APP)$/i,
    );
  });
});
