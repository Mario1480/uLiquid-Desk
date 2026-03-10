import FundingHistoryClient from "../../../components/funding/FundingHistoryClient";
import { getFundingFeatureConfig } from "../../../lib/funding/config";

export default function FundingHistoryPage() {
  return <FundingHistoryClient config={getFundingFeatureConfig()} />;
}
