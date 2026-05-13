import WalletDashboardClient from "../../components/wallet/WalletDashboardClient";
import { getFundingFeatureConfig } from "../../lib/funding/config";
import { getTransferFeatureConfig } from "../../lib/transfers/config";
import Web3Providers from "../components/Web3Providers";

export default function WalletPage() {
  return (
    <Web3Providers>
      <WalletDashboardClient
        fundingConfig={getFundingFeatureConfig()}
        transferConfig={getTransferFeatureConfig()}
      />
    </Web3Providers>
  );
}
