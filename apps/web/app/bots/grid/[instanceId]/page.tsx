"use client";

import { useParams } from "next/navigation";
import { GridInstanceDetailView } from "../../../../components/grid/GridInstanceDetailView";
import Web3Providers from "../../../components/Web3Providers";

function GridBotInstancePageContent() {
  const params = useParams<{ instanceId: string }>();
  const instanceId = String(params?.instanceId ?? "").trim();
  return <GridInstanceDetailView instanceId={instanceId} />;
}

export default function GridBotInstancePage() {
  return (
    <Web3Providers>
      <GridBotInstancePageContent />
    </Web3Providers>
  );
}
