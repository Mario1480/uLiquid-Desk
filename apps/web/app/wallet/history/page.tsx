import FundingHistoryClient from "../../../components/funding/FundingHistoryClient";
import { getFundingFeatureConfig } from "../../../lib/funding/config";
import Web3Providers from "../../components/Web3Providers";

export default function WalletHistoryPage() {
  return (
    <Web3Providers>
      <FundingHistoryClient config={getFundingFeatureConfig()} />
    </Web3Providers>
  );
}
