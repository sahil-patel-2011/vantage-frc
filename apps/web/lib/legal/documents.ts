/**
 * The Privacy Policy and Terms of Service, as data.
 *
 * Both pages render from this one module so the documents cannot drift apart.
 * Every statement here was verified against the code before it was written —
 * accuracy is the rule: never claim a protection or behaviour the software
 * does not implement.
 */

/**
 * Date these documents were last rewritten. Bump when the text changes.
 *
 * Revised on this date to add the "Product analytics" section (`#analytics`),
 * which discloses the opt-in first-party usage events introduced alongside the
 * consent banner. The date is not moved forward past the day the change landed:
 * a "last updated" in the future would be the first false statement in a
 * document whose whole point is that it can be checked.
 */
export const LEGAL_LAST_UPDATED = "August 24, 2026";

/** Where a privacy question goes. */
// The Privacy Policy and Terms name this address as the way to reach a
// human. It has to be one that is actually read: this product holds data
// about minors, and a policy pointing at a mailbox nobody owns is worse
// than no address at all.
export const LEGAL_CONTACT_EMAIL = "sahiljpatel2011@gmail.com";

export type LegalSection = {
  /** Stable anchor slug — `/privacy#what-we-collect` must keep working. */
  id: string;
  heading: string;
  paragraphs: string[];
  /** Optional bullet list rendered after the paragraphs. */
  list?: string[];
};

export type LegalDocument = {
  slug: "privacy" | "terms";
  title: string;
  /** One-line summary shown under the title. */
  summary: string;
  sections: LegalSection[];
};

const CONTACT = LEGAL_CONTACT_EMAIL;

/* ------------------------------------------------------------------ privacy */

