"use client";

import { useParams } from "next/navigation";
import { GridInstanceDetailView } from "../../../../components/grid/GridInstanceDetailView";

export default function GridBotInstancePage() {
  const params = useParams<{ instanceId: string }>();
  const instanceId = String(params?.instanceId ?? "").trim();
  return <GridInstanceDetailView instanceId={instanceId} />;
}
