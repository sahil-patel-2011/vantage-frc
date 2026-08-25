/**
 * The words on the consent banner, kept as data so a test can pin them.
 *
 * This copy is a promise made to a fifteen-year-old. It is pinned for the same
 * reason the training disclosure in the legal documents is pinned: a later
 * "tighten the microcopy" pass must not be able to quietly turn an honest
 * sentence into a comfortable one. If any of this changes, the test fails and
 * someone has to look at the privacy policy in the same commit.
 *
 * Rules the copy has to keep:
 *   - Never says "anonymous". It is not anonymous to us and saying otherwise
 *     would be the single most tempting lie available here.
 *   - Names the two identifiers we attach: the account and the team.
 *   - States plainly that declining costs the user nothing.
 *   - Says where to change the answer later.
 */

export const ANALYTICS_BANNER_COPY = {
  title: "Help improve Vantage",
  /** The honesty sentence. It leads, and it is not softened. */
  lead:
    "This is not anonymous to us. If you turn it on, we record which pages and features your account uses inside your team, and when.",
  detail:
    "That is the whole list: the page or feature, your account, your team, the time, and whether you are on a phone, tablet, or computer. No location, no ad networks, no tracking you across other websites, no recording of your screen, and never the things you type.",
  /** Declining has to be costless, and has to be said to be costless. */
  reassurance:
    "Say no and everything in Vantage still works exactly the same. We only ever ask once, and you can change your answer at any time.",
  acceptLabel: "Turn analytics on",
  declineLabel: "Only necessary cookies",
  detailsLabel: "What we collect",
  detailsHref: "/privacy#analytics",
  /** Shown in the reopened chooser once a choice already exists. */
  currentGranted: "Analytics are on for this browser.",
  currentDenied: "Analytics are off. Only strictly necessary cookies are in use.",
  changeHint: "You can change this whenever you like from the analytics section of the privacy policy.",
  ariaLabel: "Product analytics choice",
} as const;

export type AnalyticsBannerCopy = typeof ANALYTICS_BANNER_COPY;

/** Words that must never appear in the banner. Asserted by the copy test. */
export const FORBIDDEN_BANNER_WORDS = ["anonymous data", "anonymised", "anonymized", "we value your privacy"] as const;
