import FundingHubClient from "../../components/funding/FundingHubClient";
import { getTransferFeatureConfig } from "../../lib/transfers/config";

export default function FundingPage() {
  return <FundingHubClient config={getTransferFeatureConfig()} />;
}
