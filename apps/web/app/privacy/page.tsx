import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE } from "../../lib/legal";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Privacy Policy — Vantage",
  description:
    "How Vantage handles account, organization, scouting, and AI data for FRC teams. Invite-only workspaces; no sale of student data for ads.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="marketing-site marketing-lux legal-page">
      <SiteHeader />
      <main className="legal-content">
        <p className="legal-kicker">LEGAL</p>
        <h1>Privacy Policy — Vantage</h1>
        <p className="legal-meta">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {LEGAL_DOC_VERSION}
        </p>
        <p>This Policy explains how Vantage handles information for FRC teams, their members, and site visitors.</p>
        <h2>Information we collect</h2>
        <ul>
          <li>Account and onboarding details, including name, email, age-related onboarding information, role, and team number.</li>
          <li>Organization content and operational data that authorized users add, such as scouting, schedules, documents, messages, and settings.</li>
          <li>Technical information needed to secure and operate sessions, including authentication/session data, IP-derived security signals, and service logs.</li>
          <li>Waitlist contact information and optional affirmative SMS consent.</li>
        </ul>
        <h2>How we use information</h2>
        <p>
          We use information to authenticate users, provide organization-scoped features, operate and secure the
          service, support teams, enforce plans and AI usage limits, and meet legal obligations. We do not sell
          student data or use it for targeted advertising.
        </p>
        <h2>Workspace separation and providers</h2>
        <p>
          Vantage is multi-tenant: organization data is separated using application permissions and row-level
          security controls. We use Neon-hosted Postgres and other service providers to deliver the product, and they
          process data only as needed to provide their services. Security measures reduce risk but cannot guarantee
          absolute security.
        </p>
        <h2>AI and bring-your-own keys</h2>
        <p>
          When an authorized user requests AI, relevant prompts and necessary context may be sent to the selected
          model provider. AI use is metered for the organization. BYOK credentials are encrypted and used only for the
          configured integration; the provider&apos;s terms and privacy practices also apply.
        </p>
        <h2>Scouting voice notes</h2>
        <p>
          Optional scouting voice notes are off by default. An organization owner or admin and each scout must
          separately opt in and accept privacy consent before recording. Transcripts are stored as notes attached to a
          scout entry and do not fill structured form fields. When cloud speech-to-text is used, audio may be sent to a
          configured STT provider and is metered as AI usage. Browser speech recognition, when used, produces the
          transcript on-device. Only enable voice notes when people who may be recorded have consented.
        </p>
        <h2>Cookies and sessions</h2>
        <p>
          We use necessary cookies and session mechanisms to sign users in, maintain security, and remember essential
          preferences. We do not use session replay, fingerprinting, or advertising cookies to build cross-site
          behavioral profiles.
        </p>
        <h2>Closed access and retention</h2>
        <p>
          Vantage access is limited to approved accounts. We retain information while an account or workspace is active
          and afterward only as needed for legitimate operational, security, legal, or dispute-resolution purposes.
          Waitlist entries are retained for launch follow-up until removal is requested.
        </p>
        <h2>Your choices</h2>
        <p>
          You may request access, correction, deletion, or export of personal information, subject to applicable law
          and a team&apos;s role in the data. Contact{" "}
          <a href="mailto:privacy@vantagefrc.com">privacy@vantagefrc.com</a>. Vantage is not a HIPAA service and makes
          no HIPAA compliance claims.
        </p>
        <h2>Updates</h2>
        <p>
          We may update this Policy as Vantage changes. Material changes will have a new effective date or version, and
          may require a new acceptance.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
