"use client";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useTranslations } from "next-intl";

export default function PriceSupportPage() {
  const t = useTranslations("system.botsPriceSupport");

  return (
    <div className="botsPriceSupportPage">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <DeskSurface dense><div className="card" style={{ padding: 14 }}>
        <p style={{ marginTop: 0 }}>
          {t("description")}
        </p>
      </div></DeskSurface>
    </div>
  );
}
