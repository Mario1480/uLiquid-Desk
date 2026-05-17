import Link from "next/link";
import { withLocalePath } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

export default async function PrivacyPage() {
  const locale = await resolveRequestLocale();

  return (
    <main className="legalPage">
      <header className="legalPageHeader">
        <h1>uLiquid Privacy Policy</h1>
        <div className="legalPageMeta">Last updated: May 17, 2026. Version 2026-05-17.</div>
      </header>

      <section className="card legalPageSection">
        <h2>1. Scope</h2>
        <p>
          This Privacy Policy explains how uLiquid collects, uses, stores, and protects information when you use uLiquid
          Desk, uLiquid software, websites, dashboards, APIs, wallet and exchange integrations, notifications, and
          related services.
        </p>
      </section>

      <section className="card legalPageSection">
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
      </section>

      <section className="card legalPageSection">
        <h2>3. How We Use Information</h2>
        <ul>
          <li>To provide, operate, secure, troubleshoot, and improve uLiquid.</li>
          <li>To authenticate users, maintain sessions, enforce permissions, prevent abuse, and investigate security events.</li>
          <li>To run user-requested product features, including bots, alerts, exchange synchronization, wallet views, notifications, billing, and admin tools.</li>
          <li>To maintain records of legal acknowledgements, operational events, audit logs, support requests, and compliance-relevant activity.</li>
        </ul>
      </section>

      <section className="card legalPageSection">
        <h2>4. Cookies and Local Storage</h2>
        <p>
          uLiquid may use cookies, local storage, and similar technologies for authentication, CSRF protection, locale
          preferences, product settings, security, and diagnostics. Disabling these technologies may prevent parts of
          the product from working.
        </p>
      </section>

      <section className="card legalPageSection">
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
      </section>

      <section className="card legalPageSection">
        <h2>6. Security and Retention</h2>
        <p>
          uLiquid uses technical and organizational safeguards designed to protect information, including access controls,
          encryption where appropriate, audit logs, and operational monitoring. No system is perfectly secure. uLiquid
          retains information for as long as needed to provide the product, maintain security, resolve disputes, comply
          with legal obligations, and preserve auditability.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>7. Your Choices</h2>
        <p>
          You may request access, correction, export, or deletion of personal information where required by applicable
          law. Some records may be retained where necessary for security, legal, audit, fraud-prevention, or operational
          reasons.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>8. Related Terms</h2>
        <p>
          This policy should be read together with the <Link href={withLocalePath("/terms", locale)}>Terms of Use</Link>{" "}
          and <Link href={withLocalePath("/risk-disclosure", locale)}>Crypto Risk Disclosure</Link>.
        </p>
      </section>
    </main>
  );
}
