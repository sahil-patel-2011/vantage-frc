/** Shared policy content. Disclosures must match the released service. */
export const LEGAL_LAST_UPDATED = "October 1, 2026";
export const LEGAL_CONTACT_EMAIL = "vantagefrc@gmail.com";
export type LegalSection = { id: string; heading: string; paragraphs: string[]; list?: string[] };
export type LegalDocument = { slug: "privacy" | "terms"; title: string; summary: string; sections: LegalSection[] };
const CONTACT = LEGAL_CONTACT_EMAIL;
const section = (id: string, heading: string, paragraphs: string[], list?: string[]): LegalSection =>
  ({ id, heading, paragraphs, ...(list ? { list } : {}) });

export const PRIVACY_POLICY: LegalDocument = {
  slug: "privacy", title: "Privacy Policy", summary: "How Vantage collects, uses, shares, and protects your information.",
  sections: [
    section("summary", "Overview", [
      "This policy applies to Vantage's website, scouting app, and connected tools. Vantage helps FRC teams manage scouting, teamwork, and their season.",
      "We do not sell personal information or use it for targeted advertising. Roles control access to shared team records. Some records, including private AI conversations, are personal.",
      "We may use Vantage AI activity to train and improve in-house models unless your team disables model training. The AI section explains this choice.",
    ]),
    section("who-we-are", "About Vantage", [
      `Vantage is independent of FIRST and is not endorsed by FIRST. Contact us at ${CONTACT}.`,
      "Team owners and administrators manage membership, permissions, and settings. Vantage operates the service and processes information needed to provide it.",
    ]),
    section("what-we-collect", "Information we collect", ["We collect information you provide, service records, and technical information needed to operate Vantage:"], [
      "Account details: name, email, sign-in identifiers, profile, date of birth for eligibility, optional gender, and verified contact details. Passwords are hashed, not stored in plain text.",
      "Team records: scouting, messages, tasks, hours, attendance, calendars, travel, forms, parent contacts, documents, CAD/code records, expenses, sponsors, and grants.",
      "AI records: requests, selected context, responses, memory, permitted tool activity, and usage. Enabled voice transcription sends audio to the selected provider.",
      "Technical records: session IP addresses and browser details, security events, connected devices, notification subscriptions, and consent settings.",
      "Waitlist details: email, team number, optional phone, and contact permissions.",
      "Vantage does not accept photo or video uploads. External match-video links and notes are supported. Existing uploaded records may remain available.",
    ]),
    section("who-can-see", "Access and sharing", [
      "Team records are separated by team and protected by permissions. Members access shared records according to their roles. Ordinary team access does not reveal your date of birth, gender, personal keys, private AI conversations, or private files.",
      "Scouting sharing is enabled by default. Past and new structured match observations are available to other signed-in Vantage teams, identified by the contributing team. Scout identities, free text, private notes, and action histories are excluded. A team owner or admin can turn sharing off from Scouting; this stops further access through the shared scouting service but cannot recall copies already saved by recipients. Public forms, display boards, and share links expose their designated information to people who can access the link.",
      "Authorized operators may access underlying records for maintenance, support, security, abuse investigation, and legal obligations. Personal privacy inside the product does not prevent necessary operator access to infrastructure.",
    ]),
    section("messages", "Messages", [
      "Team channels are visible to their members. Adult–student messages include a second adult by default; administrators can change that setting.",
      "Owners and administrators may export a named member's direct messages with a recorded reason. Exports are audited and may include deleted messages. Otherwise, administrators do not have ordinary access to conversations they are not part of.",
      "Messages remain team records until the applicable deletion process. We do not scan them for advertising or build advertising profiles.",
    ]),
    section("ai", "AI services and model training", [
      "Requests include your question, Vantage instructions, and information needed for the feature. When team AI is disabled, nothing is sent to any AI company for a team feature.",
      "Requests can use your team's own key, your personal key, an own computer or server such as Ollama, or your personal Codex or Claude Code on a paired computer. Personal connections serve only their owner. Each provider's terms apply.",
      "A team invited to a sponsored promotion may use the providers included in that promotion. Public volunteer AI networks are off.",
      "Unless your team opts out, Vantage may use AI prompts, context, responses, and agent activity to train, fine-tune, and evaluate in-house models. This includes personal connections used inside Vantage; unrelated terminal conversations are not collected.",
      "Owners and administrators can disable Model training in Team → AI settings. The choice takes effect when saved. Activity created while training is off remains excluded if it is enabled later. Turning training off also excludes earlier activity from future training selection. Withdrawal cannot undo completed training. Contact us about deletion of retained information.",
      "Stored AI credentials are encrypted and excluded from ordinary exports. Local Codex login credentials stay on your computer. Usage records support limits and troubleshooting. Providers may cache repeated content according to their terms and selected settings.",
      "Enabled scheduled summaries use team activity to create shared memory. AI output can be inaccurate; check important results before acting.",
    ]),
    section("third-parties", "Service providers", ["Providers receive information needed to supply their services:"], [
      "Vercel hosts the app; PostgreSQL hosting stores application records. Operator-owned Google Drive and Sheets hold separate team workbooks and recovery copies, including encrypted sensitive recovery data. Direct access is not automatically granted to teams.",
      "Google sign-in confirms identity. Configured email providers deliver codes and invitations. Browser notification services deliver enabled notifications.",
      "Selected AI providers receive context for requested features. Connected Onshape, Fusion, GitHub, spreadsheet, calendar, and communication services receive information needed for authorized connections.",
      "Configured document-storage providers hold supported documents and CAD artifacts. Photo/video storage is not offered. Payment providers process applicable payments under their own terms.",
      "Plausible analytics, when configured, may run on service pages. Vantage product analytics have separate consent controls below.",
      "Vercel Web Analytics supplies optional traffic summaries under the analytics choice described below.",
    ]),
    section("retention", "Storage and retention", [
      "We retain account and team records to provide the service. Security, legal, and dispute requirements may require additional retention. Providers may process information outside your country.",
      "Readable Google workbooks reflect current records. Protected recovery copies preserve database records and changes. Recovery snapshots expire within 28 days. Restores must apply deletion records before reopening access.",
      "Raw product analytics expire after 180 days. Temporary exports expire with their download links. Contact us about a specific record or retention requirement.",
    ]),
    section("deleting", "Account and team deletion", [
      `Use available account deletion controls or contact ${CONTACT}. We verify your identity before acting. Authorized team owners may export and delete a team workspace.`,
      "Account deletion removes personal information, settings, personal keys, and private AI records and revokes access. Team-owned work may remain with the team, with attribution removed where appropriate.",
      "Deletion propagates to current copies. Protected records may remain in expiring backups for up to 28 days, subject to legal requirements. Restores must not reactivate deleted accounts or expose deleted content.",
    ]),
    section("device-storage", "Cookies and local storage", [
      "We use only necessary cookies to keep you signed in, support two-step sign-in, remember which team you last opened, and save your light or dark theme. A consent cookie remembers the answer you gave about analytics.",
      "We do not use advertising cookies, session replay, or fingerprinting, whether or not you turn analytics on.",
      "Your browser stores offline reports, cached views, and local preferences. The command palette remembers choices locally; they are not sent to us or synced between your devices. Clear site data before another person uses a shared browser.",
    ]),
    section("analytics", "Optional product analytics", [
      "Product analytics are off until you opt in. Declining means nothing is locked. Events include your account ID and team ID and are not anonymous.",
      "Events describe feature use, not a chat message or other content you type. They include no location of any kind, no device fingerprint, and no IP address. Raw events expire after 180 days.",
      "The same opt-in enables Vercel Web Analytics traffic summaries. These include page views, device and browser information, referral sources, and approximate country, region or city derived from the request. Vercel uses a temporary request hash to count visitors, discarded after 24 hours. We send route shapes without account or team IDs, query strings, fragments, search text, or invite tokens. No custom content events are sent to Vercel. Declining or withdrawing the analytics choice stops new collection.",
      "The analytics control on this page reopens the chooser. You may change your choice at any time. Administrators can clear team analytics; contact us about removal of previous personal events.",
    ]),
    section("children", "Age eligibility", [
      "Accounts are available to people age 13 and older. Children under 13 may not use Vantage accounts. Eligibility is checked during onboarding and before team access.",
      `Contact ${CONTACT} if you believe an account belongs to someone under 13. We review eligibility, restrict access where necessary, and address deletion requests without silently removing team records.`,
    ]),
    section("parents", "Parents and guardians", [`Contact your team or ${CONTACT} about a student's information or access. We verify authority before disclosing information or changing an account.`]),
    section("your-rights", "Your choices and rights", [
      `You can update your profile, request an export, and request correction or deletion. Contact ${CONTACT} for assistance. We verify identity and explain team-owned records or legal exceptions.`,
      "You may manage analytics, notifications, connections, and sharing. Rights provided by applicable privacy law remain available.",
    ]),
    section("security", "Security", ["We use access controls, encrypted connections, credential protection, and audit records. No service guarantees absolute security. Protect your account and report suspected unauthorized access."]),
    section("incidents", "Security incidents", ["We investigate incidents, take containment steps, and notify affected people or teams when required by law."]),
    section("legal-requests", "Legal disclosures", ["We may disclose information when legally required or necessary to protect the service, users, or others. We limit disclosure to relevant information."]),
    section("schools", "School-affiliated teams", [`Schools should review their requirements before using Vantage. Disable model training if records must serve only school purposes, and contact ${CONTACT} about any required agreement.`]),
    section("changes", "Updates and contact", [`We identify the effective version and notify users of material changes. Questions: ${CONTACT}.`]),
  ],
};

