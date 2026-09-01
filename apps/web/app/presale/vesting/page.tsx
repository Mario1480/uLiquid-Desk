import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUliqPublicPresaleLiveDataEnabled, isUliqPublicPresaleWebEnabled } from "../../../lib/uliqPublicPresale";
import PublicPresaleClient from "../PublicPresaleClient";

export const metadata: Metadata = {
  title: "ULIQ Presale Vesting | uLiquid Desk",
  description: "Review and claim wallet-based ULIQ vesting positions for both presale rounds.",
  alternates: { canonical: "/presale/vesting" },
  robots: isUliqPublicPresaleLiveDataEnabled() ? undefined : { index: false, follow: false }
};

export default function PublicPresaleVestingPage() {
  if (!isUliqPublicPresaleWebEnabled()) notFound();
  return <PublicPresaleClient view="vesting" />;
}
