import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { withLocalePath } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

export default async function RiskDisclosurePage() {
  const locale = await resolveRequestLocale();

  return (
    <main className="legalPage">
      <header className="legalPageHeader">
        <h1>uLiquid Crypto Risk Disclosure</h1>
        <div className="legalPageMeta">Last updated: May 17, 2026. Version 2026-05-17.</div>
      </header>

      <DeskSurface><section className="card legalPageSection">
        <h2>1. High-Risk Activity</h2>
        <p>
          Crypto-assets, virtual currencies, derivatives, leverage, automated trading, exchange integrations, smart
          contracts, wallets, bridges, and blockchain networks are high-risk. You may lose some or all of your funds.
          Only use funds you can afford to lose and do not use products, strategies, or permissions you do not
          understand.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>2. Market and Liquidity Risk</h2>
        <p>
          Crypto prices can be extremely volatile. Markets may move rapidly, gap, flash crash, become illiquid, or
          behave differently across venues. Slippage, spreads, partial fills, delayed fills, liquidation, funding costs,
          fees, and failed execution can materially affect outcomes. Leverage can amplify gains and losses.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>3. Automation Risk</h2>
        <p>
          Bots, strategies, signals, AI outputs, alerts, and automated workflows can malfunction, misinterpret data,
          act on stale or incorrect data, be configured incorrectly, or perform differently from backtests and
          simulations. Past performance, backtests, simulated results, and examples do not guarantee future results.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>4. Technology and Security Risk</h2>
        <p>
          Wallets, APIs, blockchains, bridges, exchanges, smart contracts, networks, nodes, browsers, devices, cloud
          services, and internet connections can fail, be delayed, be exploited, or be unavailable. Hacks, phishing,
          malware, leaked credentials, incorrect permissions, contract bugs, oracle failures, chain reorganizations, and
          operational errors can cause irreversible loss.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>5. Third-Party and Regulatory Risk</h2>
        <p>
          Third-party exchanges, wallets, payment providers, blockchains, bridges, and data providers may suspend,
          restrict, reverse, reject, delay, or fail services. Laws, regulations, taxes, and venue rules may change and
          may affect your ability to access, trade, transfer, or withdraw assets.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>6. No Guarantee</h2>
        <p>
          uLiquid does not guarantee profits, loss avoidance, uptime, availability, data accuracy, execution quality,
          liquidity, tax treatment, regulatory treatment, or suitability for any purpose. You are solely responsible for
          your decisions and for monitoring every wallet, exchange account, bot, strategy, order, transfer, and
          transaction.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>7. U.S. Regulator Guidance</h2>
        <p>
          U.S. regulators and consumer-protection agencies have warned that virtual currency and crypto activity can
          involve high volatility, fraud, platform risk, cyber risk, and scams. You can review public education resources
          from the{" "}
          <a href="https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/understand_risks_of_virtual_currency.html" target="_blank" rel="noreferrer">
            CFTC
          </a>{" "}
          and{" "}
          <a href="https://consumer.ftc.gov/articles/what-know-about-cryptocurrency-scams" target="_blank" rel="noreferrer">
            FTC
          </a>.
        </p>
      </section></DeskSurface>

      <DeskSurface><section className="card legalPageSection">
        <h2>8. Related Terms</h2>
        <p>
          This disclosure should be read together with the <Link href={withLocalePath("/terms", locale)}>Terms of Use</Link>{" "}
          and <Link href={withLocalePath("/privacy", locale)}>Privacy Policy</Link>.
        </p>
      </section></DeskSurface>
    </main>
  );
}
