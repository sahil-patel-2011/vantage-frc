/**
 * The Privacy Policy and Terms of Service, as data.
 *
 * Both pages render from this one module so the documents cannot drift apart.
 * Every statement here was checked against the code before it was written.
 * Accuracy is the rule: never claim a protection or behaviour the software
 * does not implement, and never promise something nobody runs.
 */

/**
 * Date these documents were last rewritten. Bump when the text changes.
 *
 * Rewritten 2026-09-26 against the code, section by section. What changed and why:
 * - AI: the 2026-09-25 text told every team without a key that Vantage connects free
 *   providers (Groq, Cerebras, Mistral, Cohere) for it. The code does that only for a team
 *   Vantage has invited to a sponsored promotion (packages/billing/src/sponsored-promo.ts,
 *   resolveSponsoredPromoForOrg), so a walkthrough found every other team getting "no AI
 *   provider" while the policy promised otherwise. The AI section now lists the four real
 *   routes (team or personal key, own computer/server, Claude Code on a paired computer,
 *   the sponsored promotion) and says a team with none of them sends nothing.
 * - Cookies: there are more than three (a remembered team, a remembered two-step device, and
 *   two theme cookies), so the device-storage section lists each one.
 * - Plausible, when configured, loads on every page (app/layout.tsx), not only marketing pages;
 *   the analytics section no longer says no outside script runs in the signed-in product.
 * - New sections: who can see what (roles, public share links, operator access), security,
 *   and deleting. Photo and video uploads are paused (lib/media-availability.ts) and the
 *   policy says so. Sign-in records keep a network address and browser name (sessions table).
 *   Direct messages between an adult and a student include a second adult by default
 *   (migration 0455). Parent contacts, forms, and voice notes are listed.
 * - The nightly team summary is described as a job that runs when scheduled, not "once a day":
 *   its cron route is not on the Vercel schedule (docs/DEPLOYMENT.md).
 * LEGAL_DOC_VERSION moves to 2026-09-26.1 so each member sees the rewrite once and accepts it.
 *
 * Earlier: 2026-09-25 plain-reading rewrite (short versions first); 2026-09-24 training
 * switch, free pricing, private backup copy; 2026-09-22 team identities; 2026-09-20 governing
 * law; the analytics section with the consent banner.
 *
 * The date is not moved forward past the day the change landed: a "last updated" in the
 * future would be the first false statement in a document whose point is that it can be
 * checked.
 */
export const LEGAL_LAST_UPDATED = "September 26, 2026";

