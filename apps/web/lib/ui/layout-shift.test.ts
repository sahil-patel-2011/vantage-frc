import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  A6-02 / A6-11 / A6-25: what moved the page after it first painted. The legal banner and the
  shell classes have their own tests (legal-update-banner.test.ts, shell-body-class.test.ts).
*/

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const css = read("app/shell-clarity.css");

describe("loading does not push the page around", () => {
  it("a hub panel holds its place while the tab's data arrives", () => {
    expect(css).toMatch(/body\.has-app-shell \.product-hub-panel \{\n {2}min-height: min\(60vh, 640px\);/);
  });

  it("Account's side column waits for the profile instead of being thrown down by it", () => {
    expect(css).toMatch(/\.account-workspace:has\(> \.account-personal > \[aria-busy="true"\]\) > \.account-directory \{\n {2}display: none;/);
    // The loading card that rule keys on is still a direct child of the personal column.
    const account = read("app/account/account-client.tsx");
    const personal = account.slice(account.indexOf('<div className="account-personal">'), account.indexOf('<aside className="account-directory"'));
    expect(personal).toMatch(/title="Loading account"[\s\S]*?aria-busy/);
  });

  it("hubs show one loading pattern, the card-shaped skeleton (A6-20)", () => {
    expect(read("components/product-hub.tsx")).toMatch(/if \(!orgReady\) return <HubPanelSkeleton \/>;/);
    expect(read("app/business/business-client.tsx")).not.toMatch(/Opening business…/);
  });

  it("the page itself does not rise in under the cards that already ease in", () => {
    expect(css).toMatch(/body\.has-app-shell :is\(\.module-page, \.dash-home\) \{\n {2}animation: none;/);
  });

  it("Home's greeting has no 'Welcome' frame on a client navigation back to it", () => {
    const view = read("app/dashboard/dashboard-home-view.tsx");
    expect(view).toMatch(/const hello = hydrated \? greeting\(\) : "Welcome";/);
    expect(read("lib/ui/use-hydrated.ts")).toMatch(/useSyncExternalStore\(\s*subscribe,\s*\(\) => true,\s*\(\) => false,?\s*\)/);
  });
});
