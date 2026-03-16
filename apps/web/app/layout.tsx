import { NextIntlClientProvider } from "next-intl";
import AppShell from "./components/AppShell";
import Web3Providers from "./components/Web3Providers";
import { resolveRequestLocale } from "../i18n/request";
import { getMessages } from "../i18n/messages";
import { assertWebEnv } from "../lib/startup-env";
import "./globals.css";

assertWebEnv();

export const metadata = { title: "uLiquid Desk" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveRequestLocale();
  const messages = getMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Web3Providers>
            <AppShell>{children}</AppShell>
          </Web3Providers>
          <footer className="appFooter">
            <div className="container appFooterInner">
              <div className="appFooterCopy">© 2026 uLiquid</div>
              <div className="appFooterLinks">
                <a href="https://desk.uliquid.vip" aria-label="uLiquid Desk Website">desk.uliquid.vip</a>
                <a href="https://desk.uliquid.vip/privacy" aria-label={messages.common.footer.privacy}>
                  {messages.common.footer.privacy}
                </a>
                <a href="https://desk.uliquid.vip/terms" aria-label={messages.common.footer.terms}>
                  {messages.common.footer.terms}
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
