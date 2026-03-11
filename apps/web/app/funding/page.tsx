import { redirect } from "next/navigation";
import { withLocalePath } from "../../i18n/config";
import { resolveRequestLocale } from "../../i18n/request";

export default async function FundingPage() {
  const locale = await resolveRequestLocale();
  redirect(withLocalePath("/wallet", locale));
}
