import VaultsIndexClient from "../../components/wallet/VaultsIndexClient";
import { getWalletFeatureConfig } from "../../lib/wallet/config";

export default function VaultsPage() {
  return <VaultsIndexClient _config={getWalletFeatureConfig()} />;
}
