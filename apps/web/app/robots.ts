import type { MetadataRoute } from "next";
import { isUliqPublicPresaleLiveDataEnabled } from "../lib/uliqPublicPresale";

const publicOrigin = (process.env.NEXT_PUBLIC_WEB_URL ?? "https://desk.uliquid.vip").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  const publicPresaleIndexable = isUliqPublicPresaleLiveDataEnabled();
  return {
    rules: {
      userAgent: "*",
      allow: publicPresaleIndexable ? ["/en/presale", "/de/presale"] : undefined,
      disallow: ["/en/", "/de/", "/admin", "/api", "/uliq", "/trade", "/bots", "/settings", "/wallet", "/funding"]
    },
    sitemap: `${publicOrigin}/sitemap.xml`,
    host: publicOrigin
  };
}
