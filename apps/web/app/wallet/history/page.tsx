import FundingHistoryClient from "../../../components/funding/FundingHistoryClient";
import { getFundingFeatureConfig } from "../../../lib/funding/config";

export default function WalletHistoryPage() {
  return <FundingHistoryClient config={getFundingFeatureConfig()} />;
}
