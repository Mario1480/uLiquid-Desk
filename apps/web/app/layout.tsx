import { NextIntlClientProvider } from "next-intl";
import AppShell from "./components/AppShell";
import QueryProviders from "./components/QueryProviders";
import { resolveRequestLocale } from "../i18n/request";
import { getMessages } from "../i18n/messages";
import { withLocalePath } from "../i18n/config";
import { assertWebEnv } from "../lib/startup-env";
import "./globals.css";
import "./styles/shell.css";
import "./styles/desk.css";
import "./styles/settings-admin.css";
import "./styles/bots-wallet.css";
import "./ui-system.css";

assertWebEnv();

export const metadata = { title: "uLiquid Desk" };
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveRequestLocale();
  const messages = getMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProviders>
            <AppShell>{children}</AppShell>
          </QueryProviders>
          <footer className="appFooter">
            <div className="container appFooterInner">
              <div className="appFooterCopy">© 2026 uLiquid</div>
              <div className="appFooterLinks">
                <a href="https://desk.uliquid.vip" aria-label="uLiquid Desk Website">desk.uliquid.vip</a>
                <a href={withLocalePath("/privacy", locale)} aria-label={messages.common.footer.privacy}>
                  {messages.common.footer.privacy}
                </a>
                <a href={withLocalePath("/cookies", locale)} aria-label={messages.common.footer.cookies}>
                  {messages.common.footer.cookies}
                </a>
                <a href={withLocalePath("/terms", locale)} aria-label={messages.common.footer.terms}>
                  {messages.common.footer.terms}
                </a>
                <a href={withLocalePath("/risk-disclosure", locale)} aria-label="Crypto Risk Disclosure">
                  Risk Disclosure
                </a>
                <a href="mailto:support@uliquid.vip" aria-label="Support email">support@uliquid.vip</a>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
