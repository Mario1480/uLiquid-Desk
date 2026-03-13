import WalletDashboardClient from "../../components/wallet/WalletDashboardClient";
import { getFundingFeatureConfig } from "../../lib/funding/config";
import { getTransferFeatureConfig } from "../../lib/transfers/config";
import { getWalletFeatureConfig } from "../../lib/wallet/config";

export default function WalletPage() {
  return (
    <WalletDashboardClient
      config={getWalletFeatureConfig()}
      fundingConfig={getFundingFeatureConfig()}
      transferConfig={getTransferFeatureConfig()}
    />
  );
}
