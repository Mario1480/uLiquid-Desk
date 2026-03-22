import { notFound } from "next/navigation";

type LegacyPageProps = {
  params: {
    slug: string[];
  };
};

async function resolveLegacyComponent(slug: string[]) {
  const joined = slug.join("/");

  switch (joined) {
    case "access-section":
      return (await import("../../access-section/page")).default;
    case "ai-prompts":
      return (await import("../../ai-prompts/page")).default;
    case "ai-trace":
      return (await import("../../ai-trace/page")).default;
    case "api-keys":
      return (await import("../../api-keys/page")).default;
    case "billing":
      return (await import("../../billing/page")).default;
    case "exchanges":
      return (await import("../../exchanges/page")).default;
    case "grid-hyperliquid-pilot":
      return (await import("../../grid-hyperliquid-pilot/page")).default;
    case "grid-templates":
      return (await import("../../grid-templates/page")).default;
    case "indicator-settings":
      return (await import("../../indicator-settings/page")).default;
    case "prediction-defaults":
      return (await import("../../prediction-defaults/page")).default;
    case "prediction-refresh":
      return (await import("../../prediction-refresh/page")).default;
    case "server-info":
      return (await import("../../server-info/page")).default;
    case "smtp":
      return (await import("../../smtp/page")).default;
    case "strategies":
      return (await import("../../strategies/page")).default;
    case "strategies/ai":
      return (await import("../../strategies/ai/page")).default;
    case "strategies/ai-generator":
      return (await import("../../strategies/ai-generator/page")).default;
    case "strategies/builder":
      return (await import("../../strategies/builder/page")).default;
    case "strategies/local":
      return (await import("../../strategies/local/page")).default;
    case "telegram":
      return (await import("../../telegram/page")).default;
    case "vault-execution":
      return (await import("../../vault-execution/page")).default;
    case "vault-operations":
      return (await import("../../vault-operations/page")).default;
    case "vault-safety":
      return (await import("../../vault-safety/page")).default;
    default:
      return null;
  }
}

export default async function AdminLegacyCatchAllPage({ params }: LegacyPageProps) {
  const Component = await resolveLegacyComponent(params.slug);
  if (!Component) notFound();
  return <Component />;
}
