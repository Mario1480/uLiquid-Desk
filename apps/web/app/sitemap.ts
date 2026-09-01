import type { MetadataRoute } from "next";
import { LOCALES } from "../i18n/config";
import { isUliqPublicPresaleLiveDataEnabled } from "../lib/uliqPublicPresale";

const publicOrigin = (process.env.NEXT_PUBLIC_WEB_URL ?? "https://desk.uliquid.vip").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isUliqPublicPresaleLiveDataEnabled()) return [];
  return LOCALES.flatMap((locale) => [
    {
      url: `${publicOrigin}/${locale}/presale`,
      changeFrequency: "daily" as const,
      priority: 0.9,
      alternates: {
        languages: {
          en: `${publicOrigin}/en/presale`,
          de: `${publicOrigin}/de/presale`
        }
      }
    },
    {
      url: `${publicOrigin}/${locale}/presale/vesting`,
      changeFrequency: "daily" as const,
      priority: 0.6,
      alternates: {
        languages: {
          en: `${publicOrigin}/en/presale/vesting`,
          de: `${publicOrigin}/de/presale/vesting`
        }
      }
    }
  ]);
}
