"use client";

import Web3Providers from "../../components/Web3Providers";
import { AffiliateOverview } from "./AffiliateOverview";

export default function SettingsAffiliatePage() {
  return (
    <Web3Providers>
      <AffiliateOverview />
    </Web3Providers>
  );
}
