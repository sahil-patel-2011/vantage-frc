import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesktopDownloads } from "../../app/desktop/desktop-downloads";

const render = (props: Parameters<typeof DesktopDownloads>[0]) => renderToStaticMarkup(createElement(DesktopDownloads, props));

describe("desktop download buttons", () => {
  it("uses one Mac button for a universal disk image and no chip note", () => {
    const html = render({ windowsUrl: "https://w/setup.exe", mac: { dmg: "https://m/app.dmg", arm64: null, x64: null } });
    expect(html).toContain('href="https://m/app.dmg"');
    expect(html).toContain("Download for Mac");
    expect(html).not.toContain("Apple silicon");
  });

  it("offers the Apple silicon zip first and the Intel zip as a link when the build is per chip", () => {
    const html = render({ windowsUrl: "https://w/setup.exe", mac: { dmg: null, arm64: "https://m/arm.zip", x64: "https://m/intel.zip" } });
    expect(html.indexOf("https://m/arm.zip")).toBeLessThan(html.indexOf("https://m/intel.zip"));
    expect(html).toContain("Apple silicon (M1 and newer)");
    expect(html).toContain("Intel Mac? Get the Intel version.");
  });

  it("falls back to the chip that exists when only one zip is published", () => {
    const html = render({ windowsUrl: null, mac: { dmg: null, arm64: null, x64: "https://m/intel.zip" } });
    expect(html).toContain('href="https://m/intel.zip"');
    expect(html).toContain("for Intel Macs");
    expect(html).not.toContain("Get the Intel version");
  });
});
