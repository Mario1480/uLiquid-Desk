import WalletDashboardClient from "../../components/wallet/WalletDashboardClient";
import { getWalletFeatureConfig } from "../../lib/wallet/config";

export default function WalletPage() {
  return <WalletDashboardClient config={getWalletFeatureConfig()} />;
}
