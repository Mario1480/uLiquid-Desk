import WalletDashboardClient from "../../components/wallet/WalletDashboardClient";
import { getFundingFeatureConfig } from "../../lib/funding/config";
import { getTransferFeatureConfig } from "../../lib/transfers/config";

export default function WalletPage() {
  return (
    <WalletDashboardClient
      fundingConfig={getFundingFeatureConfig()}
      transferConfig={getTransferFeatureConfig()}
    />
  );
}