export const PRIVACY_POLICY: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  summary:
    "What Vantage collects from FRC teams and their members, what we do with it, and what we do not do with it.",
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are, and who controls your team's workspace",
      paragraphs: [
        "Vantage is software for FIRST Robotics Competition teams. Teams use it to run scouting, match strategy, build hours, tasks, documents, chat, CAD work, and team finances in one place.",
        "Every team gets its own workspace. That workspace is controlled by the team's owners and admins — usually the head coach or lead mentors. They decide who is invited, what roles people have, and how the team's settings are configured. We host the software and keep it running; the team decides how it is used and who is in it.",
        "Each workspace is separated in the database itself. Every row belongs to one team, and the database refuses to return another team's rows to a signed-in member — this is Postgres your team's own space, enforced by the database rather than by a check in application code. A separate background worker account handles scheduled jobs.",
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect",
      paragraphs: [
        "Account and sign-in information. Your name and email address. You sign in with Google or with a six-digit code emailed to you; if your team turns on email two-factor, a second emailed code. We keep session records and basic security logs (such as sign-in attempts and rate-limit counters) so we can keep accounts safe.",
        "Profile information you enter during onboarding. Your display name, legal first and last name, date of birth, gender (optional — \"prefer not to say\" is one of the choices), your role on the team, your team number, an optional recovery email, and an optional phone number if you use phone verification.",
        "Your date of birth and gender are private. In the database, only you and Vantage platform administrators can read those two fields. Your coach, your mentors, and your team's owners and admins cannot see them in the product.",
        "Your team role — student, mentor, coach, parent, or other — is not private. Other members of your team can see it, and some team settings (such as direct-message policies) are based on it.",
        "What you and your team create in the app. This is the bulk of the data and it belongs to the team:",
        "Technical records we need to run the service, such as audit rows for sensitive administrative actions (invites, exports, permission changes) and usage records for AI features.",
      ],
      list: [
        "Scouting entries, including photos of robots taken during pit scouting. Photos are stored in our database inside your team's rows, not in a public bucket.",
        "Chat messages — both the team channel and direct messages between members.",
        "Build hours, including any scan code your team enrolls for you (a student ID or barcode). A scan code is never your email address, and only you and your team's owners and admins can read it.",
        "Tasks, calendars, logistics, documents, and notes.",
        "CAD session records from Onshape or Fusion if your team connects them.",
        "Financial records your team enters, such as budgets, sponsor contacts, and expenses.",
      ],
    },
    {
      id: "messages",
      heading: "Chat and direct messages",
      paragraphs: [
        "Your team's chat lives inside the team's workspace like everything else. The team channel is visible to the whole team by design.",
        "Direct messages are between their participants. Team owners and admins can configure the team's direct-message policy, and can export a member's direct-message history — one named member at a time, with a written reason, and every export writes an audit record naming who ran it and why before any data is returned. That audit log is readable by the team's owners and admins. Messages the sender deleted are included in such an export with their deletion time. Outside this audited path, direct messages are not readable by admins at the database level.",
        "Chat messages are kept indefinitely. There is no retention window, no automatic deletion, and no legal-hold feature today.",
        "We do not scan message content, flag keywords, or build profiles from what you write.",
      ],
    },
    {
      id: "ai",
      heading: "How AI features use your data",
      paragraphs: [
        "Vantage's AI features are grounded in two things: your own team's data, and public FRC data from The Blue Alliance and Statbotics. They do not read another team's workspace. When there is no real data behind a question, the feature says so and shows a setup or empty state — it does not invent numbers.",
        "We use your team's AI activity to train our own models. Prompts, the context sent with them, model responses, and tool traces from Vantage's AI features may be used by us to train, fine-tune, and evaluate in-house models that improve Vantage. This applies to AI-feature activity across the product. We do not sell this data or share it with advertisers, and third-party model providers still receive your requests only to answer them — the training use described here is ours. If your team brings its own API key, requests made with it are also subject to that provider's own terms, which say their own things about training — worth reading.",
        "When someone on your team uses an AI feature, the prompt and the context it needs are sent to the model provider your team has configured. Out of the box that is a major provider your team selects — Anthropic, OpenAI, or Google — or any OpenAI-compatible endpoint your team points us at. The provider processes the request and returns an answer.",
        "AI use is metered. Every call is recorded against your team's usage ledger so that plan limits, credit balances, and spend caps can be enforced. Those records include which feature was used, the model, and token counts — not a separate copy of your content.",
        "Bring-your-own keys are encrypted. If your team supplies its own provider API key, it is stored using envelope encryption: a unique data key encrypts the secret, and that data key is itself encrypted by a key-management service. Keys are decrypted only to make a request your team asked for. They are never shown back to you in full and are never included in a data export.",
        "Prompt caching is on by default. Parts of a prompt that repeat may be cached at the provider so repeat requests cost less and run faster. Your team can turn this off in AI budget settings.",
        "There is a nightly summary job. Once a day, a background job reads your team's own activity from the previous 24 hours and writes a single short summary into your team's memory, so AI surfaces start the next day knowing what happened. If the team had no activity, nothing is written. If no AI model is available, a plain-text list of the same facts is stored instead — the job never invents prose. Every run is logged where your team can see it.",
      ],
    },
    {
      id: "third-parties",
      heading: "Other companies involved, and what each one gets",
      paragraphs: [
        "We use a small number of service providers. Several of them only come into play if your team turns the feature on.",
        "These providers process data to deliver their service to us. We do not sell data to anyone, and none of these are advertising networks.",
      ],
      list: [
        "Neon (Postgres hosting) — hosts the database where your team's workspace lives. This is where essentially all of your data sits.",
        "Resend (email) — sends sign-in codes, two-factor codes, invitations, password-reset emails, and notifications. It receives the recipient's email address and the message.",
        "Stripe (payments) — handles subscriptions and payments. Card details go directly to Stripe; we do not store card numbers.",
        "Google (sign-in) — if you sign in with Google, Google confirms your identity and returns your name, email, and account id.",
        "The Blue Alliance and Statbotics (public FRC data) — we read public event, team, and match data from them. We send event and team keys, never your members' information.",
        "Onshape and Fusion (CAD, opt-in) — only if your team connects a CAD account. They receive the document and session requests your team makes.",
        "GitHub (opt-in) — only if your team connects a repository for robot-code review. It receives requests for the code your team pointed us at.",
        "Twilio (phone verification, opt-in) — only if you verify a phone number. It receives that phone number and the verification message.",
        "AI providers your team configures (opt-in) — receive the prompt and context for each AI request, as described above.",
        "Plausible (website analytics) — only when the deployment is configured for it. It records page views for the marketing site without advertising cookies or cross-site profiles.",
      ],
    },
    {
      id: "retention",
      heading: "Where data lives, how long we keep it, and how to get it out",
      paragraphs: [
        "Your team's data lives in our Postgres database, hosted by Neon. We do not currently offer a choice of hosting region — if that matters for your organization, ask us before you sign up.",
        "We keep a team's data for as long as the team is active, and afterwards only as long as we need it for security, legal, billing, or dispute reasons. Chat messages specifically have no automatic deletion, as noted above.",
        "Your team can export its own data at any time from the Exports area — individual areas as CSV, or the whole workspace as a ZIP archive. API keys and encryption material are never included in an export.",
        "When a member leaves a team, their membership is removed and they immediately lose access to that workspace. The work they created — scouting entries, hours, tasks, messages in team channels — stays with the team, because it is the team's operating record rather than personal property. Their Vantage account and their own profile stay with them.",
        "When a team stops using Vantage, export first. On request we delete the team, and deleting an organization removes its rows throughout the database. Ask us at " +
          CONTACT +
          " and tell us the team number.",
        "You can ask us to access, correct, export, or delete your personal information by writing to " +
          CONTACT +
          ". Where the data is your team's record rather than yours alone, we will tell you that and involve your team's owner. Vantage is not a HIPAA service and we make no HIPAA claims.",
      ],
    },
    {
      id: "device-storage",
      heading: "What is stored on your own device",
      paragraphs: [
        "Competition venues have terrible Wi-Fi, so parts of Vantage keep a copy of data in your browser so they keep working offline.",
        "This data sits in your browser's storage on that device. It matters most on a shared laptop or tablet in the shop or the pit: the next person to use that device could open the browser and see the cached copy.",
        "To clear it, clear site data for the Vantage site in your browser's settings (in Chrome: Settings → Privacy → Site settings → the Vantage site → Delete data). Signing out does not automatically wipe these caches.",
        "Some personalisation never leaves the device either. The command palette remembers the few destinations you opened most recently, the team picker remembers the teams you switched to, the dashboard remembers how you arranged it, the sign-in page can remember which account you used, and scouting keeps an autosaved draft. Those preferences live in your browser's storage on that device and are not sent to us or synced between your devices — which also means a different browser starts fresh.",
        "We use three necessary cookies, and they are not part of the analytics choice described in the next section: one keeps you signed in, one remembers your light or dark theme, and one remembers the answer you gave about analytics. A necessary cookie is one the product cannot work without — or, in the third case, one that exists only so we can honour a \"no\".",
        "We do not use advertising cookies, session replay, or fingerprinting. That is true whether or not you turn analytics on.",
      ],
      list: [
        "Scouting keeps an offline queue of entries and robot photos until they upload. Entries can also be handed from one device to another with a QR code.",
        "The hours kiosk keeps sign-ins queued when the shop network drops.",
        "Calendar, tasks, logistics, and My Day keep a copy of the last data they successfully loaded.",
      ],
    },
    {
      id: "analytics",
      heading: "Product analytics",
      paragraphs: [
        "Vantage can record which pages and features your account opens, so we can see what teams actually use and invest accordingly. It is off until you turn it on.",
        "We ask once, and the decline button is the same size as the accept button. Choosing \"only necessary cookies\" leaves every part of Vantage working exactly as it did — nothing is locked, slowed, or nagged about afterwards.",
        "These events are linked to your account, not anonymous. Each one is stored against your account id and your team id, in your team's own rows, behind the same your team's own space as the rest of your team's data. Your team's owners and admins can read your team's events; other members of your team cannot. No advertising network, analytics vendor, data broker, or other third party receives them, and no third-party tracking script is embedded in the signed-in product. The separate Plausible analytics on our public marketing pages, described above, is a different thing, and it also carries no advertising cookies and builds no cross-site profile.",
        "How long we keep them. Raw events are deleted 180 days after they are recorded, by a scheduled purge. A team's owners and admins can clear their team's history sooner than that.",
        "Changing your mind. Your answer is stored in a cookie on the device and browser you answered it on, so a different browser or a different computer will ask you again. To change it, come back to this section of this page — opening it reopens the chooser — and pick the other answer. Turning analytics off stops collection immediately; ask us at " +
          CONTACT +
          " if you also want the events already recorded about you deleted.",
        "What an event never contains. These are not settings we could quietly flip, because the columns do not exist in the table: no IP address, no location of any kind, no user-agent string, no device fingerprint, nothing you typed anywhere in the product — not a search query, not a chat message, not a scouting note, not an AI prompt — no screen or session recording, and nothing at all about what you do on other websites. Any web server has to see an IP address in order to answer a request; it is not written into these records and is not used to work out where you are.",
        "And here is everything one event does contain:",
      ],
      list: [
        "Which event it was, chosen from a fixed list the database itself enforces: a page view, opening a feature, an action inside a feature, running a search, starting an export, invoking an AI feature, finishing an onboarding step, or reaching a screen that told you something still needs setting up.",
        "The shape of the route — \"/scouting\", or \"/team/:id/hours\". Query strings are dropped and id-shaped parts of the address are replaced with \":id\" in your browser, before the event is sent, so a record id or a search term cannot travel inside a URL.",
        "Your account id and your team id.",
        "The time it happened.",
        "Whether the screen was phone-sized, tablet-sized, or desktop-sized. That single bucket is the entire amount we record about your device.",
        "A few short labels, such as which feature and which action — length-capped and restricted to label-shaped values, so free text you typed cannot get in.",
      ],
    },
    {
      id: "children",
      heading: "Students under 13, and parental consent",
      paragraphs: [
        "FRC teams include middle-school students, so some members are under 13. We ask for date of birth during onboarding, which means we know when that is the case rather than guessing.",
        "Vantage is not sold to children directly and cannot be joined by one on their own. Access is closed: a school or team organisation is provisioned by us, and its owners and admins invite specific email addresses. A student cannot create a team, and cannot join one without being invited by an adult who runs that team.",
        "Where a member is under 13, the team — through its coach or lead mentors, acting for the school or organisation that runs it — is responsible for obtaining any parental consent their jurisdiction requires before inviting that student, and for holding the record of it. We support that rather than replace it: the team controls who is invited, and a parent or guardian may ask the team to remove their child at any time, which removes their access and lets the team delete their data.",
        "If you are a parent or guardian and want to know what Vantage holds about your child, ask your child's coach or mentors first — they administer the team and can show you. If you cannot get an answer that way, write to " + CONTACT + " and we will work with the team to resolve it.",
        "We do not use a student's information to advertise to them. We do not sell personal information, and we do not build advertising profiles. There is no advertising in Vantage.",
      ],
    },
    {
      id: "guardians",
      heading: "Parents and guardians",
      paragraphs: [
        "Vantage has a parent view: a team can send a guardian a private link that shows upcoming team events and their own student's RSVP. That link is the entire credential, so treat it like a password and do not forward it.",
        "The parent view deliberately shows very little. It carries the team name and number, upcoming events, and the linked student's own RSVP. It does not show other students' names, contact details, grades, notes, or anything a mentor has written. A guardian holding one of these links does not get an account and cannot see the rest of the team.",
        "A team can turn a parent link off at any time, which stops it working immediately.",
      ],
    },
    {
      id: "your-rights",
      heading: "Seeing, correcting, exporting, and deleting your information",
      paragraphs: [
        "You can see and change your own profile in the product at any time, and you can change or turn off every email category from your notification preferences.",
        "You can ask for a copy of what we hold about you, ask us to correct it, or ask us to delete it. Write to " + CONTACT + ". We will ask you to confirm you are who you say you are before acting, because doing otherwise would itself be a privacy failure.",
        "Two limits apply. First, some of what you did is also the team's record — hours you logged, scouting data you collected, a decision you wrote down. Removing your account does not silently rewrite the team's history; where we can, we detach your name from those records rather than destroying the team's work. Second, we keep what the law requires us to keep, such as billing records, for as long as it requires.",
        "If your team stops using Vantage, its owners can export the team's data and ask us to delete the team.",
      ],
      list: [
        "See it — your profile and preferences are visible in the product; ask us for anything else",
        "Correct it — edit your profile, or write to us",
        "Export it — team owners can export the team's data",
        "Delete it — ask us, and we will explain exactly what is removed and what is retained and why",
      ],
    },
    {
      id: "subprocessors",
      heading: "Companies that process data on our behalf",
      paragraphs: [
        "Running Vantage means other companies handle some of your data. These are the ones that do, and what each one sees. We choose them, and we are responsible for them.",
        "Some of these only apply if your team turns the feature on. A team with no Onshape connection sends nothing to Onshape; a team using its own AI provider key sends nothing to ours.",
      ],
      list: [
        "Neon — our Postgres database. Holds essentially everything described in this policy.",
        "Vercel — hosting for the web app. Sees requests and standard server logs.",
        "Resend — sends our email: sign-in codes, invitations, reminders, and digests. Sees the recipient address and the message.",
        "Stripe — payments, for teams on a paid plan. Sees billing details; we do not store card numbers.",
        "Google — only if you sign in with Google, which tells us your name and email.",
        "AI providers (Anthropic, OpenAI, Groq, OpenRouter) — process the text of an AI request when a team uses an AI feature. A team may supply its own provider key instead, in which case the request goes to that team's own account.",
        "Onshape — only if your team connects CAD. Sees the CAD documents you authorise.",
        "Discord and Slack — only if your team connects a chat bridge, which forwards the messages your team chooses to forward.",
        "The Blue Alliance and Statbotics — public FRC event and match data. We read from them; we do not send them your team's information.",
        "Upstash — rate-limit counters, if configured. Sees no personal content.",
      ],
    },
    {
      id: "security-incidents",
      heading: "If something goes wrong",
      paragraphs: [
        "If we find that personal information has been exposed to someone who should not have seen it — a data breach — we will investigate, fix it, and tell the affected teams' owners and admins without unreasonable delay, along with any breach notification the law requires. We will say what happened, what was affected, and what we are doing — not a vague reassurance.",
        "If you think you have found a security issue, write to " + CONTACT + ". We will not pursue you for reporting something you found in good faith and did not exploit.",
      ],
    },
    {
      id: "legal-requests",
      heading: "Legal requests",
      paragraphs: [
        "We will disclose information if we are legally required to — a valid subpoena, court order, search warrant, or equivalent legal process, including a lawful law enforcement request. We check that a request is valid and we give it the narrowest reading we reasonably can.",
        "Where we are permitted to tell the affected team that a request was made, we will, so that they can respond to it themselves.",
      ],
    },
    {
      id: "schools",
      heading: "School-affiliated teams",
      paragraphs: [
        "Many FRC teams are run by a school. Where a school directs a team's use of Vantage, the school is the one deciding what is collected and why, and we process that information on the school's instruction under this policy and our terms.",
        "If your school needs a written agreement covering student data, write to " + CONTACT + " and we will put one in place.",
      ],
    },
    {
      id: "where-data-lives",
      heading: "Where your data is held",
      paragraphs: [
        "Vantage is hosted in the United States, and your team's data is stored and processed there. If your team is outside the United States, using Vantage means that information is transferred there.",
      ],
    },
    {
      id: "contact",
      heading: "Questions",
      paragraphs: [
        "For any privacy question — yours or your team's — write to " + CONTACT + ".",
        "We may update this policy as Vantage changes. Material changes get a new effective date and version, and may require you to accept them again before you continue using Vantage.",
      ],
    },
  ],
};

