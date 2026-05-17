import Link from "next/link";
import { withLocalePath } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

export default async function TermsPage() {
  const locale = await resolveRequestLocale();

  return (
    <main className="legalPage">
      <header className="legalPageHeader">
        <h1>uLiquid Terms of Use</h1>
        <div className="legalPageMeta">Last updated: May 17, 2026. Version 2026-05-17.</div>
      </header>

      <section className="card legalPageSection">
        <h2>1. Acceptance</h2>
        <p>
          These Terms of Use govern access to and use of uLiquid Desk, uLiquid software, interfaces, automation tools,
          market-data views, notifications, strategy tooling, wallet and exchange integrations, and related services
          provided by or through uLiquid. By creating an account, connecting a wallet, configuring an exchange account,
          running a bot, or otherwise using uLiquid, you agree to these Terms.
        </p>
        <p>
          If you do not agree, do not use uLiquid. If you use uLiquid on behalf of an organization, you represent that
          you are authorized to bind that organization.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>2. Non-Custodial Software</h2>
        <p>
          uLiquid is non-custodial software. uLiquid does not take custody of your funds and has no independent access
          to withdraw your funds. uLiquid does not ask for or control private keys, seed phrases, or withdrawal
          credentials. Wallets, exchange accounts, API permissions, smart contracts, orders, and transactions remain
          under your control or the third-party venues you choose.
        </p>
        <p>
          You are responsible for reviewing permissions before connecting wallets, API keys, exchanges, smart contracts,
          bridges, or other third-party systems.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>3. No Financial Advice</h2>
        <p>
          uLiquid does not provide financial, investment, trading, tax, accounting, or legal advice. Information,
          signals, automation, alerts, forecasts, AI outputs, indicators, backtests, examples, and strategy presets are
          provided for software functionality and informational purposes only. You must make your own decisions and
          should consult qualified professionals where appropriate.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>4. Crypto and Trading Risk</h2>
        <p>
          Crypto-assets, derivatives, leverage, automated trading, exchange integrations, smart contracts, wallets, and
          network activity involve substantial risk. You may lose some or all of your funds. No output from uLiquid is a
          promise of profit, loss avoidance, execution quality, uptime, availability, or future performance.
        </p>
        <p>
          You must read and understand the{" "}
          <Link href={withLocalePath("/risk-disclosure", locale)}>Crypto Risk Disclosure</Link> before using uLiquid.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>5. Your Responsibilities</h2>
        <ul>
          <li>You are responsible for account security, passwords, devices, wallets, exchange credentials, and API permissions.</li>
          <li>You are responsible for every bot, strategy, signal, order, transfer, transaction, deposit, withdrawal, and configuration you initiate or authorize.</li>
          <li>You must comply with laws, regulations, tax obligations, exchange terms, sanctions rules, and third-party service terms that apply to you.</li>
          <li>You must not use uLiquid for unlawful activity, market manipulation, fraud, abusive trading, unauthorized access, or circumvention of third-party controls.</li>
        </ul>
      </section>

      <section className="card legalPageSection">
        <h2>6. Third-Party Services</h2>
        <p>
          uLiquid may interact with wallets, blockchains, exchanges, data providers, payment providers, bridges,
          notification providers, infrastructure services, and other third parties. uLiquid does not control those
          services and is not responsible for their availability, security, fees, pricing, policies, execution, custody,
          failures, or losses.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>7. Availability and Changes</h2>
        <p>
          uLiquid may change, suspend, restrict, or discontinue features at any time, including for security,
          maintenance, compliance, operational, or product reasons. uLiquid may also update these Terms. Continued use
          after an update means you accept the updated Terms.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>8. Disclaimers and Liability</h2>
        <p>
          uLiquid is provided on an "as is" and "as available" basis to the fullest extent permitted by law. uLiquid
          disclaims warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy,
          uninterrupted operation, and error-free operation. To the fullest extent permitted by law, uLiquid is not liable
          for trading losses, lost profits, lost data, market moves, exchange failures, smart-contract failures, security
          incidents, user error, third-party services, or indirect, incidental, special, consequential, exemplary, or
          punitive damages.
        </p>
      </section>

      <section className="card legalPageSection">
        <h2>9. Privacy</h2>
        <p>
          Use of uLiquid is also governed by the <Link href={withLocalePath("/privacy", locale)}>Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
