"use client";

import { useTranslations } from "next-intl";

export default function MaintenancePage() {
  const t = useTranslations("system.maintenancePage");

  return (
    <div className="maintenancePage">
      <section className="card maintenanceCard">
        <div className="maintenanceEyebrow">{t("eyebrow")}</div>
        <h1 className="maintenanceTitle">{t("title")}</h1>
        <p className="maintenanceBody">{t("description")}</p>
        <p className="maintenanceBody">{t("secondary")}</p>
        <p className="maintenanceHint">{t("hint")}</p>
      </section>
    </div>
  );
}