/** Where a privacy question goes. */
// The Privacy Policy and Terms name this address as the way to reach a
// human. It has to be one that is actually read: this product holds data
// about minors, and a policy pointing at a mailbox nobody owns is worse
// than no address at all.
export const LEGAL_CONTACT_EMAIL = "vantagefrc@gmail.com";

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
    "What Vantage collects from FRC teams and their members, who can see it, where it goes, and how to get it out or deleted.",
  sections: [
    {
      id: "summary",
      heading: "The short version",
      paragraphs: [
        "This is what the rest of this policy says, in a few lines. The full sections below are the ones that count.",
      ],
      list: [
        "Your team's data belongs to your team. The database itself keeps each team's records away from every other team.",
        "We collect what running a team needs: your name and email, the profile you fill in, and what your team creates (scouting, chat, hours, tasks, documents, budgets). Your date of birth and gender are visible only to you.",
        "We never sell data, never show ads, and never build advertising profiles.",
        "AI is off until your team turns it on. Then a request goes only where your team chose: its own AI key, its own computer, or Claude Code on a computer a mentor paired. Nothing is sent to an AI company for a team that has not set one of these up.",
        "Unless your team turns it off, we may use activity from Vantage's AI features to train and improve our own in-house models. An owner or admin can switch that off in one place.",
        "Usage analytics are off until you turn them on, and never include what you type.",
        "Students join only when a team's adult leaders invite them. Parents can ask the team, or us, what is held about their child.",
        "Photo and video uploads are paused right now, so none are being collected.",
        "You can see, correct, export, or ask us to delete your information by writing to " + CONTACT + ".",
      ],
    },
    {
      id: "who-we-are",
      heading: "Who we are, and who runs your team's space",
      paragraphs: [
        "Vantage is free software for FIRST Robotics Competition teams. Teams use it for scouting, match strategy, build hours, tasks, documents, chat, CAD work, and team money in one place. It runs at vantagefrc.vercel.app, and its scouting app at vantagefrc-scouting.vercel.app; both are the same service under this policy.",
        "Every team gets its own space. That space is run by the team's owners and admins, usually the head coach or lead mentors. They decide who is invited, what role each person has, and how the team's settings are set. We host the software and keep it running; the team decides how it is used and who is in it.",
        "Vantage is independent. It is not run by, sponsored by, or endorsed by FIRST.",
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect",
      paragraphs: [
        "Account and sign-in. Your name and email address. You sign in with Google, with a six-digit code emailed to you (it expires after five minutes), or with a password if your account has one; passwords are stored only as a one-way scramble, never as the password itself. If your team turns on two-step sign-in, we also send a second emailed code. Each sign-in keeps a session record that includes the network address and browser name it came from, and we keep security records such as sign-in attempts and request counters so we can stop abuse.",
        "Your profile. During onboarding you give your display name, first and last name, date of birth, gender (optional; \"prefer not to say\" is a choice), your role on the team (student, mentor, coach, parent, or other), your subteam, and your team number. You can add a recovery email, and a phone number if you verify one.",
        "Your date of birth and gender are private. In the database, only you and Vantage platform administrators can read those two fields. Your coach, your mentors, and your team's owners and admins cannot see them in the product. Your team role is not private: teammates can see it, and some team settings, such as the direct-message rules, depend on it.",
        "What you and your team create in Vantage. This is most of the data, and it belongs to the team:",
        "Records we need to run the service: audit records of sensitive admin actions (invites, exports, permission changes), usage records for AI features, and, if you allow notifications on a device, that device's notification address and browser name.",
        "If you join the waitlist instead, we keep only your email, your team number, your phone number if you give one, and when you agreed to be contacted (and to launch texts, if you ticked that box).",
      ],
      list: [
        "Scouting: match and pit entries, notes, and ratings. Robot photos are part of pit scouting, but photo and video uploads are paused right now, so none are being collected.",
        "Chat: the team channel and direct messages between members.",
        "Build hours and attendance, including a scan code (such as a student ID barcode) if your team enrolls one for you. A scan code is never your email address, and only you and your team's owners and admins can read it.",
        "Tasks, calendars, logistics, documents, notes, forms and permission slips your team sends, and the answers people give.",
        "Contact details your team adds for parents or guardians (name, email, phone, preferred language) so it can email families.",
        "Files your team uploads, other than photos and videos, which are paused. Files are stored in our database, or, for large files, with a storage company when we have set one up (see the list below); a team can also send files to a storage computer it runs itself.",
        "Chats with Ask AI and what the AI saves to memory. Your private AI chats are visible only to you; team-shared chats and team memory are visible to your team. Voice notes, if your team uses them, are sent to your team's AI service to be written out as text.",
        "CAD records from Onshape or Fusion, and robot code review requests, if your team connects them.",
        "Money records your team enters, such as budgets, expenses, sponsors and their contacts, and grants.",
      ],
    },
    {
      id: "who-can-see",
      heading: "Who can see what",
      paragraphs: [
        "Other teams cannot see anything of yours. Every team record is tagged with its team, and the database refuses to hand a signed-in person any team's records but their own. That check happens inside the database, not only in the app's code.",
        "Inside your team, roles decide what each person can do. Owners and admins run the team: they invite and remove people, change settings, read the team's audit log and usage analytics, and see enrolled scan codes. Other members see the team's shared work (scouting, the calendar, tasks, the team channel) and add to it; view-only members mostly look. Some things stay with you alone: your date of birth and gender, your private AI chats, your personal AI key, and files you keep private.",
        "Some things your team can choose to share by link: a pit TV display board, a public form, a team showcase page, a shared strategy draft, a visit invite, or a parent link. Anyone holding that link sees what it shows, so share it only with the people it is meant for. A parent link can be switched off by the team at any time; if any other link needs to stop working, an owner can ask us and we will switch it off.",
        "The people who run Vantage can reach the database directly to operate and repair the service, and platform administrators can see some records in the product, such as which people are on which team, to set up teams and answer support requests. We look at a team's content only to keep Vantage running, to answer a request from that team, to look into abuse or a safety concern, or when the law requires it.",
      ],
    },
    {
      id: "messages",
      heading: "Chat and direct messages",
      paragraphs: [
        "The team channel is visible to the whole team by design.",
        "Direct messages between an adult (a mentor, coach, or parent) and a student include a second adult by default. This follows FIRST's youth-protection practice: when one side is an adult and the other is not, Vantage adds another adult owner or admin to the conversation, who can read it. A team's owners and admins can change this to allow such messages without a second adult, or to turn them off. Messages between two students, or between two adults, are not affected.",
        "Owners and admins can also export one named member's direct messages, with a written reason. Every such export writes an audit record naming who ran it and why before any messages are returned, and that audit log is readable by the team's owners and admins. Messages the sender deleted are included with their deletion time. Outside these two paths, owners and admins cannot read direct messages they are not part of.",
        "Chat messages are kept until the team is deleted. There is no automatic deletion.",
        "We do not scan message content, flag keywords, or build profiles from what you write.",
      ],
    },
    {
      id: "ai",
      heading: "How AI features use your data",
      paragraphs: [
        "AI is off for a team until an owner or admin turns it on under Team → AI keys. While it is off, AI buttons explain how to turn it on and nothing is sent to any AI company.",
        "What an AI request contains. Your question, the instructions Vantage adds, and the parts of your team's data the feature needs to answer, such as the scouting numbers behind a match question. AI features use your own team's data and public FRC data from The Blue Alliance and Statbotics. They never read another team's space. When there is no real data behind a question, the feature says so instead of inventing numbers.",
        "Where a request goes. These are the only routes, and your team picks among them:",
        "Public volunteer AI networks are off. Vantage can also reach networks where members of the public answer requests on their own computers (the AI Horde and Petals), but they are switched off. If one is ever switched on, this policy will say so first, because whoever runs the computer that answers can read what is sent.",
        "We may use your team's AI activity to train our own models. Prompts, the context sent with them, the answers, and the steps an AI agent took in Vantage's AI features may be used by us to train, fine-tune, and test in-house models that make Vantage better. This data stays with us: we do not sell it or give it to advertisers, and the AI companies above receive your requests only to answer them. Requests made with your team's own key or plan are also covered by that company's own terms, which say their own things about training.",
        "Your team can turn training off. An owner or admin can switch it off for the whole team under Team → AI keys → Model training. While it is off, none of that team's AI activity is used to train, fine-tune, or test our models.",
        "AI use is counted. Each call is recorded in your team's usage log (which feature, which model, and how much text went in and out) so the limits your team sets can work. Vantage charges nothing for AI; a team using its own key pays that company directly.",
        "Keys are locked. An AI key your team or a member saves is encrypted with a separate key service, used only to make requests your team asked for, never shown back in full, and never included in an export.",
        "Prompt caching is on by default: parts of a request that repeat may be kept briefly by the AI company so repeat requests cost less. Your team can turn this off in its AI settings.",
        "Nightly team summary. When the team summary job runs, it reads your team's own activity from the previous 24 hours and writes one short summary into your team's AI memory, so the AI knows what happened. If there was no activity, nothing is written. If no AI is set up, it stores a plain list of the same facts instead of prose. Each run is logged where your team can see it.",
      ],
      list: [
        "Your team's own key, or a member's personal key, with an AI company: Anthropic, OpenAI, Google, OpenRouter, or any service that works like OpenAI's (such as Groq or Mistral). The request goes to that account, under that company's terms. A personal key is used only for that member's own requests.",
        "A model on your team's own computer or server, such as Ollama or LM Studio. The request goes only to that machine.",
        "Claude Code on a paired computer. A mentor can pair a computer that runs Claude Code (or OpenAI's Codex) under their own subscription. The request, with the team context it needs, waits in our database for up to two minutes, then runs on that computer and goes to Anthropic (or OpenAI) under that person's plan and its terms. Removing the computer on the Claude Code page stops this at once.",
        "Vantage-sponsored free AI, only for a team Vantage has invited to a sponsored promotion, and only while it runs. Those requests go to Groq, Cerebras, Mistral, or Cohere through Vantage's own accounts. Other teams do not get this route.",
      ],
    },
    {
      id: "third-parties",
      heading: "Other companies involved, and what each one gets",
      paragraphs: [
        "Running Vantage means a small number of other companies handle some data for us. This is the complete list. We choose the ones we use, and none of them is an advertising network. Most only come into play if your team turns the feature on: a team with no Onshape connection sends nothing to Onshape, and a team without AI sends nothing to any AI company.",
      ],
      list: [
        "Neon (database): hosts the database where your team's space lives. Almost all of your data sits here.",
        "Vercel (hosting): runs the website and app. It sees requests and standard server logs.",
        "Email delivery (Google's mail service for our vantagefrc@gmail.com sender, or Resend where we set it up): sends sign-in codes, invitations, reminders, and notifications. It sees the recipient's address and the message.",
        "Google sign-in: if you sign in with Google, Google confirms who you are and gives us your name, email, and account ID.",
        "Google Drive (backup): Vantage can keep a private backup copy of each team's main records in its own Google Drive account. Each team's copy is kept separately, it leaves out email addresses and birthdays, it is shared with no one, and it is deleted when the team is deleted.",
        "Browser notification services (such as Google, Apple, Mozilla, or Microsoft, depending on your browser): if you allow notifications, they deliver them. The message is encrypted so the service cannot read it.",
        "AI companies: only as described in the AI section, and only for the route your team chose.",
        "TinyFish (web search, opt-in): only if your team adds its own TinyFish key so the AI can look things up. It receives the searches and pages the AI asks for.",
        "The Blue Alliance and Statbotics (public FRC data): we read public event, team, and match data. We send event and team numbers, never your members' information.",
        "Onshape and Autodesk Fusion (CAD, opt-in): only if your team connects them. Fusion talks to a helper program on your team's own computer. They receive the CAD requests your team makes.",
        "GitHub (opt-in): only if your team connects a repository for robot code review.",
        "Google Sheets, Google Drive, or Microsoft Excel (opt-in): only if your team connects its own spreadsheet or folder. Vantage then writes a copy of team records to it, or lists the files in it, inside your team's own account.",
        "Discord and Slack (opt-in): only if your team connects them. They receive the messages your team chooses to send there.",
        "Twilio (phone check, opt-in): only if you verify a phone number. It receives that number and the code message.",
        "Upstash (abuse limits, if we set it up): counts requests to stop abuse. It sees short-lived counters tied to an account or network address, never content.",
        "Large-file storage (if we set it up): a file storage company, such as Supabase Storage or Cloudflare R2, holds files too big for our database. Your browser sends and fetches those files directly through short-lived private links.",
        "Plausible (visit counts, if we turn it on): counts page views across the site without cookies. It records the page address and the site you came from, and never receives your account or what you type.",
        "Stripe (payments): Vantage is free, so Stripe receives nothing today. If a paid option is ever offered and an owner chooses it, card details go straight to Stripe, never to us.",
      ],
    },
    {
      id: "retention",
      heading: "Where data lives and how long we keep it",
      paragraphs: [
        "Your team's data is stored and processed in the United States, in our database hosted by Neon. If your team is outside the United States, using Vantage means your information goes there. We do not offer a choice of region; if that matters to your organization, ask us before you start.",
        "We keep a team's data for as long as the team uses Vantage. After that we keep it only as long as we need to for security, legal, or dispute reasons, or until the team asks us to delete it.",
      ],
      list: [
        "Chat messages: until the team is deleted. There is no automatic deletion.",
        "Usage analytics events (only if you turned analytics on): deleted once they are 180 days old.",
        "Export files: deleted when their download link expires.",
        "Sign-in codes: expire five minutes after they are sent.",
        "Requests waiting for a paired Claude Code computer: expire if not picked up within two minutes.",
        "Waitlist entries: kept until you ask us to remove yours.",
        "Copies in our database company's short-term backups: replaced as those backups roll over.",
      ],
    },
    {
      id: "deleting",
      heading: "Leaving, and deleting an account or a team",
      paragraphs: [
        "When a member leaves or is removed, they lose access to that team's space right away. What they added to the team's shared work, such as scouting entries, logged hours, tasks, and messages in the team channel, stays with the team, because it is the team's record. A season's scouting should not vanish because a senior graduated. Their own account and profile stay with them.",
        "Deleting your account. There is no delete button yet, so write to " +
          CONTACT +
          " from the email on your account. We will confirm it is you, then delete your account, your profile, your settings, your private AI chats and memory, and any personal key. We will tell you exactly what stays with a team and why, and a team's owners can remove those records too.",
        "Deleting a team. An owner can ask us at " +
          CONTACT +
          " with the team number. Export first: deleting a team removes all of its records from our database, and we delete its backup copy too. This cannot be undone.",
      ],
    },
    {
      id: "device-storage",
      heading: "Cookies, and what is stored on your own device",
      paragraphs: [
        "Competition venues have terrible Wi-Fi, so parts of Vantage keep a copy of data in your browser so they keep working offline.",
        "This data sits in your browser's storage on that device. That matters most on a shared laptop or tablet in the shop or pit: the next person to use that browser could see the saved copy. Signing out does not wipe it. To clear it, clear site data for Vantage in your browser settings (in Chrome: Settings → Privacy → Site settings → the Vantage site → Delete data).",
        "Some personal settings never leave the device either. The command palette remembers the few places you opened most recently, the team picker remembers teams you switched to, the dashboard remembers how you arranged it, the sign-in page can remember which account you used, and scouting keeps an autosaved draft. These live in your browser on that device and are not sent to us or synced between your devices, so a different browser starts fresh.",
        "We use only necessary cookies, and they are not part of the analytics choice described in the next section. A necessary cookie is one the product cannot work without, or one that exists only so we can honour a \"no\". Here is each one:",
        "We do not use advertising cookies, session replay, or fingerprinting. That is true whether or not you turn analytics on.",
      ],
      list: [
        "Sign-in cookies keep you signed in.",
        "If your team uses two-step sign-in, one cookie remembers this device so you are not asked for a code every time.",
        "One remembers which team you last opened, so links take you back to it.",
        "Two remember your light or dark theme.",
        "One remembers the answer you gave about analytics.",
        "Offline copies: scouting keeps a queue of entries until they upload (entries can also move between devices by QR code), the hours kiosk keeps sign-ins while the network is down, and the calendar, tasks, logistics, and My Day keep the last data they loaded.",
      ],
    },
    {
      id: "analytics",
      heading: "Product analytics",
      paragraphs: [
        "Vantage can record which pages and features your account opens, so we can see what teams actually use. It is off until you turn it on.",
        "We ask once, and the decline button is the same size as the accept button. Choosing \"only necessary cookies\" leaves every part of Vantage working exactly as it did. Nothing is locked, slowed, or nagged about afterwards.",
        "These events are linked to your account, not anonymous. Each one is stored with your account and your team, inside your team's own records, behind the same protections as the rest of your team's data. Your team's owners and admins can read your team's events; other members cannot. No advertising network, analytics company, data broker, or other outside company receives them. (Plausible, described above, is separate: when turned on, it counts page views without cookies and without knowing who you are.)",
        "How long we keep them. Raw events are deleted once they are 180 days old. A team's owners and admins can clear their team's history sooner.",
        "Changing your mind. Your answer is stored in a cookie in the browser you answered in, so a different browser or computer will ask again. To change it, come back to this section of this page (opening it reopens the chooser) and pick the other answer. Turning analytics off stops collection at once; ask us at " +
          CONTACT +
          " if you also want the events already recorded about you deleted.",
        "What an event never contains. These are not settings we could quietly flip, because the columns do not exist in the table: no IP address, no location of any kind, no browser name, no device fingerprint, nothing you typed anywhere in the product (not a search, not a chat message, not a scouting note, not an AI prompt), no screen or session recording, and nothing about what you do on other websites. Any web server has to see a network address to answer a request; it is not written into these records.",
        "Here is everything one event does contain:",
      ],
      list: [
        "Which kind of event it was, from a fixed list the database enforces: a page view, opening a feature, an action inside a feature, running a search, starting an export, using an AI feature, finishing an onboarding step, or reaching a screen that said something still needs setting up.",
        "The shape of the page address, such as \"/scouting\" or \"/team/:id/hours\". Anything after a question mark is dropped and ID-shaped parts are replaced with \":id\" in your browser, before the event is sent, so a record ID or search term cannot travel inside it.",
        "Your account id and your team id.",
        "The time it happened.",
        "Whether the screen was phone-sized, tablet-sized, or desktop-sized. That is all we record about your device.",
        "A few short labels, such as which feature and which action, limited in length and shape so free text cannot get in.",
      ],
    },
    {
      id: "children",
      heading: "Students under 13, and parental consent",
      paragraphs: [
        "FRC teams include middle-school students, so some members are under 13. We ask for date of birth during onboarding, so we know when that is the case.",
        "Children cannot join Vantage on their own. Access is closed: we set up each team and its owner, and the team's owners and admins invite specific email addresses. A student cannot create a team, and cannot join one without an invitation from an adult who runs it.",
        "Where a member is under 13, the team, through its coach or lead mentors acting for the school or organization that runs it, is responsible for getting any parental consent the law requires before inviting that student, and for keeping the record of it. A parent or guardian can ask the team to remove their child at any time, which ends the child's access.",
        "A parent or guardian can also ask us directly to see what Vantage holds about their child, to correct it, to delete it, or to stop any further collection. Write to " +
          CONTACT +
          ". We will confirm you are the parent or guardian, work with the team, and act on it. If we learn that a child under 13 is using Vantage without their team's permission, we will remove the account.",
        "We do not use a student's information to advertise to them. We do not sell personal information, and we do not build advertising profiles. There is no advertising in Vantage.",
      ],
    },
    {
      id: "guardians",
      heading: "Parents and guardians",
      paragraphs: [
        "A team can send a parent or guardian a private link that shows upcoming team events and their own student's RSVP. That link works like a password, so do not forward it.",
        "The parent view shows very little on purpose: the team name and number, upcoming events, and the linked student's own RSVP. It does not show other students' names, contact details, grades, notes, or anything a mentor wrote. A guardian holding one of these links does not get an account and cannot see the rest of the team.",
        "A team can turn a parent link off at any time, and it stops working immediately. Teams can also email families using the parent contacts they enter, and a parent can unsubscribe from those emails.",
      ],
    },
    {
      id: "your-rights",
      heading: "Seeing, correcting, exporting, and deleting your information",
      paragraphs: [
        "You can see and change your own profile in Vantage at any time, and you can change or turn off every kind of email in your notification settings.",
        "Your team can export its data at any time from Exports. You get a ZIP file of spreadsheet (CSV) files covering the team's main records: scouting, pick lists, research, money records, grant and sponsor drafts, CAD jobs, AI chats and memory, AI usage, and who is on the team. A member's private export holds only their own AI chats and memory. Many lists in Vantage also have their own download button. AI keys, passwords, sign-in codes, and other secrets are never in an export.",
        "For anything else, write to " +
          CONTACT +
          ". You can ask for a copy of what we hold about you, ask us to correct it, or ask us to delete it. We will confirm you are who you say you are before acting, because handing your data to someone else would itself be a privacy failure. Where the data is your team's record rather than yours alone, we will say so and involve your team's owner. We keep what the law requires us to keep, for as long as it requires.",
        "Vantage is not a medical or health service and makes no HIPAA claims. Do not put health information into it.",
      ],
    },
    {
      id: "security",
      heading: "How we protect data",
      paragraphs: [
        "Here is what Vantage actually does, and where it stops:",
        "No system is perfectly secure, and we do not promise that ours is. Keep your sign-in to yourself, and tell us if something looks wrong.",
      ],
      list: [
        "Everything travels over encrypted connections (HTTPS).",
        "The database itself separates teams: each request runs as the signed-in person, and team rules are checked on every read and write.",
        "AI keys, and the sign-in tokens for spreadsheet connections, are encrypted with a separate key service before they are stored.",
        "Passwords are stored only as a one-way scramble. Sign-in codes expire after five minutes, and repeated attempts are limited.",
        "Teams can require two-step sign-in, and sensitive admin actions are written to an audit log the team's owners and admins can read.",
      ],
    },
    {
      id: "security-incidents",
      heading: "If something goes wrong",
      paragraphs: [
        "If we find that personal information was exposed to someone who should not have seen it, we will investigate, fix it, and tell the affected teams' owners and admins without unreasonable delay, along with any notice the law requires. We will say what happened, what was affected, and what we are doing, not just offer a vague reassurance.",
        "If you think you have found a security problem, write to " +
          CONTACT +
          ". We will not pursue you for reporting something you found in good faith and did not exploit.",
      ],
    },
    {
      id: "legal-requests",
      heading: "Legal requests",
      paragraphs: [
        "We will hand over information only when the law requires it: a valid subpoena, court order, warrant, or equivalent legal process. We check that a request is valid and read it as narrowly as we reasonably can.",
        "Where we are allowed to tell the affected team that a request was made, we will, so they can respond themselves.",
      ],
    },
    {
      id: "schools",
      heading: "School-affiliated teams",
      paragraphs: [
        "Many FRC teams are run by a school. Where a school runs a team's use of Vantage, the school decides what is collected and why, and we handle that information for the school under this policy and our Terms.",
        "A US school that needs student records used only for the school's own purposes, as FERPA expects of a school's service providers, should have a team owner or admin turn model training off (Team → AI keys → Model training), and write to " +
          CONTACT +
          " for a written student-data agreement. We will put one in place.",
      ],
    },
    {
      id: "contact",
      heading: "Changes and questions",
      paragraphs: [
        "When we change this policy in a way that matters, we give it a new version and date, and Vantage asks every member to read and accept it once, the next time they open the app.",
        "For any privacy question, yours or your team's, write to " + CONTACT + ".",
      ],
    },
  ],
};

