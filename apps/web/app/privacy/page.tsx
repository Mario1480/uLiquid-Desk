import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { withLocalePath } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

export default async function PrivacyPage() {
  const locale = await resolveRequestLocale();

  return (
    <main className="legalPage">
      <header className="legalPageHeader">
        <h1>uLiquid Privacy Policy</h1>
        <div className="legalPageMeta">Last updated: September 8, 2026. Version 2026-09-08.</div>
      </header>

      <DeskSurface><section className="card legalPageSection">
        <h2>1. Scope</h2>
        <p>
          This Privacy Policy explains how uLiquid collects, uses, stores, and protects information when you use uLiquid
          Desk, uLiquid software, websites, dashboards, APIs, wallet and exchange integrations, notifications, and
          related services.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>2. Information We Collect</h2>
        <ul>
          <li>Account information, such as email address, authentication status, role, workspace membership, and support communications.</li>
          <li>Security and audit information, such as login events, sessions, IP address, user agent, device and browser metadata, admin actions, and legal acknowledgements.</li>
          <li>Wallet and exchange-related information you choose to connect, such as public wallet addresses, exchange account labels, permissions, balances, positions, orders, transfers, and execution events returned by third-party services.</li>
          <li>Product usage information, such as bot settings, strategy configuration, alerts, preferences, dashboard layout, logs, diagnostics, feature usage, and error reports.</li>
          <li>Billing or subscription information if paid features are enabled, such as plan status, order metadata, payment-provider references, and invoice or transaction status.</li>
        </ul>
        <p>
          uLiquid does not ask for private keys or seed phrases. Do not enter private keys or seed phrases into uLiquid.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>3. How We Use Information</h2>
        <ul>
          <li>To provide, operate, secure, troubleshoot, and improve uLiquid.</li>
          <li>To authenticate users, maintain sessions, enforce permissions, prevent abuse, and investigate security events.</li>
          <li>To run user-requested product features, including bots, alerts, exchange synchronization, wallet views, notifications, billing, and admin tools.</li>
          <li>To maintain records of legal acknowledgements, operational events, audit logs, support requests, and compliance-relevant activity.</li>
        </ul>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>4. Cookies and Local Storage</h2>
        <p>
          uLiquid may use cookies, local storage, and similar technologies for authentication, CSRF protection, locale
          preferences, product settings, security, and diagnostics. Disabling these technologies may prevent parts of
          the product from working.
        </p>
        <p>
          The current first-party inventory and retention details are listed in the{" "}
          <Link href={withLocalePath("/cookies", locale)}>Cookie and Storage Information</Link>.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>5. Sharing</h2>
        <p>
          uLiquid may share information with service providers that help operate the product, such as hosting,
          infrastructure, email, notifications, analytics, logging, payment, and security providers. uLiquid may also
          disclose information when required by law, to protect rights and security, to prevent abuse, or as part of a
          corporate transaction.
        </p>
        <p>
          Third-party wallets, exchanges, blockchains, bridges, payment providers, and data providers process information
          under their own terms and privacy policies.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>6. Security and Retention</h2>
        <p>
          uLiquid uses technical and organizational safeguards designed to protect information, including access controls,
          encryption where appropriate, audit logs, and operational monitoring. No system is perfectly secure. uLiquid
          retains information for as long as needed to provide the product, maintain security, resolve disputes, comply
          with legal obligations, and preserve auditability.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>7. Your Choices</h2>
        <p>
          You may request access, correction, export, or deletion of personal information where required by applicable
          law. Some records may be retained where necessary for security, legal, audit, fraud-prevention, or operational
          reasons.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection" id="beta-access">
        <h2>8. Beta access applications</h2>
        <p>
          When public registration is closed, you may request beta access if applications are open. We process your
          email address, short test motivation (up to 1,000 characters), selected language, application status,
          verification and review timestamps, and email delivery results. Please do not include financial account
          details, credentials or sensitive personal information in your motivation.
        </p>
        <p>
          This information is used to assess your request and send necessary confirmation and invitation emails.
          Applying does not create an account, subscribe you to a newsletter or accept a product contract.
          Only platform superadmins review confirmed applications. A successful application requires a separate
          invitation and registration, including acknowledgement of the applicable Terms, Privacy Policy and Risk Disclosure.
        </p>
        <p>
          Where the GDPR applies, we process the requested application and related communications to take steps
          at your request before entering into a contract (Article 6(1)(b)). Abuse prevention and access-decision
          audit records are based on our legitimate interests in securing the service and controlling beta access
          (Article 6(1)(f)). Providing the application details is voluntary, but we cannot process a request without them.
          Admission is reviewed by an administrator; automated security checks can block submission and do not grant admission.
        </p>
        <ul>
          <li>Unconfirmed applications: deleted seven days after submission.</li>
          <li>Rejected applications or revoked invitations: deleted 30 days after the review decision.</li>
          <li>Pending, deferred or invited applications: deleted 90 days after submission, except while an unused invitation is still valid.</li>
          <li>Completed applications: application data is deleted 30 days after account creation. Account data and legal acknowledgement records remain separate.</li>
        </ul>
        <p>
          Verification links expire after 24 hours and invitations after seven days. Tokens are stored as hashes,
          not readable links. Expired token records are removed after seven further days. Scheduled deletion can
          be delayed by service downtime; these periods describe the operational application database, not instant
          erasure of separately retained backups or audit records. Audit entries omit motivation text and tokens.
          Hosting and email providers process data needed to operate this workflow.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection" id="turnstile">
        <h2>9. Cloudflare Turnstile and abuse prevention</h2>
        <p>
          We use Cloudflare Turnstile, provided by Cloudflare, Inc., on beta application, registration,
          confirmation-resend, password-reset-request, and risk-triggered email/password sign-in forms.
          Loading the widget connects your browser to Cloudflare. Cloudflare processes technical signals such as
          IP address, TLS fingerprint, user-agent information and the site origin to distinguish visitors from bots.
          We validate the resulting token server-side before accepting a submission. Our legitimate interest is
          protecting the service and preventing unsolicited email (Article 6(1)(f) GDPR, where applicable).
        </p>
        <p>
          Cloudflare acts as a processor for website protection and as a controller for improving its bot-detection
          capabilities. Its global processing may involve countries outside the EEA, including the United States.
          Information about its processing, international transfers and safeguards is available in the{" "}
          <a href="https://www.cloudflare.com/turnstile-privacy-policy/" rel="noopener noreferrer">Turnstile Privacy Addendum</a>{" "}
          and <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener noreferrer">Cloudflare Privacy Policy</a>.
          Our application retention periods do not determine Cloudflare&apos;s retention periods.
        </p>
        <p>
          Turnstile is not loaded for verification-code entry, invitation redemption, or wallet sign-in. On
          email/password sign-in it is loaded only after repeated failed attempts. Pre-clearance is disabled for
          this widget. We also use a honeypot and temporary rate-limit counters keyed by hashed IP addresses or
          email addresses; these counters expire within 24 hours. These measures do not subscribe you to marketing.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>10. Privacy contact and requests</h2>
        <p>
          Contact the uLiquid operator at <a href="mailto:privacy@uliquid.vip">privacy@uliquid.vip</a>{" "}
          or <a href="mailto:support@uliquid.vip">support@uliquid.vip</a> to withdraw an application or request access,
          correction, deletion, restriction or portability where applicable. You may object to processing based on
          legitimate interests on grounds relating to your situation. You may also complain to a competent data
          protection supervisory authority. We may need to verify your identity before acting on a request.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>11. Related Terms</h2>
        <p>
          This policy should be read together with the <Link href={withLocalePath("/terms", locale)}>Terms of Use</Link>{" "}
          and <Link href={withLocalePath("/risk-disclosure", locale)}>Crypto Risk Disclosure</Link>.
        </p>
      </section></DeskSurface>
    </main>
  );
}
