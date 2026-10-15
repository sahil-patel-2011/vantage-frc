import { describe, expect, it } from "vitest";
import { ONSHAPE_OFF_COPY, onshapeCheckState } from "./onshape-state";

describe("onshapeCheckState", () => {
  it("is off when the deployment has no Onshape client, whatever the status says", () => {
    expect(onshapeCheckState(false, null)).toBe("off");
    expect(onshapeCheckState(false, { configured: true, connections: [{ status: "connected" }] })).toBe("off");
  });
  it("follows a live answer that says Onshape was switched off", () => {
    expect(onshapeCheckState(true, { configured: false, connections: [] })).toBe("off");
  });
  it("asks to connect without a live connection, and is connected with one", () => {
    expect(onshapeCheckState(true, { configured: true, connections: [] })).toBe("connect");
    expect(onshapeCheckState(true, { configured: true, connections: [{ status: "disconnected" }] })).toBe("connect");
    expect(onshapeCheckState(true, { configured: true, connections: [{ status: "connected" }] })).toBe("connected");
  });
  it("is unknown when the status couldn't be read", () => {
    expect(onshapeCheckState(true, null)).toBe("unknown");
  });
  it("says what to do instead while Onshape is off", () => {
    expect(ONSHAPE_OFF_COPY).toContain("Settings → Connectors");
    expect(ONSHAPE_OFF_COPY).toContain("DXF check");
  });
});