export const TERMS_OF_SERVICE: LegalDocument = {
  slug: "terms", title: "Terms of Service", summary: "The terms for using Vantage and managing a team workspace.",
  sections: [
    section("summary", "Agreement", ["By creating an account or using Vantage, you agree to these Terms and acknowledge the Privacy Policy. Vantage is an independent service for FRC teams."]),
    section("eligibility", "Eligibility and accounts", [
      "You must be age 13 or older. If under 18, use Vantage with permission from a parent, guardian, or authorized adult responsible for your team.",
      "Provide accurate information and protect your credentials. Use only authorized accounts and connections. Self-service signup is available when registration is enabled; joining a team requires its authorization.",
    ]),
    section("team-spaces", "Team administration and content", [
      "Owners and administrators manage membership, permissions, and settings. You must have authority to create or administer the team you represent.",
      "You and your team retain ownership of content. You authorize Vantage to host, process, back up, and display it to provide the service. Unless your team opts out, AI activity may train and evaluate our in-house models as explained in the Privacy Policy.",
      "Shared work may remain with a team after a member leaves. Administrators are responsible for appropriate sharing and workspace use.",
    ]),
    section("team-identities", "Team identities and team numbers", [
      "When creating a workspace, you confirm that you are a member, mentor, coach, or other person authorized by that team. Do not claim, register, reserve, or impersonate a team without its authorization. We may suspend the workspace, transfer its ownership, or remove it after investigating a dispute.",
      "We save your confirmation, account, time, and a one-way hash of the network address, not the address itself. A workspace is not official FIRST registration. Vantage is not affiliated with, sponsored by, or endorsed by FIRST.",
    ]),
    section("acceptable-use", "Acceptable use", ["Do not:"], [
      "Use Vantage unlawfully, harass or exploit others, or violate their rights.",
      "Access accounts or records without authorization, bypass safeguards, or expose credentials.",
      "Disrupt the service, distribute malicious code, or misuse automation.",
      "Upload photos or videos to Vantage storage. Supported external links, documents, and CAD artifacts remain subject to these Terms.",
    ]),
    section("ai", "AI and connected services", [
      "AI results may be inaccurate. Review outputs before robot operation, purchasing, safety decisions, or other important actions.",
      "You may connect your own Codex or Claude Code on a paired computer, provider key, or supported local service. Personal connections serve your requests. External providers have their own terms, availability, and charges.",
      "Connections do not expand your permissions. Changes remain subject to application permissions and applicable approvals.",
    ]),
    section("cost", "Pricing", ["Vantage is currently free. External providers may charge separately. We will disclose changes to Vantage pricing before they apply."]),
    section("availability", "Availability", ["We may maintain, update, or change the service. Networks, maintenance, and providers can affect availability. Keep exports of important records and use offline competition features where available."]),
    section("ownership", "Intellectual property", ["Content remains yours or your team's. Software, branding, and third-party materials remain subject to their applicable ownership and licenses."]),
    section("members-under-18", "Student accounts", ["Team leaders are responsible for supervision and permissions. Adult–student messages include a second adult by default; administrators control that setting. Vantage does not replace youth-protection procedures."]),
    section("termination", "Suspension and termination", [
      "You may stop using Vantage and request deletion. Authorized owners may export and delete team workspaces.",
      "We may restrict access for violations, security risks, disputed authority, or legal requirements. Where practical, we provide notice and an export opportunity. Urgent issues may require immediate action.",
    ]),
    section("liability", "Disclaimers and liability", [
      "To the extent permitted by law, Vantage is provided as is and as available, without warranties of merchantability, fitness for a particular purpose, or uninterrupted operation.",
      "To the extent permitted by law, we are not liable for indirect or consequential losses. Total liability is limited to amounts paid to Vantage in the twelve months before the claim. These limits do not apply where prohibited by law.",
    ]),
    section("governing-law", "Your legal rights", ["These Terms do not waive mandatory rights, including local consumer-protection law. No mandatory arbitration or exclusive dispute venue is imposed by these Terms."]),
    section("changes", "Changes", ["We identify effective versions, notify users of material changes, and request renewed acceptance where required. Minor wording corrections do not change your rights."]),
    section("contact", "Contact", [`Questions: ${CONTACT}.`]),
  ],
};
export const LEGAL_DOCUMENTS: LegalDocument[] = [PRIVACY_POLICY, TERMS_OF_SERVICE];
export function splitOnContactEmail(text: string): Array<{ kind: "text" | "email"; value: string }> {
  const out: Array<{ kind: "text" | "email"; value: string }> = [];
  text.split(LEGAL_CONTACT_EMAIL).forEach((part, index) => {
    if (index > 0) out.push({ kind: "email", value: LEGAL_CONTACT_EMAIL });
    if (part) out.push({ kind: "text", value: part });
  });
  return out;
}
