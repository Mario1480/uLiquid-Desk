import VaultDetailClient from "../../../components/wallet/VaultDetailClient";
import { getWalletFeatureConfig } from "../../../lib/wallet/config";

export default async function VaultDetailPage({
  params
}: {
  params: Promise<{ vaultAddress: string }>;
}) {
  const { vaultAddress } = await params;
  return <VaultDetailClient config={getWalletFeatureConfig()} vaultAddress={vaultAddress} />;
}
