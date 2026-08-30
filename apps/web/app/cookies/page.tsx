import Link from "next/link";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

type StorageEntry = {
  name: string;
  purpose: string;
  duration: string;
};

type CookiePageCopy = {
  title: string;
  meta: string;
  introTitle: string;
  intro: string;
  noTracking: string;
  cookiesTitle: string;
  cookies: StorageEntry[];
  browserStorageTitle: string;
  browserStorageIntro: string;
  browserStorage: StorageEntry[];
  controlsTitle: string;
  controls: string[];
  externalTitle: string;
  external: string;
  relatedTitle: string;
  privacy: string;
  terms: string;
  contact: string;
};

const COPY: Record<AppLocale, CookiePageCopy> = {
  de: {
    title: "Cookie- und Speicherinformationen",
    meta: "Stand: 30. August 2026. Version 2026-08-30.",
    introTitle: "1. Necessary-only Ansatz",
    intro:
      "uLiquid Desk verwendet derzeit nur Cookies und Browser-Speicher, die für Anmeldung, Sicherheit, ausdrücklich gewählte Einstellungen oder die Wiederaufnahme angeforderter Produktabläufe erforderlich sind.",
    noTracking:
      "uLiquid Desk setzt derzeit keine Analyse-, Marketing- oder Werbe-Cookies ein. Deshalb wird kein Einwilligungsbanner angezeigt. Optionale Technologien würden erst nach einer vorherigen Einwilligung aktiviert.",
    cookiesTitle: "2. Verwendete Cookies",
    cookies: [
      {
        name: "utrade_locale",
        purpose: "Speichert die vom Nutzer aktiv gewählte Sprache.",
        duration: "Bis zu 1 Jahr nach der Sprachauswahl."
      },
      {
        name: "mm_session (oder umgebungsspezifischer Präfix)",
        purpose: "Hält die angemeldete Sitzung aufrecht und ordnet Anfragen dem Benutzerkonto zu.",
        duration: "Bis zu 30 Tage; beim Abmelden wird das Cookie gelöscht."
      },
      {
        name: "mm_csrf (oder umgebungsspezifischer Präfix)",
        purpose: "Schützt angemeldete Sitzungen vor Cross-Site-Request-Forgery-Angriffen.",
        duration: "Bis zu 30 Tage; beim Abmelden wird das Cookie gelöscht."
      },
      {
        name: "mm_reauth (oder umgebungsspezifischer Präfix)",
        purpose: "Bestätigt kurzzeitig eine zusätzliche Authentifizierung für sensible Aktionen.",
        duration: "In der Regel bis zu 10 Minuten oder bis zur Verwendung."
      },
      {
        name: "mm_siwe_nonce (oder umgebungsspezifischer Präfix)",
        purpose: "Sichert die einmalige Wallet-Anmeldung mit Sign-In with Ethereum ab.",
        duration: "In der Regel bis zu 10 Minuten oder bis zur Verwendung."
      }
    ],
    browserStorageTitle: "3. Browser-Speicher",
    browserStorageIntro:
      "Local Storage bleibt im Browser bestehen, bis der jeweilige Eintrag entfernt wird. Session Storage endet spätestens mit der Browser-Tab-Sitzung.",
    browserStorage: [
      {
        name: "gridCatalogView",
        purpose: "Merkt sich die gewählte Listen- oder Rasteransicht im Bot-Katalog.",
        duration: "Bis zur Änderung oder Löschung der Browserdaten."
      },
      {
        name: "uliquid.billing.pendingTxHashes.v1",
        purpose: "Ermöglicht die sichere Wiederaufnahme und Abstimmung einer begonnenen Billing-Transaktion.",
        duration: "Bis zur Abstimmung des Vorgangs oder Löschung der Browserdaten."
      },
      {
        name: "uliquid.uliq.pendingFinalizeTxHashes.v1, uliquid.uliq.pendingWithdrawTxHashes.v1 und uliquid.uliq.pendingClaimTransaction.v1",
        purpose: "Bewahrt ausstehende ULIQ-Transaktionsreferenzen für Statusprüfung und Wiederaufnahme auf.",
        duration: "Bis zum Abschluss des Vorgangs oder Löschung der Browserdaten."
      },
      {
        name: "uliquid.uliq.admin.dexLaunchTracking.v1",
        purpose: "Bewahrt ausschließlich im Admin-Bereich den lokalen Status einer angeforderten DEX-Startprüfung auf.",
        duration: "Bis zur Aktualisierung oder Löschung der Browserdaten."
      },
      {
        name: "tradeDeskPrefill und uliquid.agentChat.positionPrefill.v1",
        purpose: "Überträgt eine vom Nutzer gewählte Analyse- oder Positionsvorbelegung zwischen Desk-Ansichten.",
        duration: "Session Storage; wird nach der Übernahme oder spätestens beim Ende der Tab-Sitzung entfernt."
      }
    ],
    controlsTitle: "4. Kontrolle und Löschung",
    controls: [
      "Die Sprache kann jederzeit über die Sprachauswahl geändert werden.",
      "Cookies und Browser-Speicher können über die Einstellungen des Browsers gelöscht werden.",
      "Das Blockieren notwendiger Session- oder Sicherheits-Cookies kann Anmeldung, Wallet-Verknüpfung und geschützte Aktionen verhindern."
    ],
    externalTitle: "5. Externe Dienste",
    external:
      "Wenn ein Nutzer eine Wallet, Börse, Blockchain oder einen Zahlungsdienst öffnet oder verbindet, kann dieser externe Anbieter eigene Cookies oder Speichertechnologien nach seinen eigenen Datenschutzbestimmungen verwenden.",
    relatedTitle: "6. Weitere Informationen",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
    contact: "Fragen zu Datenschutz oder Browser-Speicher können an privacy@uliquid.vip gesendet werden."
  },
  en: {
    title: "Cookie and Storage Information",
    meta: "Last updated: August 30, 2026. Version 2026-08-30.",
    introTitle: "1. Necessary-only approach",
    intro:
      "uLiquid Desk currently uses only cookies and browser storage required for authentication, security, explicitly selected preferences, or resuming product flows requested by the user.",
    noTracking:
      "uLiquid Desk does not currently use analytics, marketing, or advertising cookies. No consent banner is therefore displayed. Optional technologies would only be activated after prior consent.",
    cookiesTitle: "2. Cookies in use",
    cookies: [
      {
        name: "utrade_locale",
        purpose: "Stores the language actively selected by the user.",
        duration: "Up to 1 year after the language selection."
      },
      {
        name: "mm_session (or environment-specific prefix)",
        purpose: "Maintains the signed-in session and associates requests with the user account.",
        duration: "Up to 30 days; deleted when the user signs out."
      },
      {
        name: "mm_csrf (or environment-specific prefix)",
        purpose: "Protects authenticated sessions against cross-site request forgery attacks.",
        duration: "Up to 30 days; deleted when the user signs out."
      },
      {
        name: "mm_reauth (or environment-specific prefix)",
        purpose: "Temporarily confirms additional authentication for sensitive actions.",
        duration: "Usually up to 10 minutes or until used."
      },
      {
        name: "mm_siwe_nonce (or environment-specific prefix)",
        purpose: "Secures the one-time Sign-In with Ethereum wallet authentication flow.",
        duration: "Usually up to 10 minutes or until used."
      }
    ],
    browserStorageTitle: "3. Browser storage",
    browserStorageIntro:
      "Local Storage remains in the browser until the relevant entry is removed. Session Storage ends no later than the browser-tab session.",
    browserStorage: [
      {
        name: "gridCatalogView",
        purpose: "Remembers the selected list or grid view in the bot catalog.",
        duration: "Until changed or browser data is deleted."
      },
      {
        name: "uliquid.billing.pendingTxHashes.v1",
        purpose: "Supports safe recovery and reconciliation of an initiated billing transaction.",
        duration: "Until the process is reconciled or browser data is deleted."
      },
      {
        name: "uliquid.uliq.pendingFinalizeTxHashes.v1, uliquid.uliq.pendingWithdrawTxHashes.v1, and uliquid.uliq.pendingClaimTransaction.v1",
        purpose: "Keeps pending ULIQ transaction references available for status checks and recovery.",
        duration: "Until the process completes or browser data is deleted."
      },
      {
        name: "uliquid.uliq.admin.dexLaunchTracking.v1",
        purpose: "Keeps the local status of a requested DEX launch check in the admin area only.",
        duration: "Until updated or browser data is deleted."
      },
      {
        name: "tradeDeskPrefill and uliquid.agentChat.positionPrefill.v1",
        purpose: "Transfers a user-selected analysis or position prefill between Desk views.",
        duration: "Session Storage; removed after use or no later than the end of the tab session."
      }
    ],
    controlsTitle: "4. Control and deletion",
    controls: [
      "The language can be changed at any time through the language selector.",
      "Cookies and browser storage can be deleted through the browser settings.",
      "Blocking required session or security cookies may prevent sign-in, wallet linking, and protected actions."
    ],
    externalTitle: "5. External services",
    external:
      "When a user opens or connects a wallet, exchange, blockchain, or payment service, that external provider may use its own cookies or storage technologies under its own privacy terms.",
    relatedTitle: "6. Further information",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    contact: "Questions about privacy or browser storage can be sent to privacy@uliquid.vip."
  }
};

