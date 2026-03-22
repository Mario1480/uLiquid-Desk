import { notFound } from "next/navigation";

type SystemCatchAllPageProps = {
  params: Promise<{
    slug: string[];
  }>;
};

async function resolveSystemComponent(slug: string[]) {
  const joined = slug.join("/");

  switch (joined) {
    case "access":
      return (await import("../../access-section/page")).default;
    case "notifications/smtp":
      return (await import("../../smtp/page")).default;
    case "notifications/telegram":
      return (await import("../../telegram/page")).default;
    case "integrations/api-keys":
      return (await import("../../api-keys/page")).default;
    case "integrations/exchanges":
      return (await import("../../exchanges/page")).default;
    case "integrations/server-info":
      return (await import("../../server-info/page")).default;
    case "ai/prompts":
      return (await import("../../ai-prompts/page")).default;
    case "ai/trace":
      return (await import("../../ai-trace/page")).default;
    case "ai/indicator-settings":
      return (await import("../../indicator-settings/page")).default;
    case "ai/prediction-defaults":
      return (await import("../../prediction-defaults/page")).default;
    case "ai/prediction-refresh":
      return (await import("../../prediction-refresh/page")).default;
    case "ai/strategies":
      return (await import("../../strategies/page")).default;
    case "ai/strategies/ai":
      return (await import("../../strategies/ai/page")).default;
    case "ai/strategies/ai-generator":
      return (await import("../../strategies/ai-generator/page")).default;
    case "ai/strategies/builder":
      return (await import("../../strategies/builder/page")).default;
    case "ai/strategies/local":
      return (await import("../../strategies/local/page")).default;
    case "vaults/execution":
      return (await import("../../vault-execution/page")).default;
    case "vaults/operations":
      return (await import("../../vault-operations/page")).default;
    case "vaults/safety":
      return (await import("../../vault-safety/page")).default;
    case "vaults/grid-hyperliquid-pilot":
      return (await import("../../grid-hyperliquid-pilot/page")).default;
    default:
      return null;
  }
}

export default async function AdminSystemCatchAllPage({ params }: SystemCatchAllPageProps) {
  const { slug } = await params;
  const Component = await resolveSystemComponent(slug);
  if (!Component) notFound();
  return <Component />;
}
