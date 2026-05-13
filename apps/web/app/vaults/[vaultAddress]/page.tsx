import VaultDetailClient from "../../../components/wallet/VaultDetailClient";
import { getWalletFeatureConfig } from "../../../lib/wallet/config";
import Web3Providers from "../../components/Web3Providers";

export default async function VaultDetailPage({
  params
}: {
  params: Promise<{ vaultAddress: string }>;
}) {
  const { vaultAddress } = await params;
  return (
    <Web3Providers>
      <VaultDetailClient config={getWalletFeatureConfig()} vaultAddress={vaultAddress} />
    </Web3Providers>
  );
}