function StorageList({ entries }: { entries: StorageEntry[] }) {
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.name}>
          <strong><code>{entry.name}</code></strong>: {entry.purpose} <strong>{entry.duration}</strong>
        </li>
      ))}
    </ul>
  );
}

export default async function CookieInformationPage() {
  const locale = await resolveRequestLocale();
  const copy = COPY[locale];

  return (
    <main className="legalPage">
      <header className="legalPageHeader">
        <h1>{copy.title}</h1>
        <div className="legalPageMeta">{copy.meta}</div>
      </header>

      <section className="card legalPageSection">
        <h2>{copy.introTitle}</h2>
        <p>{copy.intro}</p>
        <p>{copy.noTracking}</p>
      </section>

      <section className="card legalPageSection">
        <h2>{copy.cookiesTitle}</h2>
        <StorageList entries={copy.cookies} />
      </section>

      <section className="card legalPageSection">
        <h2>{copy.browserStorageTitle}</h2>
        <p>{copy.browserStorageIntro}</p>
        <StorageList entries={copy.browserStorage} />
      </section>

      <section className="card legalPageSection">
        <h2>{copy.controlsTitle}</h2>
        <ul>{copy.controls.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      <section className="card legalPageSection">
        <h2>{copy.externalTitle}</h2>
        <p>{copy.external}</p>
      </section>

      <section className="card legalPageSection">
        <h2>{copy.relatedTitle}</h2>
        <p>
          <Link href={withLocalePath("/privacy", locale)}>{copy.privacy}</Link>{" · "}
          <Link href={withLocalePath("/terms", locale)}>{copy.terms}</Link>
        </p>
        <p>{copy.contact}</p>
      </section>
    </main>
  );
}
