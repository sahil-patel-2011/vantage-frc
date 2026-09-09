import { describe, expect, it } from "vitest";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  PRIVACY_POLICY,
  splitOnContactEmail,
  TERMS_OF_SERVICE,
  type LegalDocument,
} from "./documents";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("legal documents", () => {
  it("exports exactly the privacy policy and the terms", () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.slug)).toEqual(["privacy", "terms"]);
  });

  it("has a last-updated date", () => {
    expect(LEGAL_LAST_UPDATED).toMatch(/\d{4}/);
  });

  for (const doc of LEGAL_DOCUMENTS) {
    describe(doc.slug, () => {
      it("has a title and a summary", () => {
        expect(doc.title.trim().length).toBeGreaterThan(0);
        expect(doc.summary.trim().length).toBeGreaterThan(0);
      });

      it("gives every section an anchor-safe id and a heading", () => {
        expect(doc.sections.length).toBeGreaterThan(0);
        for (const section of doc.sections) {
          expect(section.id, `${doc.slug} section id`).toMatch(SLUG_PATTERN);
          expect(section.heading.trim().length, `${doc.slug}#${section.id} heading`).toBeGreaterThan(0);
        }
      });

      it("gives every section non-empty content", () => {
        for (const section of doc.sections) {
          expect(section.paragraphs.length, `${doc.slug}#${section.id} paragraphs`).toBeGreaterThan(0);
          for (const paragraph of section.paragraphs) {
            expect(paragraph.trim().length, `${doc.slug}#${section.id} paragraph`).toBeGreaterThan(0);
          }
          if (section.list) {
            expect(section.list.length, `${doc.slug}#${section.id} list`).toBeGreaterThan(0);
            for (const item of section.list) {
              expect(item.trim().length, `${doc.slug}#${section.id} list item`).toBeGreaterThan(0);
            }
          }
        }
      });

      it("keeps section ids unique", () => {
        const ids = doc.sections.map((section) => section.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("names the contact route somewhere", () => {
        const text = doc.sections.flatMap((section) => [...section.paragraphs, ...(section.list ?? [])]).join(" ");
        expect(text).toContain(LEGAL_CONTACT_EMAIL);
      });
    });
  }

  // The training disclosure is a material term. It must be stated plainly in
  // BOTH documents — this guard fails if it is ever removed from either, or
  // reduced to one document where a reader of the other would miss it.
  it("discloses in-house model training openly in both documents", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const text = doc.sections
        .flatMap((section) => [...section.paragraphs, ...(section.list ?? [])])
        .join(" ");
      expect(text, `${doc.slug} must disclose training use`).toMatch(/train[^.]*in-house models|in-house models[^.]*train/i);
    }
  });

  describe("splitOnContactEmail", () => {
    it("returns one text run when the address is absent", () => {
      expect(splitOnContactEmail("no address here")).toEqual([{ kind: "text", value: "no address here" }]);
    });

    it("marks each occurrence of the address", () => {
      expect(splitOnContactEmail(`Write to ${LEGAL_CONTACT_EMAIL} today.`)).toEqual([
        { kind: "text", value: "Write to " },
        { kind: "email", value: LEGAL_CONTACT_EMAIL },
        { kind: "text", value: " today." },
      ]);
    });

    it("drops empty runs so no blank fragment renders", () => {
      expect(splitOnContactEmail(LEGAL_CONTACT_EMAIL)).toEqual([{ kind: "email", value: LEGAL_CONTACT_EMAIL }]);
    });

    it("round-trips the original text", () => {
      for (const doc of LEGAL_DOCUMENTS) {
        for (const section of doc.sections) {
          for (const paragraph of section.paragraphs) {
            expect(splitOnContactEmail(paragraph).map((run) => run.value).join("")).toBe(paragraph);
          }
        }
      }
    });
  });

  // ------------------------------------------------------------ analytics
  //
  // The consent banner links to /privacy#analytics and its copy makes specific
  // promises. These guards fail if the disclosure is removed, renamed, or
  // softened into the reassuring-but-empty register that cookie banners
  // normally use. Most of our users are minors; that is the whole reason this
  // block is here rather than left to review discipline.
  describe("analytics disclosure", () => {
    const section = PRIVACY_POLICY.sections.find((candidate) => candidate.id === "analytics");
    const text = () => [...(section?.paragraphs ?? []), ...(section?.list ?? [])].join(" ");

    it("keeps the #analytics anchor the consent banner links to", () => {
      expect(section, "/privacy#analytics must exist — the consent banner links to it").toBeDefined();
    });

    it("refuses to call account-identified events anonymous", () => {
      expect(text()).toMatch(/not anonymous/i);
      // "anonymous data"/"anonymised" would be the tempting lie. It stays out.
      expect(text()).not.toMatch(/anonymi[sz]ed|anonymous data/i);
    });

    it("states that analytics are opt-in and that declining costs nothing", () => {
      // The claim under test is "collection is off until the person agrees",
      // not one particular sentence — the wording is allowed to be edited, the
      // promise is not.
      expect(text(), "must say collection is off until the user agrees").toMatch(
        /off until you (say yes|turn it on|opt in)/i,
      );
      expect(text(), "must say the product still works after a decline").toMatch(
        /working exactly as it did|nothing is locked/i,
      );
    });

    it("names the identifiers attached to each event", () => {
      expect(text()).toMatch(/account id/i);
      expect(text()).toMatch(/team id/i);
    });

    it("denies location, fingerprinting, and content collection outright", () => {
      const body = text();
      expect(body).toMatch(/no location of any kind/i);
      expect(body).toMatch(/no device fingerprint/i);
      expect(body).toMatch(/no IP address/i);
      expect(body).toMatch(/not a chat message/i);
    });

    it("states the 180-day raw-event retention window", () => {
      expect(text()).toMatch(/180 days/);
    });

    it("says how to change the answer later", () => {
      expect(text()).toMatch(/reopens the chooser/i);
    });
  });

  // The "no advertising cookies" promise predates product analytics. Adding
  // analytics must never have made it false.
  it("keeps the no-advertising-cookies promise, unconditionally", () => {
    const deviceStorage = PRIVACY_POLICY.sections.find((section) => section.id === "device-storage");
    const text = [...(deviceStorage?.paragraphs ?? []), ...(deviceStorage?.list ?? [])].join(" ");
    expect(text).toMatch(/do not use advertising cookies, session replay, or fingerprinting/i);
    expect(text, "the promise must not be scoped to the analytics choice").toMatch(
      /whether or not you turn analytics on/i,
    );
  });

  it("lists the consent cookie itself as a necessary cookie", () => {
    const deviceStorage = PRIVACY_POLICY.sections.find((section) => section.id === "device-storage");
    const text = (deviceStorage?.paragraphs ?? []).join(" ");
    expect(text).toMatch(/three necessary cookies/i);
    expect(text).toMatch(/remembers the answer you gave about analytics/i);
  });

  it("describes device-local personalisation as device storage", () => {
    const deviceStorage = PRIVACY_POLICY.sections.find((section) => section.id === "device-storage");
    const text = (deviceStorage?.paragraphs ?? []).join(" ");
    expect(text).toMatch(/command palette remembers/i);
    expect(text).toMatch(/not sent to us or synced between your devices/i);
  });

  it("never links a section anchor that does not exist", () => {
    // Table-of-contents rendering derives hrefs from ids; assert the shape both
    // pages rely on so a linked anchor cannot silently break.
    const anchors = (doc: LegalDocument) => doc.sections.map((section) => `/${doc.slug}#${section.id}`);
    expect(anchors(PRIVACY_POLICY)).toContain("/privacy#what-we-collect");
    expect(anchors(TERMS_OF_SERVICE)).toContain("/terms#acceptable-use");
  });
});
