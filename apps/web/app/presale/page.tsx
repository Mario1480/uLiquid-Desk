import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUliqPublicPresaleLiveDataEnabled, isUliqPublicPresaleWebEnabled } from "../../lib/uliqPublicPresale";
import PublicPresaleClient from "./PublicPresaleClient";

export const metadata: Metadata = {
  title: "ULIQ Presale | uLiquid Desk",
  description: "Review the two ULIQ presale rounds, connect a wallet, and track onchain purchases.",
  alternates: { canonical: "/presale" },
  robots: isUliqPublicPresaleLiveDataEnabled() ? undefined : { index: false, follow: false }
};

export default function PublicPresalePage() {
  if (!isUliqPublicPresaleWebEnabled()) notFound();
  return <PublicPresaleClient view="presale" />;
}