/* -------------------------------------------------------------------- terms */

export const TERMS_OF_SERVICE: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary:
    "The rules for using Vantage: who may have an account, what teams and Vantage each owe, and what the product does and does not promise.",
  sections: [
    {
      id: "eligibility",
      heading: "Who can use Vantage",
      paragraphs: [
        "Vantage is closed. We set up a team and its owner; that owner and their admins invite specific email addresses. An invitation request, a waitlist entry, or a team number does not by itself get you an account. By creating an account, accepting an invitation, or using Vantage, you agree to these Terms and to the Privacy Policy.",
        "Team owners and admins are responsible for who they admit. Inviting someone gives that person access to the team's workspace. Owners and admins should remove members who leave the program promptly, and should keep every member's role accurate, because team settings depend on roles being right.",
        "Keep your account details accurate and your sign-in secure. Do not share an account with someone else.",
      ],
    },
    {
      id: "team-workspaces",
      heading: "Team workspaces and who controls them",
      paragraphs: [
        "Your team owns its content. Scouting entries, photos, messages, hours, documents, tasks, CAD records, and financial records belong to the team. You give us permission to store, process, and display that content to run Vantage for your team, and — for activity that goes through Vantage's AI features — to use the prompts, context, responses, and tool traces to train, fine-tune, and evaluate our own in-house models, as described in the Privacy Policy. We do not sell your content.",
        "A member's content stays with the team. When someone leaves the team, they lose access, but what they created remains part of the team's record. That is deliberate: a season's scouting data cannot vanish because a senior graduated.",
        "Your team's rows are separated from every other team's at the database level, so another team cannot open your team in the product. No system is perfectly secure and we do not promise that it is.",
        "What owners and admins can do:",
      ],
      list: [
        "Invite, remove, and change the roles of members.",
        "Trigger a password-reset email for a member. They never set someone's password themselves — Vantage sends the same reset email the sign-in page sends, so only the person who controls that mailbox can finish it, and completing a reset signs that member's other sessions out.",
        "Export the team's data, as CSV or as a ZIP archive.",
        "Configure the team's direct-message policy, and run an audited export of one named member's direct messages — a written reason is required and an audit record is written before any data is returned.",
        "Change team settings, including AI budgets and model policies.",
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      paragraphs: [
        "Vantage is a tool your whole team relies on. Use it like you would want it used about you.",
        "FIRST's own rules still apply. Nothing here replaces FIRST's Code of Conduct or your school or district's policies — those sit on top of these Terms, and where they are stricter, they win.",
        "We can suspend an account or a team that breaks these rules.",
      ],
      list: [
        "No harassment, bullying, threats, sexual content, or targeting anyone. This includes chat, scouting notes, and anything else you can type into the product.",
        "Do not share another team's private information, and do not post someone's personal details without their permission.",
        "Do not try to reach another organization's data, probe for a way around workspace separation, or use someone else's account.",
        "No scraping, bulk automated extraction, or reselling of data from Vantage, and no reverse-engineering the service.",
        "Do not use the AI features to do graded schoolwork dishonestly. Vantage is for running your robotics team. Using it to produce work you hand in as your own, where your school does not allow it, is a violation of these Terms as well as your school's policy.",
        "Do not upload malware, attempt to disrupt the service, or bypass rate limits and access controls.",
        "Respect The Blue Alliance's and Statbotics' terms when you use the public data Vantage surfaces from them.",
      ],
    },
    {
      id: "ai",
      heading: "AI features",
      paragraphs: [
        "AI output can be wrong. Check it before you act on it — especially for anything involving scouting conclusions, match strategy, engineering decisions, budgets, or safety. Treat it as a starting draft written by a fast assistant who was not at your event.",
        "Vantage does not invent your team's data. When a feature has no real data to work from, it shows a setup or empty state rather than a plausible-looking number. If you ever see a metric you cannot trace back to your own entries or to public FRC data, tell us.",
        "AI use is metered against your team's plan, credit balance, or pay-as-you-go budget. There is no silent overage: when a limit is reached, the call is refused with an explanation. Teams can set daily and monthly spend caps, token caps, model allowlists, warning thresholds, and a kill switch.",
        "If your team brings its own provider API key, your team is responsible for that provider account, its charges, and its acceptable-use terms. We use the key only for the requests your team makes, and we store it encrypted.",
      ],
    },
    {
      id: "billing",
      heading: "Plans, payment, and cancellation",
      paragraphs: [
        "Vantage offers a free tier, individual plans, team plans, an access tier with pay-as-you-go usage, and a short team trial. Current prices, what each plan includes, and how hosted AI credits are billed are on the pricing page — we do not restate prices here so that these Terms and the price list cannot disagree.",
        "Paid plans are billed through Stripe on a recurring basis until cancelled. Cancelling stops future renewals; it does not automatically refund the period you are in. Prices can change, and we will tell you before a change affects your renewal.",
        "Hosted AI usage is drawn from your plan's included allowance, then from prepaid credits, then — only if you enable it — from pay-as-you-go up to the spend cap you set. Bringing your own key means you pay your provider directly instead, and Vantage adds no markup to that.",
        "Teams are responsible for any taxes that apply to their purchase.",
      ],
    },
    {
      id: "availability",
      heading: "Availability and changes to the service",
      paragraphs: [
        "We work to keep Vantage running, but we do not promise it will be uninterrupted or error-free, and we do not offer an uptime guarantee. Do not make Vantage the only copy of something your team cannot afford to lose — export regularly.",
        "Several integrations require your own setup or credentials (CAD, GitHub, phone verification, your own AI keys, email delivery, payments). Until they are configured, those features tell you what is missing instead of working.",
        "Features can change, be added, or be withdrawn. If we remove something a team depends on, we will give notice where we reasonably can and make sure the data can be exported.",
        "To the extent the law allows, Vantage is provided \"as is\" and \"as available\", without warranties, and our liability is limited to what you paid us in the twelve months before the claim. Some jurisdictions do not allow these limits, in which case they apply only as far as they legally can.",
      ],
    },
    {
      id: "who-owns-what",
      heading: "Who owns what",
      paragraphs: [
        "Your team owns its data. Scouting records, match notes, documents, CAD links, hours, budgets, chat — that is the team's work, and using Vantage does not transfer it to us. We hold it to run the service for you.",
        "We do not sell it, we do not license it to anyone else, and we do not use one team's data to give another team an advantage. Aggregate operational metrics we use to keep the service running — error rates, load, feature usage counts — are not team data and never identify a team's strategy.",
        "Vantage itself — the software, the interface, the name — stays ours.",
        "Team owners can export their data, and can ask us to delete the team when they are done with it.",
      ],
    },
    {
      id: "members-under-18",
      heading: "Members under 18",
      paragraphs: [
        "Most people using Vantage are high-school students, and some are younger. Accounts are created by invitation from a team's owners or admins — a student cannot sign themselves up.",
        "If you are under 18, a parent, guardian, or the adult who runs your team must agree to these terms on your behalf. By inviting a student, the team confirms it has whatever permission its school or organisation requires.",
        "A parent, guardian, or coach can have a student removed from a team at any time by asking the team's owners or admins.",
      ],
    },
    {
      id: "termination",
      heading: "Suspension and ending your use",
      paragraphs: [
        "You can stop using Vantage at any time. A team owner can cancel the team's plan, export the team's data, and ask us to delete the team.",
        "We can suspend or end access for a violation of these Terms, for a security risk, for non-payment, or where the law requires it. Where a serious safety or security issue is involved we may act immediately and explain afterwards. If we terminate a team for a reason other than an emergency, we will give the owner a reasonable chance to export the team's data first.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to these documents",
      paragraphs: [
        "These Terms and the Privacy Policy carry an effective date and a version. When we change them, we update both.",
        "For a material change, we will notify account holders and may require you to accept the new version before you continue using Vantage. Continuing to use Vantage after a non-material update means you accept it.",
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      paragraphs: ["Questions about these Terms: " + CONTACT + "."],
    },
  ],
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [PRIVACY_POLICY, TERMS_OF_SERVICE];

/**
 * Split a paragraph around the contact email so a page can render the address
 * as a mailto link without the section text carrying markup.
 */
export function splitOnContactEmail(text: string): Array<{ kind: "text" | "email"; value: string }> {
  const parts = text.split(LEGAL_CONTACT_EMAIL);
  const out: Array<{ kind: "text" | "email"; value: string }> = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ kind: "email", value: LEGAL_CONTACT_EMAIL });
    if (part) out.push({ kind: "text", value: part });
  });
  return out;
}
