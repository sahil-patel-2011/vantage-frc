import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * Every control on screen says what it is.
 *
 * A button, link or field with no accessible name is invisible to anyone not
 * looking at it, and ambiguous to anyone who is. It is also the cheapest kind
 * of usability bug to ship, because nothing about the page looks wrong — the
 * icon is there, the field is there, and only the name is missing.
 *
 * Measured across twenty-eight pages, this found exactly two: the file pickers
 * on Kickoff, each sitting inside a `<label>` that already wrapped a textarea.
 * A label names its *first* control, so the textarea took the name and the
 * picker got nothing. That is not a thing review catches.
 *
 * The check uses the browser's own answer — `element.labels` — rather than
 * reading attributes, because a wrapping label is how most fields in this app
 * are named and an attribute-only check reports a hundred false positives and
 * buries the two real ones. A placeholder counts as a name here: it is not one
 * properly, but a field with one is identifiable on screen, and counting it as
 * nameless would bury the real cases again.
 */
const PAGES = [
  "/dashboard", "/calendar", "/competition", "/competition?tab=scouting",
  "/competition?tab=strategy", "/competition?tab=picklist-collab", "/build", "/build?tab=cad",
  "/build?tab=code", "/team", "/team?tab=attendance", "/team?tab=batteries", "/team?tab=hours",
  "/team?tab=knowledge", "/business", "/business?tab=budget", "/business?tab=sponsors",
  "/scouting", "/scouting/forms", "/inventory", "/logistics", "/ai?tab=chat",
  "/team/ai-keys", "/team/ai-memory", "/match-debrief", "/files", "/media", "/todos",
];

test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

test("every visible control on every main page has a name", async ({ page, context }) => {
  test.setTimeout(900_000);
  void context;
  await page.setViewportSize({ width: 1280, height: 900 });
  const offenders: string[] = [];
  for (const path of PAGES) {
    await gotoAsTeam(page, path);
    await page.waitForTimeout(3000);
    const found = await page.evaluate(() => {
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const name = (el: Element) => {
        // The browser's own answer for form controls: a wrapping or `for=`
        // label is how most inputs in this app are named, and reading only
        // the element's own attributes misses every one of them.
        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length) {
          const text = [...labels].map((l) => l.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
          if (text) return text;
        }
        const aria = el.getAttribute("aria-label")?.trim();
        if (aria) return aria;
        const labelled = el.getAttribute("aria-labelledby");
        if (labelled) {
          const target = document.getElementById(labelled.split(/\s+/)[0]!);
          if (target?.textContent?.trim()) return target.textContent.trim();
        }
        const title = el.getAttribute("title")?.trim();
        if (title) return title;
        // A placeholder is not a label, but a control with one is at least
        // identifiable on screen; counting it as nameless buries the real
        // cases under dozens of soft ones.
        const placeholder = el.getAttribute("placeholder")?.trim();
        if (placeholder) return placeholder;
        return (el.textContent ?? "").replace(/\s+/g, " ").trim();
      };
      const controls = [...document.querySelectorAll("button, [role='button'], a[href], input, select")];
      return controls
        .filter((el) => visible(el) && !name(el))
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const cls = (el.className || "").toString().split(" ").slice(0, 2).join(".");
          const type = el.getAttribute("type") ?? "";
          return `${tag}${type ? `[${type}]` : ""}.${cls}`;
        });
    });
    for (const control of found) offenders.push(`${path} → ${control}`);
  }

  expect(
    offenders,
    `controls with no accessible name:\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});