/* -------------------------------------------------------------------- terms */

export const TERMS_OF_SERVICE: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary:
    "The rules for using Vantage: who can have an account, what teams and Vantage each owe, and what the product does and does not promise.",
  sections: [
    {
      id: "summary",
      heading: "The short version",
      paragraphs: ["A plain summary of these Terms. The full sections below are the ones that count."],
      list: [
        "Vantage is free, invite-only software for FRC teams: we set up each team and its owner, and the team invites its own members.",
        "Your team owns its content. We store and show it to run Vantage for you, and we never sell it. Unless your team turns it off, we may use activity from the AI features to train our own in-house models.",
        "Be decent: no harassment, no reaching into another team's data, no scraping. FIRST's Code of Conduct and your school's rules still apply.",
        "Only claim a team you are allowed to represent.",
        "AI can be wrong. Check it before you act on it. It runs only where your team chose: its own key, its own computer, or Claude Code on a paired computer.",
        "We work hard to keep Vantage running, but there is no uptime guarantee. Export anything your team cannot afford to lose.",
        "Members under 18 use Vantage with the permission of a parent, guardian, or the adult who runs their team.",
      ],
    },
    {
      id: "eligibility",
      heading: "Who can use Vantage",
      paragraphs: [
        "Vantage is invite-only. We set up a team and its owner; the owner and their admins invite specific email addresses. A waitlist entry, an invite request, or a team number does not by itself give you an account. By creating an account, accepting an invitation, or using Vantage, you agree to these Terms and to the Privacy Policy.",
        "Team owners and admins are responsible for who they let in. Inviting someone gives that person access to the team's space. Owners and admins should remove members who leave the program promptly, and keep every member's role accurate, because team settings, including the direct-message rules for adults and students, depend on roles being right.",
        "Keep your account details accurate and your sign-in secure. Do not share an account.",
      ],
    },
    {
      id: "team-workspaces",
      heading: "Team spaces and who controls them",
      paragraphs: [
        "Your team owns its content: scouting, messages, hours, documents, tasks, CAD records, and money records belong to the team. You give us permission to store, process, and show that content to run Vantage for your team, and, for activity that goes through Vantage's AI features, to use the prompts, context, answers, and agent steps to train, fine-tune, and test our own in-house models, as the Privacy Policy describes, unless your team has turned model training off. We do not sell your content.",
        "A member's content stays with the team. When someone leaves, they lose access, but what they added stays part of the team's record.",
        "Your team's records are kept apart from every other team's inside the database, so another team cannot open your team in Vantage. No system is perfectly secure, and we do not promise that ours is.",
        "What owners and admins can do:",
      ],
      list: [
        "Invite and remove members and change their roles.",
        "Send a member a password-reset email. They never set anyone's password themselves; only the person who controls that mailbox can finish the reset, and finishing it signs that member out everywhere else.",
        "Export the team's data.",
        "Set the team's direct-message rules, and run an audited export of one named member's direct messages. A written reason is required, and an audit record is written before any messages are returned.",
        "Change team settings, including AI keys, AI limits, model training, and share links.",
      ],
    },
    /*
      Added 2026-09-22 with the authorization statement on /claim
      (apps/web/lib/claim/attestation.ts, migration 0672). Every statement below
      is checked against that code: the claim route refuses a claim without the
      statement, stores its exact words and version, and stores only a one-way
      hash of the network address (anonymizeIp), never the address itself.
    */
    {
      id: "team-identities",
      heading: "Team identities and team numbers",
      paragraphs: [
        "When you submit or claim an FRC team number on Vantage, you represent that you are a current member, mentor, coach, or other person authorized by that team. Claiming a number that is not yet on Vantage goes further: you represent that you are authorized to act on the team's behalf and to use its name and number here.",
        "Do not claim, register, reserve, or impersonate a team you are not authorized to represent. That includes holding a number for later, keeping another team off Vantage, and presenting yourself as a team you do not belong to. It applies to team names as well as numbers.",
        "When you claim a team, you confirm a written statement that you are authorized to register it. We keep a record of that statement with the team: its exact words and version, your account, the team number, the time, and a one-way hash of the network address the request came from, not the address itself. The team's owners and admins, and Vantage's platform administrators, can see it.",
        "If a team's authorized representatives, for example its lead mentor or coach, make a credible claim that a workspace was registered without the team's authorization, we may suspend the workspace, transfer its ownership to the team's representatives, or remove it. Where it is practical, we will ask the current owner for their side first. Where a claim involves impersonation or a risk to students, we may act first and explain afterwards. To report a team claimed without authorization, write to " +
          CONTACT +
          " with the team number, or use the report link on the claim page.",
        "FIRST® and FIRST® Robotics Competition (FRC) are trademarks of FIRST (For Inspiration and Recognition of Science and Technology). Team names, numbers, and logos belong to their teams or other owners. Vantage is an independent product. It is not affiliated with, sponsored by, or endorsed by FIRST, and a team's name or number appearing on Vantage does not imply any affiliation with FIRST or endorsement by that team.",
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      paragraphs: [
        "Your whole team relies on Vantage. Use it the way you would want others to use it about you.",
        "FIRST's own rules still apply. Nothing here replaces FIRST's Code of Conduct, its youth-protection rules, or your school or district's policies. Those sit on top of these Terms, and where they are stricter, they win.",
        "We can suspend an account or a team that breaks these rules.",
      ],
      list: [
        "No harassment, bullying, threats, sexual content, or targeting anyone. This covers chat, scouting notes, AI prompts, and anything else you can type into Vantage.",
        "Do not share another team's private information, and do not post someone's personal details without their permission.",
        "Do not try to reach another team's data, look for a way around the separation between teams, or use someone else's account.",
        "No scraping, bulk copying, or reselling of data from Vantage, and no reverse-engineering the service.",
        "Do not use the AI features to cheat on schoolwork. Handing in AI-written work as your own, where your school does not allow it, breaks these Terms as well as your school's rules.",
        "Do not upload malware, try to disrupt the service, or get around rate limits or access controls.",
        "Do not put health information, government ID numbers, or passwords for other services into Vantage. It is not built to hold them.",
        "Follow The Blue Alliance's and Statbotics' terms when you use the public data Vantage shows from them.",
      ],
    },
    {
      id: "ai",
      heading: "AI features",
      paragraphs: [
        "AI output can be wrong. Check it before you act on it, especially for scouting conclusions, match strategy, CAD and code, budgets, and anything to do with safety. Never cut, machine, wire, or deploy something only because an AI suggested it. Treat AI output as a first draft from a fast helper who was not at your event.",
        "Vantage does not invent your team's data. When a feature has no real data to work from, it shows a setup or empty state instead of a plausible-looking number. If you ever see a number you cannot trace back to your own entries or to public FRC data, tell us.",
        "AI is off until an owner or admin turns it on under Team → AI keys. It then runs only where your team chose: the team's own key (or a member's personal key) with an AI company, a model on the team's own computer or server, or Claude Code on a computer a mentor paired. Vantage-sponsored free AI is offered only to a team Vantage invites to a sponsored promotion, for as long as that promotion runs, and can end when it does.",
        "Your team sets its own limits: daily and monthly spending caps, text caps, which models are allowed, warning levels, and an off switch. When a limit is reached, the call is refused with an explanation.",
        "If your team or a member brings their own AI key, or a mentor pairs a computer that uses their own AI plan, that person or team is responsible for that account, its charges, its usage limits, and its terms. We use a key only for requests your team makes, and we store it encrypted.",
      ],
    },
    {
      id: "billing",
      heading: "Cost",
      paragraphs: [
        "Vantage is free. Every team gets every feature, and there is nothing to buy.",
        "If your team uses its own AI key, that company bills your team directly under its own terms; Vantage adds no charge and no markup.",
        "If Vantage ever offers something paid, owners will be told well before, nothing will be charged unless an owner chooses it, and these Terms will be updated first.",
      ],
    },
    {
      id: "availability",
      heading: "Availability and changes to the service",
      paragraphs: [
        "We work to keep Vantage running, but we do not promise it will be uninterrupted or error-free, and we do not offer an uptime guarantee. Do not make Vantage the only copy of something your team cannot afford to lose; export regularly.",
        "Some features need setup before they work (CAD connections, GitHub, phone checks, AI keys, spreadsheet connections). Until they are set up, those features say what is missing instead of working. Some features can also be paused; photo and video uploads are paused right now.",
        "Features can change, be added, or be removed. If we remove something a team depends on, we will give notice where we reasonably can and make sure the data can be exported.",
      ],
    },
    {
      id: "who-owns-what",
      heading: "Who owns what",
      paragraphs: [
        "Your team owns its data. Scouting, match notes, documents, CAD links, hours, budgets, and chat are the team's work, and using Vantage does not transfer them to us. We hold them to run the service for you.",
        "We do not sell your data, we do not license it to anyone else, and we do not use one team's data to give another team an advantage. Overall operating numbers we use to keep the service running, such as error rates, load, and how often features are used, are not team data and never reveal a team's strategy.",
        "Vantage itself, including the software, the design, and the name, stays ours.",
        "Team owners can export their data and ask us to delete the team when they are done.",
      ],
    },
    {
      id: "members-under-18",
      heading: "Members under 18",
      paragraphs: [
        "Most people using Vantage are high-school students, and some are younger. Accounts are created by invitation from a team's owners or admins; a student cannot sign themselves up.",
        "If you are under 18, a parent, guardian, or the adult who runs your team must agree to these Terms for you. By inviting a student, the team confirms it has whatever permission its school or organization requires, including parental consent for a student under 13.",
        "What Vantage enforces: invitations only, a second adult by default in direct messages between an adult and a student, and a private date of birth. What it cannot promise: that every adult on a team behaves well. That remains the job of the team's leaders and FIRST's youth-protection rules.",
        "A parent, guardian, or coach can have a student removed from a team at any time by asking the team's owners or admins, or by writing to " +
          CONTACT +
          ".",
      ],
    },
    {
      id: "termination",
      heading: "Suspension and ending your use",
      paragraphs: [
        "You can stop using Vantage at any time and ask us to delete your account. A team owner can export the team's data and ask us to delete the team.",
        "We can suspend or end access for a breach of these Terms, for a security risk, or where the law requires it. Where a serious safety or security issue is involved, we may act immediately and explain afterwards. If we end a team's access for any other reason, we will first give the owner a reasonable chance to export the team's data.",
      ],
    },
    {
      id: "liability",
      heading: "Warranties and liability",
      paragraphs: [
        "To the extent the law allows, Vantage is provided \"as is\" and \"as available\", without warranties of any kind, including that it is fit for a particular purpose or that AI output is correct.",
        "To the extent the law allows, we are not liable for indirect or consequential losses, such as lost matches, lost data you did not export, or decisions made from AI output, and our total liability is limited to what you paid us in the twelve months before the claim. Vantage is free, so for most teams that is nothing. Some places do not allow these limits; there, they apply only as far as the law permits.",
      ],
    },
    /*
      The governing law and venue are a decision for the operator and their
      counsel, not something this document should invent. So the section states
      the true position today and says what will happen when that changes.
    */
    {
      id: "governing-law",
      heading: "Governing law and disputes",
      paragraphs: [
        "We have not yet designated a governing law or a venue for disputes. That is a deliberate blank: naming one before it has been settled with a lawyer would tell you something we cannot stand behind.",
        "Until it is settled, nothing here asks you to give up a right you already have. Your local consumer-protection law, and any mandatory rights it gives you, apply in full, including the right to bring a claim wherever your law lets you. We will not argue that this section moved your dispute somewhere else.",
        "When a governing law and venue are set, they will be stated here, and because that is a material change, the version will change and every member will be asked to accept it.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to these documents",
      paragraphs: [
        "These Terms and the Privacy Policy share one version number and date, shown at the top of each.",
        "When we make a change that matters, we give both documents a new version, and Vantage asks every member to read and accept it once, the next time they open the app. Small fixes that take nothing away from you, such as clearer wording, may be made without asking again.",
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
